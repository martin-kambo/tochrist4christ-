/**
 * /.netlify/functions/update-progress
 *
 * Called by course.html each time the user marks a lesson complete.
 * Writes (or merges) a progress record in Redis that get-progress reads.
 *
 * V2 PHASE 1 SECURITY CHANGE — see TC4C_TECHNICAL_FINDINGS.md (C3) and
 * TC4C_V2_PHASE1_ARCHITECTURE.md:
 *   Previously this endpoint accepted an arbitrary `email` in the POST
 *   body as proof of identity, so anyone could write progress data for
 *   any member. It now:
 *     - requires a valid member_session cookie (see shared/member-auth.js)
 *     - derives the email SOLELY from that verified session
 *     - returns 401 if there is no valid session
 *     - ignores any `email` field the caller sends in the body
 *
 * V2 PHASE 2 — CANONICAL PROGRESS MIGRATION (see
 * TC4C_V2_PHASE2_ARCHITECTURE.md): course.html now calls this endpoint —
 * both to push newly-completed lessons in real time (toggleComplete()) and
 * as part of its local↔server reconciliation on load
 * (syncProgressWithServer()). Server-side input validation was added
 * (lessonId format, currentModule range, faithStage enum) so the client
 * can't inject arbitrary values into the stored Redis record. The Redis
 * schema, streak logic, and badge logic are otherwise UNCHANGED from
 * Phase 1.
 *
 * ── Request ─────────────────────────────────────────────────────────────────
 * POST (member_session cookie required) {
 *   lessonId       : string,   // course.html's own "<level>-<lesson>" key, e.g. "1-3"
 *   nextLessonTitle: string,   // title of the next lesson (pre-computed by the caller)
 *   currentModule  : number,   // 1 | 2 | 3
 *   faithStage     : string,   // optional; stored only if not already present
 * }
 *
 * ── Response (200) ──────────────────────────────────────────────────────────
 * {
 *   ok             : true,
 *   lessonsCompleted: number,
 *   streak          : number,
 *   badgesEarned    : string[],
 *   newBadge        : string | null,  // if a badge was just unlocked
 * }
 *
 * ── Redis key written ────────────────────────────────────────────────────────
 * progress:<email>   JSON blob (no TTL — progress is permanent); <email> is
 *                     always the authenticated caller's own email.
 *
 * ── Streak logic (unchanged) ─────────────────────────────────────────────────
 * - If lastActivityDate is today     → don't increment (already counted today)
 * - If lastActivityDate is yesterday → increment streak by 1
 * - If lastActivityDate is older / absent → reset streak to 1
 */

const { cmd } = require('./redis');
const { getAuthenticatedMember } = require('./shared/member-auth');

const TOTAL_LESSONS = 48;

const BADGE_THRESHOLDS = {
  foundation: 16,
  word      : 32,
  prayer    : 40,
  identity  : 48,
};

