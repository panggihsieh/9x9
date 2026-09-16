// Explicit opt-in: creates isolated test records, tests deployed rules, then removes them.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
if (process.env.RUN_FIRESTORE_LIVE !== 'x9-factor-game') throw new Error('Set RUN_FIRESTORE_LIVE=x9-factor-game to run.');
const root = process.env.LOCALAPPDATA + '/npm-cache/_npx/7750544ccf494d8b/node_modules/firebase-tools/lib/';
const cliAuth = require(root + 'auth');
const apiKey = fs.readFileSync('v3/firebase-config.js', 'utf8').match(/apiKey: "([^"]+)"/)[1];
const base = 'https://firestore.googleapis.com/v1/projects/x9-factor-game/databases/(default)/documents';
const prefix = 'projects/x9-factor-game/databases/(default)/documents/';
const email = 'codex-pin-test-' + randomUUID() + '@example.invalid';
const code = 'T' + randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
let adminToken, idToken, uid, checks = 0;
function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { booleanValue: value } : { integerValue: String(value) }]));
}
async function request(url, method, body, token) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function write(path, data, timestamps = [], token = idToken) {
  return request(base + ':commit', 'POST', { writes: [{ update: { name: prefix + path, fields: fields(data) },
    ...(timestamps.length ? { updateTransforms: timestamps.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}) }] }, token);
}
function expect(result, status, label) {
  assert.equal(result.status, status, label + ': ' + JSON.stringify(result.data.error || {}));
  checks++; console.log('PASS ' + label);
}
(async () => {
  const account = cliAuth.getGlobalDefaultAccount();
  adminToken = (await cliAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
  try {
    const signup = await request('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + apiKey, 'POST', { returnSecureToken: true });
    expect(signup, 200, 'anonymous verification identity');
    idToken = signup.data.idToken; uid = signup.data.localId;
    expect(await write('admins/' + email, { email, role: 'auth', passcode: '0037', updatedBy: 'live-test' }, ['updatedAt'], adminToken), 200, 'isolated teacher fixture');
    expect(await request(base + '/admins/' + email, 'GET', null, idToken), 403, 'teacher cannot read stored passcode');
    expect(await request(base + '/admins/' + email, 'GET'), 403, 'public cannot read stored passcode');
    expect(await write('admins/' + email, { email, role: 'admin', passcode: '9999' }), 403, 'teacher cannot edit admin settings');
    const session = (pin, role = 'auth') => write('teacherSessions/' + uid, { email, passcode: pin, role }, ['verifiedAt']);
    expect(await session('0037'), 403, 'cannot skip verification attempt');
    expect(await write('teacherAttempts/' + email, { uid, passcode: '0000', count: 1 }, ['attemptedAt', 'windowStartedAt']), 200, 'record wrong attempt');
    expect(await session('0000'), 403, 'wrong passcode denied');
    expect(await session('0037'), 403, 'cannot guess other passcodes within same attempt');
    expect(await request(base + '/teacherAttempts/' + email, 'GET', null, idToken), 403, 'candidate records cannot be read');
    expect(await write('teacherAttempts/' + email, { uid, passcode: '0037', count: 1 }, ['attemptedAt', 'windowStartedAt']), 403, 'cannot reset rate limit');
    // Admin fixture reset avoids waiting 15 minutes and never changes a real teacher.
    await request(base + '/teacherAttempts/' + email, 'DELETE', null, adminToken);
    expect(await write('teacherAttempts/' + email, { uid, passcode: '0037', count: 1 }, ['attemptedAt', 'windowStartedAt']), 200, 'record correct four-digit attempt with leading zero');
    expect(await session('0037', 'admin'), 403, 'auth teacher cannot claim admin role');
    expect(await session('0037'), 200, 'correct Gmail and passcode grant auth');
    const room = { code, sessionId: 'live-test', teacherUid: uid, teacherEmail: email, teacherRole: 'auth', teacherHasPriority: true, maxStudents: 100, studentCount: 0, status: 'waiting' };
    expect(await write('classrooms/' + code, room, ['createdAt', 'updatedAt']), 200, 'verified teacher can create classroom');
    expect(await write('classrooms/' + code, { ...room, teacherRole: 'admin' }, ['updatedAt']), 403, 'cannot forge classroom priority');
    expect(await write('classrooms/' + code, { ...room, status: 'active' }, ['updatedAt']), 200, 'verified teacher can start classroom');
    expect(await write('admins/' + email, { email, role: 'auth', passcode: '1122', updatedBy: 'live-test' }, ['updatedAt'], adminToken), 200, 'reset isolated teacher passcode');
    expect(await write('classrooms/' + code, { ...room, status: 'waiting' }, ['updatedAt']), 403, 'old verification revoked immediately after reset');
    console.log('Completed ' + checks + ' live checks.');
  } finally {
    for (const path of ['admins/' + email, 'teacherAttempts/' + email, ...(uid ? ['teacherSessions/' + uid] : []), 'classrooms/' + code]) {
      const result = await request(base + '/' + path, 'DELETE', null, adminToken);
      if (![200, 404].includes(result.status)) throw new Error('Test cleanup failed: ' + path);
    }
    if (idToken) {
      const result = await request('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + apiKey, 'POST', { idToken });
      if (result.status !== 200) throw new Error('Test identity cleanup failed');
    }
    console.log('Isolated test data cleaned up.');
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
