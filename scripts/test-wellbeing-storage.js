#!/usr/bin/env node
/**
 * scripts/test-wellbeing-storage.js
 *
 * Regression tests for the WELLBEING STORAGE INTEGRITY FIX — see the
 * "Wellbeing storage integrity fix" entry in TC4C_V2_PHASE1_CHANGELOG.md.
 *
 * Invariant under test:
 *   A storage/read failure must never be converted into an empty
 *   wellbeing record, and must never result in an overwrite of existing
 *   wellbeing history.
 *
 * Like scripts/test-member-auth.js, this is a plain, dependency-free Node
 * script (no Jest/Mocha — the repository has no existing test framework).
 * Run with:
 *
 *   node scripts/test-wellbeing-storage.js
 *
 * It mocks @netlify/blobs at the require-cache level (no real network,
 * no real Netlify Blobs store touched) so it can deterministically
 * simulate: no record yet, an existing record, and a genuine read
 * failure — the three cases getRecord() must tell apart.
 */

const path = require('path');
const assert = require('assert');

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

async function checkThrows(label, fn) {
  try {
    await fn();
    fail++;
    console.log(`  FAIL - ${label} (expected a rejection, got a resolved value)`);
  } catch {
    pass++;
    console.log(`  ok   - ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Mock @netlify/blobs so shared/wellbeing-store.js's blobsStore() resolves to
// a fake store we fully control, per test case, without touching the real
// network or requiring real Netlify credentials.
// ---------------------------------------------------------------------------
const BLOBS_MODULE_PATH = require.resolve('@netlify/blobs');

/** Mutable control object the fake store consults on every call. */
const mock = {
  // 'empty'   -> store.get() resolves to null (no such key — Case A)
  // 'value'   -> store.get() resolves to whatever mock.value holds (Case B)
  // 'failure' -> store.get() rejects (Case C)
  mode: 'empty',
  value: null,
  lastSetPayload: null, // records whatever the code under test last wrote, if anything
  setWasCalled: false,
};

const fakeStore = {
  async get(key, options) {
    if (mock.mode === 'failure') {
      // Mirrors what the real @netlify/blobs client throws for a genuine
      // non-2xx/non-404 response or a network error (BlobsInternalError) —
      // see the getRecord() doc comment for the confirmed real contract.
      throw new Error('Simulated Blobs read failure (e.g. 500 from the API, or a network error)');
    }
    if (mock.mode === 'empty') return null;
    if (mock.mode === 'value') return mock.value;
    throw new Error('Unhandled mock mode: ' + mock.mode);
  },
  async setJSON(key, data) {
    mock.setWasCalled = true;
    mock.lastSetPayload = JSON.parse(JSON.stringify(data));
    return { modified: true };
  },
};

require.cache[BLOBS_MODULE_PATH] = {
  id: BLOBS_MODULE_PATH,
  filename: BLOBS_MODULE_PATH,
  loaded: true,
  exports: { getStore: () => fakeStore },
};

// Now require the modules under test — they'll pick up the faked @netlify/blobs.
const wellbeingStore = require(path.join(__dirname, '..', 'netlify', 'functions', 'shared', 'wellbeing-store.js'));
const { getRecord, appendEntry, validateCheckInInput, EMOTIONAL_STATES, PRIMARY_CONCERNS, SUPPORT_PREFERENCES } = wellbeingStore;

const submitHandler = require(path.join(__dirname, '..', 'netlify', 'functions', 'submit-wellbeing-checkin.js')).handler;
const getCheckinsHandler = require(path.join(__dirname, '..', 'netlify', 'functions', 'get-wellbeing-checkins.js')).handler;

// The handlers also need shared/member-auth.js's getAuthenticatedMember to
// resolve to a fake authenticated member, without a real member_session
// cookie or real Blobs "members" store. We mock it the same way.
const MEMBER_AUTH_PATH = require.resolve(path.join(__dirname, '..', 'netlify', 'functions', 'shared', 'member-auth.js'));
require.cache[MEMBER_AUTH_PATH] = {
  id: MEMBER_AUTH_PATH,
  filename: MEMBER_AUTH_PATH,
  loaded: true,
  exports: {
    getAuthenticatedMember: async () => ({ email: 'checkin-tester@example.com', firstName: 'Tester', faithStage: 'growing' }),
  },
};
// Re-require the handlers AFTER stubbing member-auth so they resolve the stub.
delete require.cache[require.resolve(path.join(__dirname, '..', 'netlify', 'functions', 'submit-wellbeing-checkin.js'))];
delete require.cache[require.resolve(path.join(__dirname, '..', 'netlify', 'functions', 'get-wellbeing-checkins.js'))];
const submitHandler2 = require(path.join(__dirname, '..', 'netlify', 'functions', 'submit-wellbeing-checkin.js')).handler;
const getCheckinsHandler2 = require(path.join(__dirname, '..', 'netlify', 'functions', 'get-wellbeing-checkins.js')).handler;

const VALID_INPUT = {
  emotionalState: EMOTIONAL_STATES[0],
  primaryConcern: PRIMARY_CONCERNS[0],
  supportPreference: SUPPORT_PREFERENCES[0],
  reflection: 'A test reflection.',
};

function fakeEvent(method, body) {
  return { httpMethod: method, headers: {}, body: body ? JSON.stringify(body) : undefined, queryStringParameters: {} };
}

async function main() {
  console.log('\n== Test A — no existing record ==');
  {
    mock.mode = 'empty';
    const record = await getRecord('nobody-yet@example.com');
    check('getRecord() returns an empty, well-formed record when none exists', Array.isArray(record.entries) && record.entries.length === 0);

    mock.setWasCalled = false;
    const validated = validateCheckInInput(VALID_INPUT).value;
    const entry = await appendEntry('nobody-yet@example.com', validated);
    check('appendEntry() creates a new record for a first-time member', mock.setWasCalled && mock.lastSetPayload.entries.length === 1);
    check('the created entry has the expected fields', entry.emotionalState === VALID_INPUT.emotionalState && entry.visibility === 'private');
  }

  console.log('\n== Test B — existing record is preserved on append ==');
  {
    const existing = {
      email: 'has-history@example.com',
      entries: [
        { id: 'wb-a', createdAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01', emotionalState: 'okay', primaryConcern: 'faith', reflection: 'Entry A', supportPreference: 'keep_private', visibility: 'private' },
        { id: 'wb-b', createdAt: '2026-01-02T00:00:00.000Z', date: '2026-01-02', emotionalState: 'good', primaryConcern: 'family', reflection: 'Entry B', supportPreference: 'keep_private', visibility: 'private' },
      ],
    };
    mock.mode = 'value';
    mock.value = existing;
    mock.setWasCalled = false;

    const validated = validateCheckInInput({ ...VALID_INPUT, reflection: 'Entry C' }).value;
    await appendEntry('has-history@example.com', validated);

    check('write happened', mock.setWasCalled === true);
    check('all three entries present after append (A, B, and new C)', mock.lastSetPayload.entries.length === 3);
    check('entry A untouched', mock.lastSetPayload.entries[0].id === 'wb-a' && mock.lastSetPayload.entries[0].reflection === 'Entry A');
    check('entry B untouched', mock.lastSetPayload.entries[1].id === 'wb-b' && mock.lastSetPayload.entries[1].reflection === 'Entry B');
    check('entry C appended', mock.lastSetPayload.entries[2].reflection === 'Entry C');
  }

  console.log('\n== Test C — read failure must THROW, never resolve to an empty record ==');
  {
    mock.mode = 'failure';
    await checkThrows('getRecord() rejects on a genuine storage failure', () => getRecord('victim-of-outage@example.com'));
  }

  console.log('\n== Test D — read failure during append: no write, no false success ==');
  {
    mock.mode = 'failure';
    mock.setWasCalled = false;

    await checkThrows('appendEntry() rejects when the underlying read fails', () =>
      appendEntry('victim-of-outage@example.com', validateCheckInInput(VALID_INPUT).value)
    );
    check('setJSON was never called — no write occurred', mock.setWasCalled === false);

    // Full handler-level check: the HTTP layer must surface this as 500,
    // never as a 201 "success".
    const res = await submitHandler2(fakeEvent('POST', VALID_INPUT));
    check('submit-wellbeing-checkin returns HTTP 500 on a read failure', res.statusCode === 500);
    const body = JSON.parse(res.body);
    check('response body does not claim success', body.success !== true);
    check('response body does not leak internal error detail', !JSON.stringify(body).includes('Simulated Blobs read failure'));
  }

  console.log('\n== Test E — read failure during retrieval (get-wellbeing-checkins) ==');
  {
    mock.mode = 'failure';
    const res = await getCheckinsHandler2(fakeEvent('GET'));
    check('get-wellbeing-checkins returns HTTP 500 on a read failure', res.statusCode === 500);
    const body = JSON.parse(res.body);
    check('response body does not claim success', body.success !== true);
    check('response body does NOT return entries: []', !('entries' in body));
    check('response body does not leak internal error detail', !JSON.stringify(body).includes('Simulated Blobs read failure'));
  }

  console.log('\n== Test F — existing Phase 1 security tests still pass ==');
  {
    const { execFileSync } = require('child_process');
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'test-member-auth.js')], { stdio: 'pipe' });
      check('scripts/test-member-auth.js still passes in full (run as a subprocess)', true);
    } catch (e) {
      check('scripts/test-member-auth.js still passes in full (run as a subprocess)', false);
      console.log(String(e.stdout || e.message));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('UNCAUGHT:', e);
  process.exit(1);
});
