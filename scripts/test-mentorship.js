#!/usr/bin/env node
/**
 * scripts/test-mentorship.js
 *
 * V2 PHASE 3 — Mentorship Foundation tests.
 *
 * Plain, dependency-free Node script (the repository has no test
 * framework — same approach as the other scripts/test-*.js files). Run:
 *
 *   node scripts/test-mentorship.js
 *
 * What is REAL in these tests: the actual Netlify Function handlers, the
 * actual shared/member-auth.js / admin-auth.js / mentor-store.js code, and
 * real HMAC-signed member_session / admin_session cookies built with the
 * same algorithms magic-login.js / admin-login.js use.
 *
 * What is FAKED: only @netlify/blobs, replaced (via require.cache) with an
 * in-memory multi-store fake that supports per-store read/write failure
 * injection — so storage-failure behavior can be tested deterministically
 * without a network or Netlify credentials.
 *
 * Every `check(...)` is one counted assertion; the script prints the exact
 * number executed.
 */

process.env.SESSION_SECRET = 'phase3-test-secret';

const crypto = require('crypto');
const path = require('path');

// ── Fake @netlify/blobs ──────────────────────────────────────────────────────
const stores = {}; // storeName -> Map(key -> JSON value)
const control = { failRead: new Set(), failWrite: new Set() };

function storeMap(name) { return (stores[name] = stores[name] || new Map()); }

const BLOBS_PATH = require.resolve('@netlify/blobs');
require.cache[BLOBS_PATH] = {
  id: BLOBS_PATH, filename: BLOBS_PATH, loaded: true,
  exports: {
    getStore: (opts) => {
      const name = typeof opts === 'string' ? opts : opts.name;
      return {
        async get(key) {
          if (control.failRead.has(name)) throw new Error(`Simulated read failure on ${name}`);
          const v = storeMap(name).get(key);
          return v === undefined ? null : JSON.parse(JSON.stringify(v));
        },
        async setJSON(key, data) {
          if (control.failWrite.has(name)) throw new Error(`Simulated write failure on ${name}`);
          storeMap(name).set(key, JSON.parse(JSON.stringify(data)));
          return { modified: true };
        },
        async list() {
          if (control.failRead.has(name)) throw new Error(`Simulated list failure on ${name}`);
          return { blobs: [...storeMap(name).keys()].map((key) => ({ key })) };
        },
      };
    },
  },
};

const fn = (n) => require(path.join(__dirname, '..', 'netlify', 'functions', n));
const applyForMentor = fn('apply-for-mentor.js').handler;
const mentorStatus = fn('mentor-status.js').handler;
const mentorProfile = fn('mentor-profile.js').handler;
const adminList = fn('admin-mentor-applications.js').handler;
const adminAction = fn('admin-mentor-application-action.js').handler;
const getWellbeing = fn('get-wellbeing-checkins.js').handler;
const memberMe = fn('member-me.js').handler;

// ── Helpers ──────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  ok   - ${label}`); }
  else { fail++; console.log(`  FAIL - ${label}`); }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function memberCookie(email, { expSeconds = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ email, firstName: 'T', lastName: 'M', faithStage: 'growing', iat: now, exp: now + expSeconds });
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`${h}.${p}`).digest('base64url');
  return `member_session=${h}.${p}.${sig}`;
}
function adminCookie({ expired = false, secret = process.env.SESSION_SECRET } = {}) {
  const payload = b64({ role: 'admin', exp: Date.now() + (expired ? -1000 : 3600_000) });
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `admin_session=${payload}.${sig}`;
}
const keyOf = (email) => Buffer.from(email.toLowerCase()).toString('base64url');

function ev(method, { cookie, body, query } = {}) {
  return { httpMethod: method, headers: cookie ? { cookie } : {}, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), queryStringParameters: query || {} };
}
async function call(handler, event) {
  const r = await handler(event);
  let parsed = null; try { parsed = JSON.parse(r.body); } catch { /* non-JSON */ }
  return { status: r.statusCode, body: parsed, raw: r.body };
}

