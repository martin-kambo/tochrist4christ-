/**
 * /.netlify/functions/get-admin-stats
 *
 * Aggregates lesson-level progress data from Redis for the admin dashboard.
 * Called in parallel with get-members after login; the admin page falls back
 * gracefully to member-record data if this function is unavailable.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * Requires the admin session cookie set by admin-login.
 * Returns 401 if not authenticated.
 *
 * ── Response (200) ───────────────────────────────────────────────────────────
 * {
 *   totalMembers     : number,
 *   activeStreaks     : number,   // members with a streak > 0 today
 *   avgCompletionPct : number,   // average overall lesson completion %
 *   computedAt       : string,   // ISO timestamp
 *
 *   modules: [
 *     {
 *       module      : 1 | 2 | 3,
 *       reachedOrPast: number,   // members at or past this module
 *       inProgress   : number,   // members currently in this module
 *       completed    : number,   // members who completed all lessons in module
 *       avgLessons   : number,   // avg lessons done by members in this module
 *       maxLessons   : 16 | 16 | 16  // lessons in this module (not cumulative)
 *     },
 *     ...
 *   ],
 *
 *   faithProgress: {
 *     just_starting: { count: number, avgPct: number },
 *     feeling_stuck: { count: number, avgPct: number },
 *     returning    : { count: number, avgPct: number },
 *     growing      : { count: number, avgPct: number },
 *   },
 * }
 *
 * ── Redis keys read ───────────────────────────────────────────────────────────
 *   member:*     (SCAN) → faithStage
 *   progress:*   (SCAN) → lessonsCompleted, streak, lastActivityDate, faithStage
 */

const { cmd, pipeline } = require('./_redis');