// V2 PHASE 2 — server-side input validation (see "Server-side validation"
// in TC4C_V2_PHASE2_ARCHITECTURE.md). LESSON_ID_RE intentionally matches
// course.html's own LESSON_KEY_RE exactly ("<level>-<lesson>", level 1-3,
// lesson 1-16) — inspection confirmed this is the actual lesson-id format
// the live course uses, so no translation layer is needed; see
// course.html's syncProgressWithServer() doc comment for the same finding
// from the other side. ALLOWED_FAITH_STAGES matches course.html's own
// FAITH_STAGE_ACCESS keys exactly.
const LESSON_ID_RE = /^[1-3]-([1-9]|1[0-6])$/;
const ALLOWED_FAITH_STAGES = ['just_starting', 'feeling_stuck', 'returning', 'growing'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' });
  }

  // ── Authenticate: identity comes ONLY from the verified session ───────────
  let member;
  try {
    member = await getAuthenticatedMember(event);
  } catch (err) {
    console.error('[update-progress] Auth check error:', err.message);
    return reply(500, { error: 'internal error' });
  }
  if (!member) return reply(401, { error: 'Unauthorized' });

  const email = member.email;

  // ── Parse body (email, if present, is intentionally ignored) ──────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  const lessonId        = String(body.lessonId        || '').trim();
  const nextLessonTitle = String(body.nextLessonTitle || '').trim().slice(0, 200);
  const currentModule   = Number(body.currentModule);
  const faithStage      = String(body.faithStage      || member.faithStage || '').trim();

  // V2 PHASE 2 — reject malformed input rather than silently storing it
  // (see TC4C_V2_PHASE2_ARCHITECTURE.md §"Server-side validation"). The
  // client must not be able to inject arbitrary values into the Redis
  // progress record.
  if (!lessonId) {
    return reply(400, { error: 'lessonId required' });
  }
  if (!LESSON_ID_RE.test(lessonId)) {
    return reply(400, { error: 'lessonId must match "<level>-<lesson>", e.g. "1-3"' });
  }
  if (![1, 2, 3].includes(currentModule)) {
    return reply(400, { error: 'currentModule must be 1, 2, or 3' });
  }
  if (faithStage && !ALLOWED_FAITH_STAGES.includes(faithStage)) {
    return reply(400, { error: `faithStage must be one of: ${ALLOWED_FAITH_STAGES.join(', ')}` });
  }

  // ── Load existing progress ────────────────────────────────────────────────
  let stored = {};
  try {
    const raw = await cmd('GET', `progress:${email}`);
    if (raw) stored = JSON.parse(raw);
  } catch (err) {
    console.error('[update-progress] Redis read error:', err);
    return reply(500, { error: 'internal error' });
  }

  // ── De-duplicate: skip if lesson already recorded ─────────────────────────
  const completedSet = new Set(Array.isArray(stored.completedIds) ? stored.completedIds : []);
  const isNew = !completedSet.has(lessonId);

  if (isNew) completedSet.add(lessonId);
  const lessonsCompleted = Math.min(completedSet.size, TOTAL_LESSONS);

  // ── Streak computation ────────────────────────────────────────────────────
  const todayStr = utcDateString(new Date());
  let streak     = Number(stored.streak) || 0;

  if (isNew) {
    const lastDate = stored.lastActivityDate || null;
    if (!lastDate) {
      streak = 1; // first ever lesson
    } else if (lastDate === todayStr) {
      // already active today — streak unchanged
    } else {
      const diffDays = daysDiff(lastDate, todayStr);
      if (diffDays === 1) {
        streak += 1; // consecutive day
      } else {
        streak = 1;  // gap → reset
      }
    }
  }

  // ── Badge unlock check ───────────────────────────────────────────────────
  const earnedBefore = new Set(Array.isArray(stored.badgesEarned) ? stored.badgesEarned : []);
  const earnedAfter  = new Set(earnedBefore);
  let newBadge = null;

  for (const [id, threshold] of Object.entries(BADGE_THRESHOLDS)) {
    if (lessonsCompleted >= threshold && !earnedBefore.has(id)) {
      earnedAfter.add(id);
      newBadge = id; // report the most-recently unlocked badge to the client
    }
  }

  // ── Build updated record ──────────────────────────────────────────────────
  const updated = {
    ...stored,
    completedIds    : [...completedSet],
    lessonsCompleted,
    streak,
    lastActivityDate: isNew ? todayStr : (stored.lastActivityDate || todayStr),
    currentModule,
    nextLessonTitle : nextLessonTitle || stored.nextLessonTitle || '',
    badgesEarned    : [...earnedAfter],
    // faithStage is written on first update and never overwritten —
    // get-progress falls back to the member's stored profile faithStage
    // anyway, via shared/member-auth.js.
    faithStage      : stored.faithStage || faithStage || '',
    updatedAt       : new Date().toISOString(),
  };

  // ── Persist ───────────────────────────────────────────────────────────────
  // No TTL — progress records are permanent.
  try {
    await cmd('SET', `progress:${email}`, JSON.stringify(updated));
  } catch (err) {
    console.error('[update-progress] Redis write error:', err);
    return reply(500, { error: 'internal error' });
  }

  console.log(`[update-progress] ${email} — lesson ${lessonId} | streak ${streak} | total ${lessonsCompleted}`);

  return reply(200, {
    ok              : true,
    lessonsCompleted,
    streak,
    badgesEarned    : [...earnedAfter],
    newBadge,         // null if nothing newly unlocked
  });
};

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Returns "YYYY-MM-DD" in UTC for the given Date. */
function utcDateString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the number of calendar days between two "YYYY-MM-DD" strings.
 * Always positive (or zero).
 */
function daysDiff(a, b) {
  const msA = Date.UTC(...a.split('-').map(Number));
  const msB = Date.UTC(...b.split('-').map(Number));
  return Math.abs(Math.round((msB - msA) / 86_400_000));
}

// ── Response helper ───────────────────────────────────────────────────────────
function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  };
}