function reset() {
  for (const k of Object.keys(stores)) delete stores[k];
  control.failRead.clear(); control.failWrite.clear();
}
function seedMember(email, extra = {}) {
  storeMap('members').set(keyOf(email), { email, firstName: 'First', lastName: 'Last', faithStage: 'growing', joinedISO: '2026-01-01T00:00:00.000Z', ...extra });
}
const memberRec = (email) => storeMap('members').get(keyOf(email));
const appRec = (email) => storeMap('mentor-applications').get(keyOf(email));
const profRec = (email) => storeMap('mentor-profiles').get(keyOf(email));
function seedMentor(email) {
  seedMember(email, { mentorStatus: 'mentor' });
  storeMap('mentor-applications').set(keyOf(email), { email, status: 'approved', motivation: 'm', availability: '', experience: '', areasOfInterest: [], submittedAt: 't', updatedAt: 't', reviewedAt: 't', reviewedBy: 'admin', reviewNote: null });
}

const A = 'alice@example.com';
const B = 'bob@example.com';
const VALID_APP = { motivation: 'I want to walk with people in their faith.', areasOfInterest: ['discipleship', 'prayer'], availability: 'Weekends', experience: 'Led a small group' };

async function main() {
  // ═════════════════ Authentication ═════════════════
  console.log('\n== Authentication: anonymous callers ==');
  reset(); seedMember(A);
  check('anonymous cannot apply (401)', (await call(applyForMentor, ev('POST', { body: VALID_APP }))).status === 401);
  check('anonymous cannot get mentor status (401)', (await call(mentorStatus, ev('GET'))).status === 401);
  check('anonymous cannot GET mentor profile (401)', (await call(mentorProfile, ev('GET'))).status === 401);
  check('anonymous cannot POST mentor profile (401)', (await call(mentorProfile, ev('POST', { body: { bio: 'x' } }))).status === 401);
  check('anonymous cannot list admin applications (401)', (await call(adminList, ev('GET'))).status === 401);
  check('anonymous cannot run admin action (401)', (await call(adminAction, ev('POST', { body: { email: A, action: 'approve' } }))).status === 401);
  check('no application was created by any anonymous attempt', !appRec(A));

  // ═════════════════ Identity ═════════════════
  console.log('\n== Identity: derived from the session only ==');
  reset(); seedMember(A); seedMember(B);
  {
    const r = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: { ...VALID_APP, email: B, memberId: B, member_id: B } }));
    check('apply succeeds for the authenticated member (201)', r.status === 201);
    check('application is stored under the SESSION member (A)', !!appRec(A));
    check('a submitted email/memberId cannot create an application for B', !appRec(B));
    check("B's mentorStatus is untouched", (memberRec(B).mentorStatus || 'member') === 'member');
    check("A's mentorStatus became mentor_pending", memberRec(A).mentorStatus === 'mentor_pending');
    const s = await call(mentorStatus, ev('GET', { cookie: memberCookie(B), query: { email: A, memberId: A } }));
    check("B's status request with ?email=A / ?memberId=A returns B's own status, not A's", s.status === 200 && s.body.status === 'member' && s.body.application === null);
  }

  // ═════════════════ Authorization ═════════════════
  console.log('\n== Authorization: mentor-only endpoint ==');
  reset(); seedMember(A);
  check('ordinary member GET profile → 403', (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
  check('ordinary member POST profile → 403', (await call(mentorProfile, ev('POST', { cookie: memberCookie(A), body: { bio: 'x' } }))).status === 403);
  check('403 POST wrote nothing', !profRec(A));
  seedMember(A, { mentorStatus: 'mentor_pending' });
  check('pending mentor GET profile → 403', (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
  check('pending mentor POST profile → 403', (await call(mentorProfile, ev('POST', { cookie: memberCookie(A), body: { bio: 'x' } }))).status === 403);
  seedMember(A, { mentorStatus: 'mentor_suspended' });
  check('suspended mentor GET profile → 403', (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
  check('suspended mentor POST profile → 403', (await call(mentorProfile, ev('POST', { cookie: memberCookie(A), body: { bio: 'x' } }))).status === 403);
  check('neither pending nor suspended POST wrote a profile', !profRec(A));
  seedMember(A, { mentorStatus: 'garbage-value' });
  check('an unrecognised mentorStatus value grants no access (403)', (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
  seedMentor(A);
  {
    const g = await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }));
    check('approved mentor GET profile → 200 (no profile yet → null)', g.status === 200 && g.body.profile === null);
    const p = await call(mentorProfile, ev('POST', { cookie: memberCookie(A), body: { displayName: 'Alice', bio: 'Hello', mentorshipAreas: ['prayer'], availability: 'Evenings' } }));
    check('approved mentor POST profile → 200', p.status === 200 && p.body.profile.displayName === 'Alice');
    const g2 = await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }));
    check('approved mentor reads back their own saved profile', g2.body.profile.bio === 'Hello');
    check('profile is linked to the canonical email, not a client field', profRec(A).email === A);
    check('invalid profile input → 400', (await call(mentorProfile, ev('POST', { cookie: memberCookie(A), body: { mentorshipAreas: ['not-a-real-area'] } }))).status === 400);
    check('oversized profile bio → 400', (await call(mentorProfile, ev('POST', { cookie: memberCookie(A), body: { bio: 'x'.repeat(5000) } }))).status === 400);
  }

  console.log('\n== Authorization: admin-only endpoints ==');
  reset(); seedMember(A, { mentorStatus: 'mentor_pending' }); seedMember(B);
  storeMap('mentor-applications').set(keyOf(A), { email: A, status: 'pending', motivation: 'm', availability: '', experience: '', areasOfInterest: [], submittedAt: 't', updatedAt: 't', reviewedAt: null, reviewedBy: null, reviewNote: null });
  {
    const before = JSON.stringify([memberRec(A), appRec(A)]);
    check('member session cannot list applications (401)', (await call(adminList, ev('GET', { cookie: memberCookie(B) }))).status === 401);
    check('member session cannot approve (401)', (await call(adminAction, ev('POST', { cookie: memberCookie(B), body: { email: A, action: 'approve' } }))).status === 401);
    check('a body adminEmail does not authenticate (401)', (await call(adminAction, ev('POST', { body: { email: A, action: 'approve', adminEmail: 'admin@tochristforchrist.org' } }))).status === 401);
    check('a member cookie presented as admin_session does not authenticate', (await call(adminAction, ev('POST', { cookie: memberCookie(B).replace('member_session', 'admin_session'), body: { email: A, action: 'approve' } }))).status === 401);
    check('admin cookie signed with the wrong secret is rejected (401)', (await call(adminAction, ev('POST', { cookie: adminCookie({ secret: 'wrong' }), body: { email: A, action: 'approve' } }))).status === 401);
    check('expired admin cookie is rejected (401)', (await call(adminAction, ev('POST', { cookie: adminCookie({ expired: true }), body: { email: A, action: 'approve' } }))).status === 401);
    check('non-admin cannot suspend (401)', (await call(adminAction, ev('POST', { cookie: memberCookie(B), body: { email: A, action: 'suspend' } }))).status === 401);
    check('none of the denied admin attempts changed any state', JSON.stringify([memberRec(A), appRec(A)]) === before);
  }

  // ═════════════════ Application ═════════════════
  console.log('\n== Application: validation, duplicates, isolation ==');
  reset(); seedMember(A); seedMember(B);
  {
    const bad = async (body, label) => {
      const r = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body }));
      check(label, r.status === 400);
    };
    await bad({ ...VALID_APP, motivation: '' }, 'missing motivation → 400');
    await bad({ ...VALID_APP, motivation: 'x'.repeat(5000) }, 'oversized motivation → 400');
    await bad({ ...VALID_APP, areasOfInterest: ['not-real'] }, 'unknown area → 400');
    await bad({ ...VALID_APP, areasOfInterest: ['prayer', 'men', 'women', 'other', 'discipleship', 'young_adults'] }, 'too many areas → 400');
    check('malformed JSON → 400', (await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: '{not json' }))).status === 400);
    check('no state written by any invalid application', !appRec(A) && (memberRec(A).mentorStatus || 'member') === 'member');

    const first = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: VALID_APP }));
    check('valid application → 201 and pending', first.status === 201 && first.body.application.status === 'pending');
    const submittedAt = appRec(A).submittedAt;
    const dup = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: { ...VALID_APP, motivation: 'Updated reasons' } }));
    check('duplicate application while pending is handled safely (200, updated in place)', dup.status === 200 && appRec(A).motivation === 'Updated reasons');
    check('resubmission keeps the original submittedAt and stays pending', appRec(A).submittedAt === submittedAt && appRec(A).status === 'pending');
    check('still exactly one application record', storeMap('mentor-applications').size === 1);

    const xss = await call(applyForMentor, ev('POST', { cookie: memberCookie(B), body: { ...VALID_APP, motivation: '<script>alert(1)</script>' } }));
    check('HTML in application text is escaped, not stored raw', xss.status === 201 && !appRec(B).motivation.includes('<script>'));
    check("B's application did not touch A's", appRec(A).motivation === 'Updated reasons');

    // a decided status is never silently reverted by re-applying
    seedMentor(A);
    const asMentor = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: VALID_APP }));
    check('approved mentor re-applying → 409', asMentor.status === 409);
    check('approved application not overwritten by the re-apply attempt', appRec(A).status === 'approved' && memberRec(A).mentorStatus === 'mentor');
    seedMember(A, { mentorStatus: 'mentor_suspended' });
    storeMap('mentor-applications').set(keyOf(A), { ...appRec(A), status: 'suspended' });
    const asSuspended = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: VALID_APP }));
    check('suspended mentor cannot re-apply around the suspension (409)', asSuspended.status === 409);
    check('suspended state unchanged after the attempt', memberRec(A).mentorStatus === 'mentor_suspended' && appRec(A).status === 'suspended');
  }

  console.log('\n== mentor-status reflects each lifecycle state ==');
  reset();
  for (const st of ['member', 'mentor_pending', 'mentor', 'mentor_suspended']) {
    seedMember(A, st === 'member' ? {} : { mentorStatus: st });
    const r = await call(mentorStatus, ev('GET', { cookie: memberCookie(A) }));
    check(`status '${st}' is reported correctly`, r.status === 200 && r.body.status === st);
  }

  // ═════════════════ Admin workflow ═════════════════
  console.log('\n== Admin workflow: list / approve / reject / suspend ==');
  reset(); seedMember(A); seedMember(B);
  await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: VALID_APP }));
  await call(applyForMentor, ev('POST', { cookie: memberCookie(B), body: VALID_APP }));
  const ADMIN = adminCookie();
  {
    const l = await call(adminList, ev('GET', { cookie: ADMIN }));
    check('admin sees both pending applications', l.status === 200 && l.body.applications.length === 2);
    check('admin list rejects an invalid status filter (400)', (await call(adminList, ev('GET', { cookie: ADMIN, query: { status: 'bogus' } }))).status === 400);

    const bad = await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: A, action: 'promote' } }));
    check('invalid action → 400', bad.status === 400);
    check('missing email → 400', (await call(adminAction, ev('POST', { cookie: ADMIN, body: { action: 'approve' } }))).status === 400);
    check('unknown member → 404', (await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: 'nobody@example.com', action: 'approve' } }))).status === 404);

    const ok = await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: A, action: 'approve', note: 'Welcome' } }));
    check('admin approve → 200', ok.status === 200);
    check('approval sets mentorStatus=mentor and application approved', memberRec(A).mentorStatus === 'mentor' && appRec(A).status === 'approved');
    check('approval preserves the rest of the member record', memberRec(A).firstName === 'First' && memberRec(A).faithStage === 'growing');
    check('approved member can now reach the mentor-only endpoint (200)', (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 200);
    check('approving B was not implied by approving A', memberRec(B).mentorStatus === 'mentor_pending');

    const rej = await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: B, action: 'reject' } }));
    check('admin reject → 200', rej.status === 200);
    check('rejection returns the member to ordinary member status', memberRec(B).mentorStatus === 'member' && appRec(B).status === 'rejected');
    check('rejected member still has no mentor access (403)', (await call(mentorProfile, ev('GET', { cookie: memberCookie(B) }))).status === 403);
    check('a rejected application cannot then be approved (409)', (await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: B, action: 'approve' } }))).status === 409);

    const sus = await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: A, action: 'suspend' } }));
    check('admin suspend → 200', sus.status === 200);
    check('suspension sets mentor_suspended and application suspended', memberRec(A).mentorStatus === 'mentor_suspended' && appRec(A).status === 'suspended');
    check('suspended mentor loses mentor access immediately (403)', (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
    check('suspend of a non-mentor → 409', (await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: B, action: 'suspend' } }))).status === 409);
    check('approve does not act as an unrequested reinstate for a suspended mentor (409)', (await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: A, action: 'approve' } }))).status === 409);
    check('suspended mentor is still suspended afterwards', memberRec(A).mentorStatus === 'mentor_suspended');

    seedMember('c@example.com');
    check('approve for a member who never applied → 404 (not a 500, not a silent create)', (await call(adminAction, ev('POST', { cookie: ADMIN, body: { email: 'c@example.com', action: 'approve' } }))).status === 404);
    check('no application was invented for that member', !appRec('c@example.com'));
  }

  // ═════════════════ Storage failure ═════════════════
  console.log('\n== Storage failure: fail closed, never an empty state / grant / overwrite ==');
  reset(); seedMentor(A);
  {
    control.failRead.add('members');
    const r1 = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: VALID_APP }));
    check('members read failure during apply → 500 (approved mentor not treated as ordinary member)', r1.status === 500);
    const s1 = await call(mentorStatus, ev('GET', { cookie: memberCookie(A) }));
    check("members read failure on mentor-status → 500, not a fake status 'member'", s1.status === 500 && !(s1.body && s1.body.status));
    const p1 = await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }));
    check('members read failure on mentor-profile → 500 (no 200, no fake profile)', p1.status === 500);
    control.failRead.clear();
    check('approved application untouched by the failed apply', appRec(A).status === 'approved' && appRec(A).motivation === 'm');
    check('mentor status untouched (no demotion)', memberRec(A).mentorStatus === 'mentor');
  }
  reset(); seedMember(A, { mentorStatus: 'mentor_pending' });
  storeMap('mentor-applications').set(keyOf(A), { email: A, status: 'pending', motivation: 'ORIGINAL', availability: '', experience: '', areasOfInterest: [], submittedAt: 't0', updatedAt: 't0', reviewedAt: null, reviewedBy: null, reviewNote: null });
  {
    control.failRead.add('mentor-applications');
    const s = await call(mentorStatus, ev('GET', { cookie: memberCookie(A) }));
    check('applications read failure on mentor-status → 500, not application:null', s.status === 500 && !(s.body && 'application' in s.body));
    const r = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: { ...VALID_APP, motivation: 'OVERWRITE' } }));
    check('applications read failure during resubmit → 500', r.status === 500);
    const l = await call(adminList, ev('GET', { cookie: adminCookie() }));
    check('applications read failure on admin list → 500, not an empty list', l.status === 500 && !(l.body && l.body.applications));
    const act = await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: A, action: 'approve' } }));
    check('applications read failure on admin approve → 500', act.status === 500);
    control.failRead.clear();
    check('existing pending application was not overwritten by any failed attempt', appRec(A).motivation === 'ORIGINAL' && appRec(A).status === 'pending');
    check('member was NOT promoted by the failed approve', memberRec(A).mentorStatus === 'mentor_pending');
    check('a member with a pending application has no mentor access after the failures (403)', (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
  }
  reset(); seedMember(A, { mentorStatus: 'mentor_pending' });
  storeMap('mentor-applications').set(keyOf(A), { email: A, status: 'pending', motivation: 'm', availability: '', experience: '', areasOfInterest: [], submittedAt: 't', updatedAt: 't', reviewedAt: null, reviewedBy: null, reviewNote: null });
  {
    // Half-completed approve: the application write lands, the member write fails.
    control.failWrite.add('members');
    const act = await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: A, action: 'approve' } }));
    control.failWrite.clear();
    check('member-record write failure during approve → 500', act.status === 500);
    check('no mentor permission was granted by the half-completed approve', memberRec(A).mentorStatus === 'mentor_pending' && (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
    const retry = await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: A, action: 'approve' } }));
    check('re-running the approve heals the half-completed state (200)', retry.status === 200 && memberRec(A).mentorStatus === 'mentor' && appRec(A).status === 'approved');
  }
  reset(); seedMentor(A);
  {
    // Suspend: the member-record write (which REVOKES access) happens first.
    control.failWrite.add('members');
    const r = await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: A, action: 'suspend' } }));
    control.failWrite.clear();
    check('member write failure during suspend → 500', r.status === 500);
    check('nothing was half-applied (application still approved, member still mentor)', appRec(A).status === 'approved' && memberRec(A).mentorStatus === 'mentor');
  }
  reset(); seedMentor(A);
  {
    // Suspend: member write succeeds, application write fails → access is already revoked (fails SAFE).
    control.failWrite.add('mentor-applications');
    const r = await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: A, action: 'suspend' } }));
    control.failWrite.clear();
    check('application write failure during suspend → 500', r.status === 500);
    check('mentor access is ALREADY revoked despite the half-completed suspend (fails safe)', memberRec(A).mentorStatus === 'mentor_suspended' && (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
    const retry = await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: A, action: 'suspend' } }));
    check('re-running the suspend heals the application record (200)', retry.status === 200 && appRec(A).status === 'suspended');
    check('suspending an already fully-suspended mentor is a 409', (await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: A, action: 'suspend' } }))).status === 409);
  }
  reset(); seedMember(A);
  {
    control.failWrite.add('members');
    const r = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: VALID_APP }));
    control.failWrite.clear();
    check('member write failure during first apply → 500', r.status === 500);
    check('member is not a mentor after the failed apply (no permission granted)', (memberRec(A).mentorStatus || 'member') === 'member' && (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).status === 403);
    const retry = await call(applyForMentor, ev('POST', { cookie: memberCookie(A), body: VALID_APP }));
    check('retrying the apply succeeds and reaches pending', retry.status === 201 && memberRec(A).mentorStatus === 'mentor_pending');
  }
  reset(); seedMentor(A);
  {
    control.failRead.add('mentor-profiles');
    const r = await call(mentorProfile, ev('POST', { cookie: memberCookie(A), body: { bio: 'new' } }));
    control.failRead.clear();
    check('profiles read failure during profile save → 500 (no blind overwrite)', r.status === 500 && !profRec(A));
  }

  // ═════════════════ Wellbeing separation ═════════════════
  console.log('\n== Wellbeing privacy: mentorship never grants access ==');
  reset(); seedMentor(A); seedMember(B);
  storeMap('wellbeing-checkins').set(keyOf(B), { email: B, entries: [{ id: 'wb-1', createdAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01', emotionalState: 'struggling', primaryConcern: 'grief', reflection: 'SECRET-WELLBEING-TEXT', supportPreference: 'keep_private', visibility: 'private' }] });
  storeMap('mentor-applications').set(keyOf(B), { email: B, status: 'pending', motivation: 'm', availability: '', experience: '', areasOfInterest: [], submittedAt: 't', updatedAt: 't', reviewedAt: null, reviewedBy: null, reviewNote: null });
  {
    const mentorView = await call(getWellbeing, ev('GET', { cookie: memberCookie(A), query: { email: B, memberId: B } }));
    check("an approved mentor requesting B's wellbeing (with ?email/?memberId) gets only their OWN (empty) history", mentorView.status === 200 && mentorView.body.entries.length === 0);
    check("B's private reflection is absent from the mentor's wellbeing response", !mentorView.raw.includes('SECRET-WELLBEING-TEXT'));
    check('an admin session alone cannot read wellbeing records (401)', (await call(getWellbeing, ev('GET', { cookie: adminCookie() }))).status === 401);
    const outputs = [
      (await call(adminList, ev('GET', { cookie: adminCookie(), query: { status: 'all' } }))).raw,
      (await call(mentorStatus, ev('GET', { cookie: memberCookie(A) }))).raw,
      (await call(mentorProfile, ev('GET', { cookie: memberCookie(A) }))).raw,
      (await call(adminAction, ev('POST', { cookie: adminCookie(), body: { email: B, action: 'approve' } }))).raw,
      (await call(memberMe, ev('GET', { cookie: memberCookie(A) }))).raw,
    ];
    check('no mentorship/admin-review/member-me response contains any wellbeing content', outputs.every((o) => !o.includes('SECRET-WELLBEING-TEXT')));
    check('approving an applicant did not touch or expose their wellbeing record', storeMap('wellbeing-checkins').get(keyOf(B)).entries[0].reflection === 'SECRET-WELLBEING-TEXT');
    check('member-me response shape is unchanged (no mentor/application fields leaked in)', !('mentorStatus' in JSON.parse(outputs[4]).member));
  }

  console.log(`\nPhase 3 (test-mentorship.js): ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('UNCAUGHT:', e); process.exit(1); });
