// netlify/functions/shared/mentor-store.js
//
// V2 PHASE 3 — Mentor application + mentor profile storage and validation.
//
// Two separate Netlify Blobs stores, each keyed by base64url(lowercase
// email) — the same consistent key encoding "members"/"magic-tokens"/
// "wellbeing-checkins" already use (never the inconsistent raw-email key
// the older "daily-engagement" store uses — see
// TC4C_TECHNICAL_FINDINGS.md H7 — new stores keep following the
// consistent convention):
//
//   "mentor-applications" — one record per member who has ever applied.
//     Reviewed only by admins (see shared/admin-auth.js). Never exposed to
//     other members. Contains the applicant's own submitted content
//     (motivation, areas of interest, availability, experience) plus the
//     review trail (status, reviewedAt, reviewNote).
//
//   "mentor-profiles" — one record per APPROVED mentor only, created the
//     first time an approved mentor saves their own profile. Deliberately
//     a separate store from applications (not just a different field on
//     the same record): a mentor's public-ish profile (once Phase 4 shows
//     it to an assigned mentee) should never carry the original
//     application's "why I want to do this" content — keeping them
//     separate now avoids a data-migration/redaction problem later.
//
// Both follow the SAME fail-closed read pattern already established and
// tested in shared/wellbeing-store.js (see its own doc comment / the
// Phase 1 "wellbeing storage integrity fix" for why): a missing key
// resolves to a well-formed empty/absent value; any other read failure
// THROWS rather than being mistaken for "nothing here." A storage failure
// must never silently grant mentor status, approve an application, or
// discard an existing one.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const APPLICATIONS_STORE = 'mentor-applications';
const PROFILES_STORE = 'mentor-profiles';

const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];
const MENTOR_ACTIONS = ['approve', 'reject', 'suspend'];

// Deliberately small and non-clinical — see Phase 3 brief §6: this is not
// a counselling intake form.
const MENTORSHIP_AREAS = [
  'discipleship', 'prayer', 'life_challenges', 'young_adults',
  'marriage_family', 'men', 'women', 'other',
];

const MAX_TEXT_FIELD = 800; // motivation / experience / bio / availability
const MAX_AREAS = 5;
const MAX_REVIEW_NOTE = 500;

