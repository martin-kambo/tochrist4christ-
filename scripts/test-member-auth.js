#!/usr/bin/env node
/**
 * scripts/test-member-auth.js
 *
 * V2 PHASE 1 — Manual verification script for the canonical member-auth
 * helper (netlify/functions/shared/member-auth.js) and the wellbeing
 * input validator (netlify/functions/shared/wellbeing-store.js).
 *
 * The repository has no existing test framework/runner (no Jest/Mocha in
 * either package.json, no test directory) — see TC4C_V2_PHASE1_CHANGELOG.md
 * for that decision. Rather than introduce a new dependency, this is a
 * plain, dependency-free Node script that exercises the security-critical
 * logic directly. Run with:
 *
 *   node scripts/test-member-auth.js
 *
 * It sets its own throwaway SESSION_SECRET for the duration of the run and
 * does not touch any real environment, network, or Netlify Blobs store —
 * @netlify/blobs calls inside getAuthenticatedMember() are expected to
 * fail in this offline context, and the helper is specifically designed
 * to fall back gracefully (session-only identity) when that happens, so
 * this script also doubles as a check of that fallback behavior.
 */

process.env.SESSION_SECRET = 'test-secret-for-phase1-verification-only';

const crypto = require('crypto');
const path = require('path');

const {
  getSessionUser,
  getAuthenticatedMember,
} = require(path.join(__dirname, '..', 'netlify', 'functions', 'shared', 'member-auth.js'));

const {
  validateCheckInInput,
  EMOTIONAL_STATES,
  PRIMARY_CONCERNS,
  SUPPORT_PREFERENCES,
} = require(path.join(__dirname, '..', 'netlify', 'functions', 'shared', 'wellbeing-store.js'));

let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) {
    pass++;
    console.log(`  ok   - ${label}`);
  } else {
    fail++;
    console.log(`  FAIL - ${label}`);
  }
}

// ── Helpers to build test JWTs, mirroring magic-login.js's createJWT() ───────
function makeJWT({ email, firstName = 'Test', lastName = 'Member', faithStage = 'just_starting', expiresInSeconds = 30 * 24 * 60 * 60, secret = process.env.SESSION_SECRET }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { email, firstName, lastName, faithStage, iat: now, exp: now + expiresInSeconds };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

function eventWithCookie(token) {
  return { headers: { cookie: token ? `member_session=${token}` : '' } };
}

async function main() {
  console.log('\n== shared/member-auth.js ==');

  // 1. Valid, unexpired token → authenticated with correct email
  {
    const token = makeJWT({ email: 'Believer@Example.com' });
    const session = getSessionUser(eventWithCookie(token));
    check('valid token authenticates', !!session);
    check('email is lowercased/normalized', session && session.email === 'believer@example.com');
  }

  // 2. No cookie at all → null (not an error, not "authenticated")
  {
    const session = getSessionUser(eventWithCookie(null));
    check('missing cookie → null (fail closed)', session === null);
  }

  // 3. Tampered payload (changed email, signature no longer matches) → rejected
  {
    const token = makeJWT({ email: 'victim@example.com' });
    const [h, p, s] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
      email: 'attacker@example.com',
    })).toString('base64url');
    const forgedToken = `${h}.${forgedPayload}.${s}`; // old signature, new payload
    const session = getSessionUser(eventWithCookie(forgedToken));
    check('tampered payload with stale signature → rejected', session === null);
  }

  // 4. Expired token → rejected
  {
    const token = makeJWT({ email: 'expired@example.com', expiresInSeconds: -10 });
    const session = getSessionUser(eventWithCookie(token));
    check('expired token → rejected', session === null);
  }

  // 5. Wrong secret (e.g. forged with a guessed key) → rejected
  {
    const token = makeJWT({ email: 'forger@example.com', secret: 'wrong-secret' });
    const session = getSessionUser(eventWithCookie(token));
    check('token signed with wrong secret → rejected', session === null);
  }

  // 6. getAuthenticatedMember falls back gracefully with no live Blobs access
  {
    const token = makeJWT({ email: 'nofallback@example.com', firstName: 'Grace' });
    const member = await getAuthenticatedMember(eventWithCookie(token));
    check('getAuthenticatedMember still returns identity without live Blobs', !!member);
    check('falls back to JWT firstName when profile lookup unavailable', member && member.firstName === 'Grace');
  }

  // 7. getAuthenticatedMember with no session → null (never throws)
  {
    const member = await getAuthenticatedMember(eventWithCookie(null));
    check('getAuthenticatedMember with no session → null', member === null);
  }

  console.log('\n== shared/wellbeing-store.js — validateCheckInInput ==');

  // 8. Valid input passes
  {
    const result = validateCheckInInput({
      emotionalState: EMOTIONAL_STATES[0],
      primaryConcern: PRIMARY_CONCERNS[0],
      supportPreference: SUPPORT_PREFERENCES[0],
      reflection: 'Feeling grateful today.',
    });
    check('valid check-in input is accepted', result.ok === true);
  }

  // 9. Invalid enum value rejected
  {
    const result = validateCheckInInput({
      emotionalState: 'ecstatic', // not a real option
      primaryConcern: PRIMARY_CONCERNS[0],
      supportPreference: SUPPORT_PREFERENCES[0],
      reflection: '',
    });
    check('invalid emotionalState is rejected', result.ok === false);
  }

  // 10. Oversized reflection rejected
  {
    const result = validateCheckInInput({
      emotionalState: EMOTIONAL_STATES[0],
      primaryConcern: PRIMARY_CONCERNS[0],
      supportPreference: SUPPORT_PREFERENCES[0],
      reflection: 'x'.repeat(5000),
    });
    check('reflection over the length limit is rejected', result.ok === false);
  }

  // 11. HTML in reflection is escaped, not executed/stored raw
  {
    const result = validateCheckInInput({
      emotionalState: EMOTIONAL_STATES[0],
      primaryConcern: PRIMARY_CONCERNS[0],
      supportPreference: SUPPORT_PREFERENCES[0],
      reflection: '<script>alert(1)</script>',
    });
    check(
      'reflection HTML is escaped',
      result.ok === true && !result.value.reflection.includes('<script>')
    );
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
