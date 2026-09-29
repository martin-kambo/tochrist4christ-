/**
 * /.netlify/functions/get-progress
 *
 * Returns the AUTHENTICATED CALLER's full course-progress snapshot,
 * including which modules are currently accessible based on their faith
 * stage and lesson history.
 *
 * V2 PHASE 1 SECURITY CHANGE — see TC4C_TECHNICAL_FINDINGS.md (C3) and
 * TC4C_V2_PHASE1_ARCHITECTURE.md:
 *   Previously this endpoint accepted an arbitrary `email` in a POST body
 *   as proof of identity, so anyone who knew or guessed a member's email
 *   could read that member's progress. It now:
 *     - requires a valid member_session cookie (see shared/member-auth.js)
 *     - derives the email SOLELY from that verified session
 *     - is now a GET request, since it no longer needs a body
 *     - returns 401 if there is no valid session
 *     - never accepts or trusts a client-supplied email/memberId
 *
 * This does not change the underlying Redis schema or the response shape
 * for an authenticated caller — only how the caller's identity is
 * established. Nothing in this repository currently calls this endpoint
 * in production (see TC4C_CURRENT_ARCHITECTURE.md §B), so this change
 * carries no risk to the live course experience, which still runs on its
 * own localStorage-based progress copy (course.html is intentionally left
 * untouched in this phase).
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * GET   (member_session cookie required; no body/query params needed)
 *
 * ── Response (200) ───────────────────────────────────────────────────────────
 * {
 *   lessonsCompleted : number,   // 0–48
 *   streak           : number,   // current consecutive-day streak
 *   currentModule    : number,   // 1 | 2 | 3
 *   nextLessonTitle  : string,
 *   badgesEarned     : string[], // e.g. ['foundation', 'word']
 *   moduleAccess     : number,   // highest module number the member may enter
 *   faithStage       : string,   // echoed back so the client can re-derive access
 * }
 *
 * ── Module access model (unchanged from the original design) ──────────────────
 *
 *   Faith-stage initial grant (day-1 access regardless of lesson count):
 *     just_starting → 1   New to faith; begin at Foundation
 *     feeling_stuck → 1   Been a Christian but feeling stuck; begin at Foundation
 *     returned      → 1   Returning believer; restart from Foundation
 *     growing       → 3   Seasoned; all three modules open immediately
 *
 *   Progress-based unlock (earned by completing lessons):
 *     0–15  completed → 1
 *     16–31 completed → 2
 *     32+   completed → 3
 *
 *   Effective access = max(faith-stage grant, progress-based unlock)
 *   Faith stage can only ADD access, never reduce it.
 *
 * ── Redis keys read ───────────────────────────────────────────────────────────
 *   progress:<email>   written by update-progress (email now from session)
 *   member:<email>     NOTE: nothing in this codebase writes this key today
 *                       (see TC4C_CURRENT_DATA_MODEL.md §Progress) — faithStage
 *                       is read from the Blobs "members" record instead, via
 *                       shared/member-auth.js's getAuthenticatedMember().
 */

const { cmd, pipeline } = require('./redis');
const { getAuthenticatedMember } = require('./shared/member-auth');

const TOTAL_LESSONS = 48;

// V2 PHASE 2 — this must match course.html's own authoritative
// FAITH_STAGE_ACCESS map exactly (course.html is the canonical source for
// this mapping, since it's the member-facing rule). A Phase-1 review found
// `returning` was set to 1 here, while course.html has always granted it
// initialUnlock: 2 — corrected as part of the Phase 2 reconciliation pass;
// see TC4C_V2_PHASE2_ARCHITECTURE.md §"Faith stage".
const FAITH_STAGE_ACCESS = {
  just_starting: 1,
  feeling_stuck: 1,
  returning    : 2,
  growing      : 3,
};