function blobsStore(name) {
  const opts = { name };
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

// ── Application validation ───────────────────────────────────────────────────

/**
 * Validates a raw mentor-application submission. Only collects what's
 * genuinely needed at this stage (Phase 3 brief §6) — no diagnoses,
 * medical history, trauma history, or third-party information is asked
 * for or accepted here; this is a plain-text intake, not a clinical form.
 */
function validateApplicationInput(body) {
  const motivation = String(body?.motivation || '').trim();
  const availability = String(body?.availability || '').trim();
  const experience = String(body?.experience || '').trim();
  const areasOfInterest = Array.isArray(body?.areasOfInterest) ? body.areasOfInterest : [];

  if (!motivation) {
    return { ok: false, error: 'motivation is required' };
  }
  if (motivation.length > MAX_TEXT_FIELD || availability.length > MAX_TEXT_FIELD || experience.length > MAX_TEXT_FIELD) {
    return { ok: false, error: `motivation, availability, and experience must each be ${MAX_TEXT_FIELD} characters or fewer` };
  }
  if (areasOfInterest.length > MAX_AREAS) {
    return { ok: false, error: `areasOfInterest may include at most ${MAX_AREAS} values` };
  }
  const validAreas = areasOfInterest.filter((a) => MENTORSHIP_AREAS.includes(a));
  if (validAreas.length !== areasOfInterest.length) {
    return { ok: false, error: `areasOfInterest must only contain: ${MENTORSHIP_AREAS.join(', ')}` };
  }

  return {
    ok: true,
    value: {
      motivation: escapeHtml(motivation).slice(0, MAX_TEXT_FIELD),
      availability: escapeHtml(availability).slice(0, MAX_TEXT_FIELD),
      experience: escapeHtml(experience).slice(0, MAX_TEXT_FIELD),
      areasOfInterest: validAreas,
    },
  };
}

/** Same fail-closed contract as shared/wellbeing-store.js's getRecord(). */
async function getApplication(email) {
  const store = blobsStore(APPLICATIONS_STORE);
  const record = await store.get(keyFor(email), { type: 'json' });
  return record || null; // null is a valid, expected "never applied" state — not an error
}

/**
 * Creates a brand-new pending application, or updates the content of an
 * application that is still pending (the same member editing/resubmitting
 * before review — safe, since nothing has been decided yet). Does NOT
 * touch an application that has already been approved/rejected/suspended
 * — callers (apply-for-mentor.js) are responsible for checking the
 * member's current mentorStatus before calling this, so a decided status
 * is never silently reverted by a new submission.
 */
async function upsertPendingApplication(email, validated) {
  const store = blobsStore(APPLICATIONS_STORE);
  const key = keyFor(email);
  const existing = await getApplication(email); // throws on a genuine read failure — never masked
  const now = new Date().toISOString();

  const record = {
    email: email.toLowerCase(),
    status: 'pending',
    motivation: validated.motivation,
    availability: validated.availability,
    experience: validated.experience,
    areasOfInterest: validated.areasOfInterest,
    submittedAt: existing ? existing.submittedAt : now, // preserve original submission time on resubmit
    updatedAt: now,
    reviewedAt: existing ? existing.reviewedAt : null,
    reviewedBy: existing ? existing.reviewedBy : null,
    reviewNote: existing ? existing.reviewNote : null,
  };

  await store.setJSON(key, record);
  return record;
}

/**
 * Admin action on an existing application. Throws if no application
 * exists for that email (an admin cannot "approve" someone who never
 * applied) or on a genuine read failure — never silently creates one.
 */
async function setApplicationStatus(email, status, reviewNote) {
  const store = blobsStore(APPLICATIONS_STORE);
  const key = keyFor(email);
  const existing = await getApplication(email);
  if (!existing) {
    throw new Error(`setApplicationStatus: no application exists for ${email}`);
  }
  const record = {
    ...existing,
    status,
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'admin', // the existing admin system has one shared identity, not per-admin accounts — see architecture doc
    reviewNote: reviewNote ? escapeHtml(String(reviewNote).slice(0, MAX_REVIEW_NOTE)) : existing.reviewNote,
  };
  await store.setJSON(key, record);
  return record;
}

/** Lists all applications — admin-only caller (enforced by the function, not here). */
async function listApplications() {
  const store = blobsStore(APPLICATIONS_STORE);
  const { blobs } = await store.list();
  const records = await Promise.all(
    blobs.map(({ key }) => store.get(key, { type: 'json' }))
  );
  return records.filter(Boolean);
}

// ── Mentor profile validation ────────────────────────────────────────────────

function validateProfileInput(body) {
  const displayName = String(body?.displayName || '').trim();
  const bio = String(body?.bio || '').trim();
  const availability = String(body?.availability || '').trim();
  const mentorshipAreas = Array.isArray(body?.mentorshipAreas) ? body.mentorshipAreas : [];

  if (displayName.length > 100) {
    return { ok: false, error: 'displayName must be 100 characters or fewer' };
  }
  if (bio.length > MAX_TEXT_FIELD || availability.length > MAX_TEXT_FIELD) {
    return { ok: false, error: `bio and availability must each be ${MAX_TEXT_FIELD} characters or fewer` };
  }
  if (mentorshipAreas.length > MAX_AREAS) {
    return { ok: false, error: `mentorshipAreas may include at most ${MAX_AREAS} values` };
  }
  const validAreas = mentorshipAreas.filter((a) => MENTORSHIP_AREAS.includes(a));
  if (validAreas.length !== mentorshipAreas.length) {
    return { ok: false, error: `mentorshipAreas must only contain: ${MENTORSHIP_AREAS.join(', ')}` };
  }

  return {
    ok: true,
    value: {
      displayName: escapeHtml(displayName).slice(0, 100),
      bio: escapeHtml(bio).slice(0, MAX_TEXT_FIELD),
      availability: escapeHtml(availability).slice(0, MAX_TEXT_FIELD),
      mentorshipAreas: validAreas,
    },
  };
}

/** Same fail-closed contract as getApplication() above. */
async function getProfile(email) {
  const store = blobsStore(PROFILES_STORE);
  const record = await store.get(keyFor(email), { type: 'json' });
  return record || null;
}

async function upsertProfile(email, validated) {
  const store = blobsStore(PROFILES_STORE);
  const key = keyFor(email);
  const existing = await getProfile(email); // throws on a genuine read failure
  const now = new Date().toISOString();
  const record = {
    email: email.toLowerCase(),
    displayName: validated.displayName,
    bio: validated.bio,
    availability: validated.availability,
    mentorshipAreas: validated.mentorshipAreas,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  await store.setJSON(key, record);
  return record;
}

module.exports = {
  APPLICATION_STATUSES,
  MENTOR_ACTIONS,
  MENTORSHIP_AREAS,
  MAX_TEXT_FIELD,
  validateApplicationInput,
  getApplication,
  upsertPendingApplication,
  setApplicationStatus,
  listApplications,
  validateProfileInput,
  getProfile,
  upsertProfile,
};

// Not a callable endpoint — same guard pattern as the other shared/ helpers.
exports.handler = async () => ({
  statusCode: 404,
  body: JSON.stringify({ error: 'Not a callable endpoint.' }),
});