const TOTAL_LESSONS   = 48;
const MODULE_LESSONS  = 16;        // all three modules have 16 lessons each
// Cumulative thresholds: a member has *completed* module N when lessonsCompleted ≥ threshold
const MODULE_COMPLETE = [16, 32, 48];
const MODULE_START    = [0,  16, 32];  // module N starts after this many lessons

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' });
  }

  // ── Auth check (same cookie the rest of the admin functions use) ──────────
  try {
    const authRes = await fetch(
      `${process.env.URL || 'https://tochristforchrist.org'}/.netlify/functions/verify-auth`,
      { headers: { cookie: event.headers.cookie || '' } }
    );
    if (!authRes.ok) return reply(401, { error: 'Unauthorised' });
    const authData = await authRes.json();
    if (!authData.authenticated) return reply(401, { error: 'Unauthorised' });
  } catch (err) {
    // If verify-auth is unreachable (e.g. local dev), don't block
    console.warn('[get-admin-stats] Auth check failed, proceeding anyway:', err.message);
  }

  try {
    // ── Step 1: SCAN all progress:* keys ────────────────────────────────────
    const progressKeys = await scanKeys('progress:*');
    const memberKeys   = await scanKeys('member:*');

    if (progressKeys.length === 0) {
      return reply(200, emptyStats());
    }

    // ── Step 2: Batch GET all records in chunks of 50 ───────────────────────
    const progressRecords = await batchGet(progressKeys);
    const memberRecords   = await batchGet(memberKeys);

    // Build faithStage lookup: email → faithStage (member record is authoritative)
    const faithLookup = {};
    memberRecords.forEach(raw => {
      try {
        const m = JSON.parse(raw);
        if (m.email && m.faithStage) faithLookup[m.email.toLowerCase()] = m.faithStage;
      } catch {}
    });

    // ── Step 3: Parse and aggregate ─────────────────────────────────────────
    const today = utcMidnight(new Date());

    // Module stats accumulators
    const mods = [1, 2, 3].map(n => ({
      module      : n,
      reachedOrPast: 0,
      inProgress  : 0,
      completed   : 0,
      lessonSum   : 0,  // sum of lessons done by members *in* this module
      lessonCount : 0,  // number of members in this module (for avg)
      maxLessons  : MODULE_LESSONS,
    }));

    // Faith-progress accumulators
    const faithProgress = {
      just_starting: { count: 0, pctSum: 0 },
      feeling_stuck: { count: 0, pctSum: 0 },
      returning    : { count: 0, pctSum: 0 },
      growing      : { count: 0, pctSum: 0 },
    };

    let totalMembers    = 0;
    let activeStreaks    = 0;
    let completionPctSum = 0;

    for (const raw of progressRecords) {
      if (!raw) continue;
      let p;
      try { p = JSON.parse(raw); } catch { continue; }

      const done       = Math.min(Number(p.lessonsCompleted) || 0, TOTAL_LESSONS);
      const pct        = Math.round((done / TOTAL_LESSONS) * 100);
      const email      = (p.email || '').toLowerCase();
      const faithStage = faithLookup[email] || p.faithStage || '';

      totalMembers++;
      completionPctSum += pct;

      // Streak: active if last activity was today or yesterday
      if (p.streak > 0 && p.lastActivityDate) {
        const last     = utcMidnight(new Date(p.lastActivityDate));
        const diffDays = Math.round((today - last) / 86_400_000);
        if (diffDays <= 1) activeStreaks++;
      }

      // Determine current module (1-indexed)
      // Module 1: 0–15 lessons done, Module 2: 16–31, Module 3: 32–47, done: 48
      const currentMod = done >= 32 ? 3 : done >= 16 ? 2 : 1;
      const doneMod    = done >= 48 ? 3 : done >= 32 ? 2 : done >= 16 ? 1 : 0;
      //   doneMod = number of FULLY completed modules

      mods.forEach((m, idx) => {
        const modNum = idx + 1;
        if (done >= MODULE_START[idx]) {
          m.reachedOrPast++;
        }
        if (currentMod === modNum && done < TOTAL_LESSONS) {
          // Member is actively working in this module
          const lessonsIntoModule = done - MODULE_START[idx];
          m.inProgress++;
          m.lessonSum   += lessonsIntoModule;
          m.lessonCount++;
        }
        if (done >= MODULE_COMPLETE[idx]) {
          m.completed++;
        }
      });

      // Faith vs progress
      if (faithProgress[faithStage]) {
        faithProgress[faithStage].count++;
        faithProgress[faithStage].pctSum += pct;
      }
    }

    // Compute averages
    const computedMods = mods.map(m => ({
      module       : m.module,
      reachedOrPast: m.reachedOrPast,
      inProgress   : m.inProgress,
      completed    : m.completed,
      avgLessons   : m.lessonCount ? Math.round(m.lessonSum / m.lessonCount) : 0,
      maxLessons   : m.maxLessons,
    }));

    const faithProgressOut = {};
    for (const [stage, v] of Object.entries(faithProgress)) {
      faithProgressOut[stage] = {
        count  : v.count,
        avgPct : v.count ? Math.round(v.pctSum / v.count) : 0,
      };
    }

    return reply(200, {
      totalMembers,
      activeStreaks,
      avgCompletionPct: totalMembers ? Math.round(completionPctSum / totalMembers) : 0,
      computedAt      : new Date().toISOString(),
      modules         : computedMods,
      faithProgress   : faithProgressOut,
    });

  } catch (err) {
    console.error('[get-admin-stats] Error:', err);
    return reply(500, { error: 'internal error' });
  }
};

// ── Redis helpers ─────────────────────────────────────────────────────────────

/**
 * Full SCAN for all keys matching a pattern.
 * Uses cursor-based iteration so it works on any database size.
 */
async function scanKeys(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const result = await cmd('SCAN', cursor, 'MATCH', pattern, 'COUNT', '100');
    // Upstash returns [nextCursor, [keys...]]
    cursor = String(result[0]);
    if (Array.isArray(result[1])) keys.push(...result[1]);
  } while (cursor !== '0');
  return keys;
}

/**
 * GET all keys in batches of 50 (Upstash pipeline max is generous but we stay safe).
 * Returns an array of raw string values (nulls for missing keys).
 */
async function batchGet(keys, batchSize = 50) {
  const results = [];
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch   = keys.slice(i, i + batchSize);
    const cmds    = batch.map(k => ['GET', k]);
    const partial = await pipeline(...cmds);
    results.push(...partial);
  }
  return results;
}

function utcMidnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function emptyStats() {
  return {
    totalMembers    : 0,
    activeStreaks   : 0,
    avgCompletionPct: 0,
    computedAt      : new Date().toISOString(),
    modules         : [1,2,3].map(n => ({ module:n, reachedOrPast:0, inProgress:0, completed:0, avgLessons:0, maxLessons:16 })),
    faithProgress   : { just_starting:{count:0,avgPct:0}, feeling_stuck:{count:0,avgPct:0}, returning:{count:0,avgPct:0}, growing:{count:0,avgPct:0} },
  };
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  };
}