const BADGE_THRESHOLDS = {
  foundation: 16,
  word      : 32,
  prayer    : 40,
  identity  : 48,
};

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });

  // ── Authenticate: identity comes ONLY from the verified session ───────────
  let member;
  try {
    member = await getAuthenticatedMember(event);
  } catch (err) {
    console.error('[get-progress] Auth check error:', err.message);
    return reply(500, { error: 'internal error' });
  }
  if (!member) return reply(401, { error: 'Unauthorized' });

  const email = member.email;
  const faithStage = member.faithStage || '';

  // ── Fetch progress from Redis ──────────────────────────────────────────────
  let progressRaw;
  try {
    ([progressRaw] = await pipeline(['GET', `progress:${email}`]));
  } catch (err) {
    console.error('[get-progress] Redis error:', err);
    return reply(500, { error: 'internal error' });
  }

  // ── Brand-new member — nothing recorded yet ──────────────────────────────
  if (!progressRaw) {
    return reply(200, {
      ...zeroState(),
      moduleAccess: FAITH_STAGE_ACCESS[faithStage] || 1,
      faithStage,
    });
  }

  // ── Parse stored progress ────────────────────────────────────────────────
  let stored = {};
  try { stored = JSON.parse(progressRaw); }
  catch {
    console.error('[get-progress] Corrupt progress record for', email);
    return reply(200, { ...zeroState(), moduleAccess: 1, faithStage });
  }

  // ── Derived fields ───────────────────────────────────────────────────────
  const lessonsCompleted = Math.min(Number(stored.lessonsCompleted) || 0, TOTAL_LESSONS);
  const streak           = resolveStreak(stored);
  const currentModule    = moduleFromLessons(lessonsCompleted);
  const nextLessonTitle  = stored.nextLessonTitle || defaultNextLesson(lessonsCompleted);
  const badgesEarned     = computeBadges(lessonsCompleted, stored.badgesEarned);

  // Effective module access = max(faith-stage day-1 grant, progress-based unlock)
  const faithGrant     = FAITH_STAGE_ACCESS[faithStage] || 1;
  const progressUnlock = lessonsCompleted >= 32 ? 3 : lessonsCompleted >= 16 ? 2 : 1;
  const moduleAccess   = Math.max(faithGrant, progressUnlock);

  // Opportunistically reset a stale streak (async, doesn't block the response)
  if (streak === 0 && Number(stored.streak) > 0) {
    resetStaleStreak(email, stored).catch(err =>
      console.warn('[get-progress] Stale streak reset failed:', err)
    );
  }

  return reply(200, {
    completedIds: Array.isArray(stored.completedIds) ? stored.completedIds : [], // V2 PHASE 2 — for course.html's merge logic
    lessonsCompleted,
    streak,
    currentModule,
    nextLessonTitle,
    badgesEarned,
    moduleAccess,
    faithStage,
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function zeroState() {
  return {
    completedIds    : [], // V2 PHASE 2 — needed by course.html's migration/merge logic
    lessonsCompleted: 0,
    streak          : 0,
    currentModule   : 1,
    nextLessonTitle : 'Identity: Who Are You in Christ?',
    badgesEarned    : [],
  };
}

function resolveStreak(stored) {
  if (!stored.lastActivityDate) return 0;
  const diffDays = Math.round(
    (utcMidnight(new Date()) - utcMidnight(new Date(stored.lastActivityDate))) / 86_400_000
  );
  return diffDays <= 1 ? (Number(stored.streak) || 0) : 0;
}

function utcMidnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function moduleFromLessons(n) {
  if (n < 16) return 1;
  if (n < 32) return 2;
  return 3;
}

function defaultNextLesson(n) {
  if (n === 0) return 'Identity: Who Are You in Christ?';
  if (n < 16)  return 'Foundations of a Disciplined Prayer Life';
  if (n < 32)  return 'Rightly Dividing the Word of Truth';
  if (n < 48)  return 'Walking in the Spirit Daily';
  return '🎉 Course complete — well done!';
}

function computeBadges(lessonsCompleted, storedBadges) {
  const earned = new Set(Array.isArray(storedBadges) ? storedBadges : []);
  for (const [id, threshold] of Object.entries(BADGE_THRESHOLDS)) {
    if (lessonsCompleted >= threshold) earned.add(id);
  }
  return [...earned];
}

async function resetStaleStreak(email, stored) {
  const updated = JSON.stringify({ ...stored, streak: 0 });
  const ttl     = await cmd('TTL', `progress:${email}`);
  await cmd('SET', `progress:${email}`, updated, 'EX', ttl > 0 ? ttl : 60 * 60 * 24 * 730);
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body   : JSON.stringify(body),
  };
}
