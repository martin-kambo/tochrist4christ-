// netlify/functions/shared/wellbeing-store.js
//
// V2 PHASE 1 — Wellbeing check-in storage + validation.
//
// This is a DISTINCT data model from the existing daily-engagement
// journal (see TC4C_TECHNICAL_FINDINGS.md and Part H of the Phase 1
// brief): wellbeing check-ins are never written into
// daily-engagement.journalEntries. They live in their own Blobs store so
// that a future mentor-visibility model can be layered onto THIS store
// without touching the existing daily-engagement data at all.
//
// Storage: Netlify Blobs, store "wellbeing-checkins",
//          key = base64url(lowercase email)  — the SAME key encoding the
//          "members"/"magic-tokens" stores use, unlike the inconsistent
//          raw-email key the older daily-engagement store uses (see
//          TC4C_TECHNICAL_FINDINGS.md H7). New stores introduced in this
//          phase use the consistent encoding going forward.
//
// Record shape (one Blobs object per member):
//   {
//     email: string,
//     entries: [
//       {
//         id: 'wb-<uuid>',
//         createdAt: ISO timestamp,
//         date: 'YYYY-MM-DD' (UTC, derived from createdAt),
//         emotionalState: one of EMOTIONAL_STATES,
//         primaryConcern: one of PRIMARY_CONCERNS,
//         reflection: string (HTML-escaped, bounded length) | '',
//         supportPreference: one of SUPPORT_PREFERENCES,
//         visibility: 'private'   — see note below; this is the ONLY
//                     value this phase ever writes, regardless of what a
//                     caller sends.
//       },
//       ...
//     ]
//   }
//
// IMPORTANT — visibility vs. supportPreference are different things:
//   `supportPreference` is what the member says they'd *like* (e.g. "I'd
//   like to talk to someone") — it is descriptive content the member
//   expresses, and in this phase it does not trigger any notification or
//   routing, because no mentor/staff workflow exists yet (see Part J/K of
//   the Phase 1 brief and the safety copy in wellbeing.html).
//   `visibility` is the actual access-control field. This phase supports
//   and writes ONLY 'private'. Future phases may introduce values such as
//   'shared_with_mentor', but implementing that access model is
//   explicitly out of scope here — see TC4C_V2_PHASE1_ARCHITECTURE.md.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'wellbeing-checkins';

const EMOTIONAL_STATES = ['struggling', 'not_great', 'okay', 'good', 'doing_well'];

const PRIMARY_CONCERNS = [
  'faith', 'family', 'relationships', 'work', 'school', 'finances',
  'loneliness', 'stress', 'grief', 'purpose', 'other', 'prefer_not_to_say',
];

const SUPPORT_PREFERENCES = [
  'keep_private', 'encouragement', 'talk_to_someone', 'resources',
];

const MAX_REFLECTION_LENGTH = 1000;

