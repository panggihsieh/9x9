const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../v3/app.js'), 'utf8');
function setup(saved = {}, fail = false) {
  const record = { sessionId: 'session', currentNumber: 24, score: 0, tasks: {}, ...saved };
  const state = { studentCode: 'TEST', studentSessionId: 'session', currentNumber: 24, studentRoundVersion: 0,
    completedTasks: {}, studentTaskBusy: false, answers: { factors: [1,2,3,4,6,8,12,24], pairs: [], pairDraft: [], primes: [] } };
  const els = Object.fromEntries(['factorNote','pairNote','primeNote','nextNumberBtn','practiceFeedback'].map(k => [k, { style: {} }]));
  let writes = 0;
  const context = vm.createContext({ state, els, db: {}, document: { querySelector: () => ({}) },
    studentRef: () => 'student', serverTimestamp: () => 0, playSound: () => {},
    factorsOf: () => [1,2,3,4,6,8,12,24], sameNumberList: (a,b) => JSON.stringify(a) === JSON.stringify(b),
    chooseNumber: () => 24, renderAnswers: () => {}, updateTargetFocus: () => {},
    runTransaction: async (_, callback) => {
      if (fail) { fail = false; throw new Error('offline'); }
      return callback({ get: async () => ({ data: () => record }), update: (_, values) => {
        writes++;
        for (const [key,value] of Object.entries(values)) {
          if (key.startsWith('tasks.')) record.tasks[key.slice(6)] = value;
          else record[key] = value;
        }
      }});
    }
  });
  vm.runInContext(source.slice(source.indexOf('function renderTaskCompletion()'), source.indexOf('async function endClassroom(')), context);
  return { state, record, els, writes: () => writes, check: () => context.checkStudentTask('factors'), next: () => context.nextNumber() };
}
test('rapid and repeated confirmation awards only 14 points', async () => {
  const app = setup();
  await Promise.all([app.check(), app.check(), app.check()]);
  await app.check();
  assert.equal(app.record.score, 14);
  assert.equal(app.writes(), 1);
  assert.match(app.els.factorNote.textContent, /已計分/);
});
test('rejoining with locally missing completion cannot award an already saved task', async () => {
  const app = setup({ score: 14, tasks: { factors: true } });
  await app.check();
  assert.equal(app.record.score, 14);
  assert.equal(app.writes(), 0);
  assert.equal(app.state.completedTasks.factors, true);
});
test('failed save allows retry without falsely marking completion', async () => {
  const app = setup({}, true);
  await app.check();
  assert.equal(app.state.completedTasks.factors, undefined);
  assert.equal(app.state.studentTaskBusy, false);
  await app.check();
  assert.equal(app.record.score, 14);
});
test('stale answer cannot score a new round even when number repeats', async () => {
  const app = setup({ roundVersion: 1 });
  await app.check();
  assert.equal(app.record.score, 0);
  assert.equal(app.writes(), 0);
});
test('next question is blocked while scoring and resets completion after save', async () => {
  const app = setup();
  const pending = app.check();
  await app.next();
  await pending;
  assert.equal(app.record.roundVersion, undefined);
  await app.next();
  assert.equal(app.record.roundVersion, 1);
  assert.equal(app.record.score, 14);
  assert.equal(app.state.completedTasks.factors, undefined);
});
