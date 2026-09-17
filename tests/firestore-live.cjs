// Explicit opt-in: creates isolated test records, tests deployed rules, then removes them.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (emulator && !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw new Error('Only local emulator allowed');
if (!emulator && process.env.RUN_FIRESTORE_LIVE !== 'x9-factor-game') throw new Error('Set RUN_FIRESTORE_LIVE=x9-factor-game to run.');
const root = process.env.LOCALAPPDATA + '/npm-cache/_npx/7750544ccf494d8b/node_modules/firebase-tools/lib/';
const cliAuth = emulator ? null : require(root + 'auth');
const apiKey = fs.readFileSync('v3/firebase-config.js', 'utf8').match(/apiKey: "([^"]+)"/)[1];
const project = emulator ? 'demo-factor-game' : 'x9-factor-game';
const endpoint = emulator ? 'http://' + emulator : 'https://firestore.googleapis.com';
const base = endpoint + '/v1/projects/' + project + '/databases/(default)/documents';
const prefix = 'projects/' + project + '/databases/(default)/documents/';
const email = 'codex-pin-test-' + randomUUID() + '@example.invalid';
const code = 'T' + randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
let adminToken, idToken, uid, checks = 0;
function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    value instanceof Date ? { timestampValue: value.toISOString() } : typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'object' ? { mapValue: { fields: fields(value) } } : { integerValue: String(value) }]));
}
async function request(url, method, body, token) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function write(path, data, timestamps = [], token = idToken, merge = false) {
  return request(base + ':commit', 'POST', { writes: [{ update: { name: prefix + path, fields: fields(data) }, ...(merge ? { updateMask: { fieldPaths: [...Object.keys(data), ...timestamps] } } : {}),
    ...(timestamps.length ? { updateTransforms: timestamps.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}) }] }, token);
}
function expect(result, status, label) {
  assert.equal(result.status, status, label + ': ' + JSON.stringify(result.data.error || {}));
  checks++; console.log('PASS ' + label);
}
(async () => {
  if (emulator) adminToken = 'owner';
  else {
    const account = cliAuth.getGlobalDefaultAccount();
    adminToken = (await cliAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
  }
  try {
    const signup = await request((emulator ? 'http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=' : 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=') + apiKey, 'POST', { returnSecureToken: true });
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
    expect(await write('classrooms/' + code, room, ['createdAt', 'updatedAt', 'teacherLastSeenAt', 'lastStudentSeenAt']), 200, 'verified teacher can create classroom');
    expect(await write('classrooms/' + code, { ...room, teacherRole: 'admin' }, ['updatedAt']), 403, 'cannot forge classroom priority');
    expect(await write('classrooms/' + code, { durationMinutes: 4 }, ['updatedAt'], idToken, true), 403, 'reject unsupported duration');
    for (const durationMinutes of [2, 3, 5, 10]) expect(await write('classrooms/' + code, { durationMinutes }, ['updatedAt'], idToken, true), 200, 'allow duration ' + durationMinutes);
    expect(await write('classrooms/' + code, { status: 'active' }, ['updatedAt'], idToken, true), 200, 'verified teacher can start classroom');
    // Exercise classroom lifecycle against the deployed rules with isolated data.
    const oldTime = new Date(Date.now() - 10 * 60_000);
    const oldRoom = { ...room, teacherEmail: 'another@example.invalid', teacherUid: 'another-teacher',
      sessionId: 'old-session', createdAt: oldTime, updatedAt: oldTime,
      teacherLastSeenAt: new Date(), lastStudentSeenAt: oldTime };
    const takeover = async () => {
      const old = await request(base + '/classrooms/' + code, 'GET', null, adminToken);
      const oldId = old.data.fields.sessionId?.stringValue || 'legacy';
      return request(base + ':commit', 'POST', { writes: [
        { update: { name: prefix + 'classrooms/' + code + '/sessions/' + oldId, fields: old.data.fields } },
        { update: { name: prefix + 'classrooms/' + code, fields: fields({ ...room, sessionId: 'next-session' }) },
          updateTransforms: ['createdAt', 'updatedAt', 'teacherLastSeenAt', 'lastStudentSeenAt'].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) }
      ] }, idToken);
    };
    await write('classrooms/' + code, oldRoom, [], adminToken);
    expect(await takeover(), 403, 'online teacher blocks takeover');
    expect(await write('classrooms/' + code, { status: 'released' }, ['releasedAt', 'updatedAt'], null, true), 403, 'idle sweeper cannot release online teacher');
    await write('classrooms/' + code, { teacherLastSeenAt: oldTime, lastStudentSeenAt: new Date() }, [], adminToken, true);
    expect(await takeover(), 403, 'online students block takeover even when teacher is offline');
    expect(await write('classrooms/' + code, { status: 'released' }, ['releasedAt', 'updatedAt'], null, true), 403, 'idle sweeper cannot release online students');
    await write('classrooms/' + code, { lastStudentSeenAt: oldTime }, [], adminToken, true);
    expect(await write('classrooms/' + code, { status: 'released' }, ['releasedAt', 'updatedAt'], null, true), 200, 'idle sweeper automatically releases after five minutes');
    await write('classrooms/' + code + '/students/old-student', { sessionId: 'old-session', name: 'test student', score: 42, lastSeen: oldTime }, [], adminToken);
    expect(await takeover(), 200, 'both offline for five minutes permits atomic takeover');
    const oldStudent = await request(base + '/classrooms/' + code + '/students/old-student', 'GET', null, adminToken);
    assert.equal(oldStudent.data.fields.score.integerValue, '42'); checks++; console.log('PASS old answers retained');
    expect(await request(base + '/classrooms/' + code + '/sessions/old-session', 'GET', null, adminToken), 200, 'old classroom metadata archived');
    expect(await write('classrooms/' + code + '/students/old-student', { score: 99 }, ['lastSeen'], null, true), 403, 'old session cannot overwrite historical answers');
    const studentId = 'next-session_new-student';
    expect(await request(base + ':commit', 'POST', { writes: [
      { update: { name: prefix + 'classrooms/' + code + '/students/' + studentId,
        fields: fields({ sessionId: 'next-session', name: 'new student', score: 0, currentNumber: 24, tasks: { factors: false, pairs: false, primes: false }, onlineAt: Date.now() }) },
        updateTransforms: ['lastSeen', 'joinedAt'].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) },
      { update: { name: prefix + 'classrooms/' + code, fields: fields({ studentCount: 1, studentHeartbeatId: studentId }) },
        updateMask: { fieldPaths: ['studentCount', 'studentHeartbeatId', 'lastStudentSeenAt', 'updatedAt'] },
        updateTransforms: ['lastStudentSeenAt', 'updatedAt'].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) }
    ] }), 200, 'student join records server-side activity');
    const studentPath = 'classrooms/' + code + '/students/' + studentId;
    const taskState = { factors: true, pairs: false, primes: false };
    expect(await write(studentPath, { score: 14, tasks: taskState }, ['lastSeen'], null, true), 200, 'first factor answer awards 14 points');
    expect(await write(studentPath, { score: 28, tasks: taskState }, ['lastSeen'], null, true), 403, 'repeat same task rejected by database');
    expect(await write(studentPath, { score: 42 }, ['lastSeen'], null, true), 403, 'legacy client score increment rejected');
    expect(await write(studentPath, { score: 14, tasks: { factors: false, pairs: false, primes: false } }, ['lastSeen'], null, true), 403, 'cannot reset completion in the same round');
    expect(await write(studentPath, { score: 14, tasks: taskState, status: 'joined' }, ['lastSeen'], null, true), 200, 'rejoin preserves score and completion');
    expect(await write(studentPath, { score: 32, tasks: { ...taskState, pairs: true } }, ['lastSeen'], null, true), 200, 'different task awards its own points');
    expect(await write(studentPath, { score: 46, tasks: { factors: true, pairs: true, primes: true } }, ['lastSeen'], null, true), 200, 'three tasks total 46 points');
    expect(await write(studentPath, { currentNumber: 24, roundVersion: 1, tasks: { factors: false, pairs: false, primes: false } }, ['lastSeen'], null, true), 200, 'new round resets tasks without adding score');
    expect(await write(studentPath, { score: 60, tasks: taskState }, ['lastSeen'], null, true), 200, 'new round can score once');
    expect(await write(studentPath, { score: 74, tasks: taskState }, ['lastSeen'], null, true), 403, 'new round also rejects duplicate score');
    for (let attempts = 1; attempts <= 4; attempts++) {
      expect(await write(studentPath, { wrongAttempts: { pairs: attempts } }, ['lastSeen'], null, true), 200, 'save incorrect pair attempt ' + attempts);
    }
    expect(await write(studentPath, { wrongAttempts: { pairs: 5 }, revealedTasks: { pairs: true }, tasks: { factors: true, pairs: true, primes: false } }, ['lastSeen'], null, true), 200, 'fifth incorrect answer completes without scoring');
    const revealedStudent = await request(base + '/' + studentPath, 'GET');
    assert.equal(revealedStudent.data.fields.score.integerValue, '60');
    expect(await write(studentPath, { score: 78 }, ['lastSeen'], null, true), 403, 'revealed answer cannot receive points later');
    for (let attempts = 1; attempts <= 4; attempts++) {
      expect(await write(studentPath, { wrongAttempts: { pairs: 5, primes: attempts } }, ['lastSeen'], null, true), 200, 'save incorrect prime attempt ' + attempts);
    }
    expect(await write(studentPath, { wrongAttempts: { pairs: 5, primes: 5 }, revealedTasks: { pairs: true, primes: true }, tasks: { factors: true, pairs: true, primes: true } }, ['lastSeen'], null, true), 200, 'fifth incorrect prime answer reveals without scoring');
    expect(await write(studentPath, { currentNumber: 30, roundVersion: 2, tasks: { factors: false, pairs: false, primes: false }, wrongAttempts: {}, revealedTasks: {} }, ['lastSeen'], null, true), 200, 'next round clears wrong attempts and revealed answers');
    expect(await write('classrooms/' + code, { lastStudentSeenAt: oldTime }, [], null, true), 403, 'student cannot forge an old activity timestamp');
    expect(await write('classrooms/' + code, { status: 'released' }, ['releasedAt', 'updatedAt'], idToken, true), 200, 'owner releases classroom without deleting answers');
    expect(await write('classrooms/' + code + '/students/' + studentId, { score: 5 }, ['lastSeen'], null, true), 403, 'released classroom rejects student writes');
    expect(await write('classrooms/' + code, { status: 'active' }, ['updatedAt'], idToken, true), 403, 'released classroom cannot be restarted by stale tab');
    // Legacy records have no owner: automatic takeover must wait for admin release.
    await write('classrooms/' + code, { code, status: 'waiting', updatedAt: oldTime, studentCount: 0, maxStudents: 100 }, [], adminToken);
    expect(await takeover(), 403, 'ownerless legacy classroom requires explicit admin release');
    await write('classrooms/' + code, { status: 'released' }, ['releasedAt', 'updatedAt'], adminToken, true);
    expect(await takeover(), 200, 'admin-released legacy code can be reused');
    expect(await write('admins/' + email, { email, role: 'auth', passcode: '1122', updatedBy: 'live-test' }, ['updatedAt'], adminToken), 200, 'reset isolated teacher passcode');
    expect(await write('classrooms/' + code, { status: 'waiting' }, ['updatedAt'], idToken, true), 403, 'old verification revoked immediately after reset');
    const guestEmail = uid + '@guest.invalid';
    expect(await write('teacherSessions/' + uid, { email: guestEmail, role: 'admin', passcode: '' }, ['verifiedAt']), 403, 'guest cannot forge admin session');
    expect(await write('teacherSessions/' + uid, { email: guestEmail, role: 'guest', passcode: '' }, ['verifiedAt']), 200, 'guest session without credentials');
    const guestRoom = { ...room, code: code + 'G', teacherEmail: guestEmail, teacherRole: 'guest', teacherHasPriority: false };
    expect(await write('classrooms/' + code + 'G', guestRoom, ['createdAt', 'updatedAt', 'teacherLastSeenAt', 'lastStudentSeenAt']), 200, 'guest creates classroom with code only');
    expect(await write('classrooms/' + code + 'G', { status: 'active' }, ['updatedAt'], idToken, true), 200, 'guest starts own classroom');
    expect(await write('classrooms/' + code + 'G', { teacherHasPriority: true }, ['updatedAt'], idToken, true), 403, 'guest cannot elevate priority');
    if (emulator) {
      // Verify server-side ranking selects this session's top ten, not the entire roster.
      const rankingPaths = [];
      for (let i=0;i<12;i++) {
        const path = 'classrooms/'+code+'G/students/rank-'+i;
        rankingPaths.push(path);
        await write(path,{name:'Test '+i,sessionId:guestRoom.sessionId,score:i*14},[],adminToken);
      }
      const oldPath = 'classrooms/'+code+'G/students/old-rank'; rankingPaths.push(oldPath);
      await write(oldPath,{name:'Old',sessionId:'old',score:99999},[],adminToken);
      const ranked = await request(base+'/classrooms/'+code+'G:runQuery','POST',{structuredQuery:{
        from:[{collectionId:'students'}],where:{fieldFilter:{field:{fieldPath:'sessionId'},op:'EQUAL',value:{stringValue:guestRoom.sessionId}}},
        orderBy:[{field:{fieldPath:'score'},direction:'DESCENDING'}],limit:10
      }});
      expect(ranked,200,'top ten query accepted');
      const scores=ranked.data.filter(x=>x.document).map(x=>Number(x.document.fields.score.integerValue));
      assert.deepEqual(scores,[154,140,126,112,98,84,70,56,42,28]); checks++; console.log('PASS query excludes old session and returns exactly top ten');
      for (const path of rankingPaths) await request(base+'/'+path,'DELETE',null,adminToken);
      const presencePath = 'roomPresence/' + guestRoom.sessionId;
      expect(await write(presencePath, { code: code + 'G', sessionId: guestRoom.sessionId }, ['teacherLastSeenAt'], idToken), 200, 'teacher writes independent presence');
      expect(await write(presencePath, { code: code + 'G', sessionId: guestRoom.sessionId, teacherLastSeenAt: oldTime }, [], idToken, true), 403, 'cannot backdate teacher presence');
      await write('classrooms/' + code + 'G', { teacherLastSeenAt: oldTime, lastStudentSeenAt: oldTime, updatedAt: oldTime }, [], adminToken, true);
      expect(await write('classrooms/' + code + 'G', {status:'released'}, ['releasedAt','updatedAt'], null, true), 403, 'fresh separate teacher presence prevents idle release');
      const memberPath = 'classrooms/' + code + 'G/students/presence-test';
      await write(memberPath, {sessionId:guestRoom.sessionId, score:0, tasks:{factors:false,pairs:false,primes:false}}, ['lastSeen'], adminToken);
      await write(memberPath, {currentNumber:24}, [], adminToken, true);
      const batchScore = {score:46,tasks:{factors:true,pairs:true,primes:true},passCounts:{factors:1,pairs:1,primes:1},wrongAttempts:{factors:0,pairs:0,primes:0},revealedTasks:{factors:false,pairs:false,primes:false}};
      expect(await write(memberPath,batchScore,['lastSeen'],null,true),200,'batched three answers accepted');
      expect(await write(memberPath,batchScore,['lastSeen'],null,true),200,'retry same batch is idempotent');
      expect(await write(memberPath,{...batchScore,score:92},['lastSeen'],null,true),403,'batch cannot award points twice');
      expect(await write(memberPath,{score:46,currentNumber:30,roundVersion:1,tasks:{factors:false,pairs:false,primes:false},wrongAttempts:{},revealedTasks:{}},['lastSeen'],null,true),200,'advance after batch retains score');
      expect(await write(memberPath,{score:46,tasks:{factors:true,pairs:true,primes:true},wrongAttempts:{factors:5,pairs:5,primes:5},revealedTasks:{factors:true,pairs:true,primes:true}},['lastSeen'],null,true),200,'batched five wrong attempts reveal without score');
      expect(await write(memberPath,{score:92},['lastSeen'],null,true),403,'revealed batch cannot add score');
      const before = await request(base + '/classrooms/' + code + 'G', 'GET', null, adminToken);
      expect(await request(base + ':commit', 'POST', {writes:[
        {update:{name:prefix+memberPath,fields:fields({onlineAt:Date.now()})}, updateMask:{fieldPaths:['onlineAt','lastSeen']}, updateTransforms:[{fieldPath:'lastSeen',setToServerValue:'REQUEST_TIME'}]},
        {update:{name:prefix+presencePath,fields:fields({code:code+'G',sessionId:guestRoom.sessionId,studentHeartbeatId:'presence-test'})}, updateMask:{fieldPaths:['code','sessionId','studentHeartbeatId','lastStudentSeenAt']}, updateTransforms:[{fieldPath:'lastStudentSeenAt',setToServerValue:'REQUEST_TIME'}]}
      ]}), 200, 'anonymous student heartbeat updates only member and presence');
      const after = await request(base + '/classrooms/' + code + 'G', 'GET', null, adminToken);
      assert.deepEqual(after.data.fields,before.data.fields); checks++; console.log('PASS student heartbeat never changes shared classroom document');
      await write(presencePath, {teacherLastSeenAt:oldTime}, [], adminToken, true);
      expect(await write('classrooms/' + code + 'G', {status:'released'}, ['releasedAt','updatedAt'], null, true), 403, 'fresh separate student presence prevents release');
      await write(presencePath, {lastStudentSeenAt:oldTime}, [], adminToken, true);
      expect(await write('classrooms/' + code + 'G', {status:'released'}, ['releasedAt','updatedAt'], null, true), 200, 'both separate leases expired permits release');
      expect(await write(presencePath, {code:code+'G',sessionId:guestRoom.sessionId}, ['teacherLastSeenAt'], idToken, true), 403, 'released room rejects late heartbeat');
      await request(base+'/'+presencePath,'DELETE',null,adminToken);
      await request(base+'/'+memberPath,'DELETE',null,adminToken);
    }
    console.log('Completed ' + checks + ' live checks.');
  } finally {
    for (const collection of ['students', 'sessions']) {
      const docs = await request(base + '/classrooms/' + code + '/' + collection, 'GET', null, adminToken);
      for (const doc of docs.data.documents || []) await request(endpoint + '/v1/' + doc.name, 'DELETE', null, adminToken);
    }
    for (const path of ['admins/' + email, 'teacherAttempts/' + email, ...(uid ? ['teacherSessions/' + uid] : []), 'classrooms/' + code, 'classrooms/' + code + 'G']) {
      const result = await request(base + '/' + path, 'DELETE', null, adminToken);
      if (![200, 404].includes(result.status)) throw new Error('Test cleanup failed: ' + path);
    }
    if (idToken) {
      const result = await request((emulator ? 'http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:delete?key=' : 'https://identitytoolkit.googleapis.com/v1/accounts:delete?key=') + apiKey, 'POST', { idToken });
      if (result.status !== 200) throw new Error('Test identity cleanup failed');
    }
    console.log('Isolated test data cleaned up.');
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