function blobsStore() {
  const opts = { name: STORE_NAME };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

function keyFor(email) {
  return Buffer.from(String(email).toLowerCase().trim()).toString('base64url');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function utcDateString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Validates a raw check-in submission. Returns { ok: true, value } or
 * { ok: false, error }. Never trusts a client-supplied visibility value —
 * that is fixed to 'private' by buildEntry(), not by the client.
 */
function validateCheckInInput(body) {
  const emotionalState = String(body?.emotionalState || '').trim();
  const primaryConcern = String(body?.primaryConcern || '').trim();
  const supportPreference = String(body?.supportPreference || '').trim();
  const reflectionRaw = body?.reflection == null ? '' : String(body.reflection);

  if (!EMOTIONAL_STATES.includes(emotionalState)) {
    return { ok: false, error: `emotionalState must be one of: ${EMOTIONAL_STATES.join(', ')}` };
  }
  if (!PRIMARY_CONCERNS.includes(primaryConcern)) {
    return { ok: false, error: `primaryConcern must be one of: ${PRIMARY_CONCERNS.join(', ')}` };
  }
  if (!SUPPORT_PREFERENCES.includes(supportPreference)) {
    return { ok: false, error: `supportPreference must be one of: ${SUPPORT_PREFERENCES.join(', ')}` };
  }
  if (reflectionRaw.length > MAX_REFLECTION_LENGTH) {
    return { ok: false, error: `reflection must be ${MAX_REFLECTION_LENGTH} characters or fewer` };
  }

  return {
    ok: true,
    value: {
      emotionalState,
      primaryConcern,
      supportPreference,
      reflection: escapeHtml(reflectionRaw.trim()).slice(0, MAX_REFLECTION_LENGTH),
    },
  };
}

function buildEntry(validated) {
  const now = new Date();
  return {
    id: 'wb-' + crypto.randomUUID(),
    createdAt: now.toISOString(),
    date: utcDateString(now),
    emotionalState: validated.emotionalState,
    primaryConcern: validated.primaryConcern,
    reflection: validated.reflection,
    supportPreference: validated.supportPreference,
    visibility: 'private', // hardcoded — see note above; not client-controlled
  };
}

/** Reads the full record for a member (never for anyone else). */
/**
 * Reads the full record for a member (never for anyone else).
 *
 * FIX — Wellbeing Storage Integrity (see TC4C_V2_PHASE1_CHANGELOG.md):
 * This function must distinguish "this member has no record yet" from
 * "the read failed." Those are not the same thing, and treating them the
 * same was the bug: a transient Blobs failure could previously look
 * identical to a brand-new member, which meant appendEntry() could go on
 * to write a fresh, empty record over an existing one, silently
 * discarding real check-in history, and get-wellbeing-checkins.js could
 * report "no check-ins" when the true state was "couldn't read."
 *
 * The fix relies on @netlify/blobs' own documented contract, confirmed
 * directly against the installed package source for both versions this
 * repository declares (@netlify/blobs 8.1.0 in netlify/functions/package.json
 * and 10.7.4 in the root package.json — both resolve identically):
 *   - a missing key resolves the read to `null` (HTTP 404) — this is the
 *     normal, expected shape of "no record yet," not an error.
 *   - any other failure (a non-2xx/non-404 response, a network error, or
 *     malformed stored JSON when reading with { type: 'json' }) REJECTS
 *     the promise.
 * This function no longer catches that rejection — it lets it propagate,
 * so a caller (appendEntry, or a function calling getRecord directly)
 * fails closed instead of quietly treating a failure as "nothing here."
 * Only a genuine, successful-but-empty read produces the empty-record
 * default below.
 */
async function getRecord(email) {
  const store = blobsStore();
  const record = await store.get(keyFor(email), { type: 'json' });
  return record || { email: email.toLowerCase(), entries: [] };
}

/**
 * Appends a new, already-validated entry to a member's record.
 *
 * Relies on getRecord() above failing closed: if the existing record
 * can't be read, `await getRecord(email)` throws here, this function
 * never reaches record.entries.push(...) or store.setJSON(...), and no
 * write happens. This was already structurally true before the Wellbeing
 * Storage Integrity fix; what changed is that getRecord() now actually
 * throws instead of masking the failure as an empty record.
 */
async function appendEntry(email, validated) {
  const store = blobsStore();
  const key = keyFor(email);
  const record = await getRecord(email);
  const entry = buildEntry(validated);
  record.email = email.toLowerCase();
  record.entries = Array.isArray(record.entries) ? record.entries : [];
  record.entries.push(entry);
  await store.setJSON(key, record);
  return entry;
}

module.exports = {
  EMOTIONAL_STATES,
  PRIMARY_CONCERNS,
  SUPPORT_PREFERENCES,
  MAX_REFLECTION_LENGTH,
  validateCheckInInput,
  getRecord,
  appendEntry,
};

// Not a callable endpoint — same guard pattern as shared/netlify.js and
// shared/member-auth.js.
exports.handler = async () => ({
  statusCode: 404,
  body: JSON.stringify({ error: 'Not a callable endpoint.' }),
});
