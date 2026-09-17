const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../v3/app.js'), 'utf8');
function setup(saved = {}, fail = false) {
  const record = { sessionId: 'session', currentNumber: 24, score: 0, tasks: {}, ...saved };
  const state = { studentCode: 'TEST', studentSessionId: 'session', currentNumber: 24, studentRoundVersion: 0,
    completedTasks: {}, wrongAttempts: {}, revealedTasks: {}, studentTaskBusy: false, answers: { factors: [1,2,3,4,6,8,12,24], pairs: [], pairDraft: [], primes: [] } };
  const els = Object.fromEntries(['factorNote','pairNote','primeNote','nextNumberBtn','practiceFeedback','factorAnswer','pairAnswer','primeAnswer'].map(k => [k, { style: {} }]));
  let writes = 0;
  const buttons = {};
  const context = vm.createContext({ state, els, db: {}, document: { querySelector: (selector) => buttons[selector] ||= {} },
    databaseError: error => error.message, studentRef: () => 'student', presenceRef: () => 'presence', serverTimestamp: () => 0, playSound: () => {},
    factorsOf: () => [1,2,3,4,6,8,12,24], sameNumberList: (a,b) => JSON.stringify(a) === JSON.stringify(b),
    factorPairs: () => [[1,24],[2,12],[3,8],[4,6]], primeFactorsOf: () => [2,2,2,3],
    samePairs: (a,b) => JSON.stringify(a) === JSON.stringify(b), renderAnswerZone: () => {},
    chooseNumber: () => 24, updateTargetFocus: () => {},
    runTransaction: async (_, callback) => {
      if (fail) { fail = false; throw new Error('offline'); }
      return callback({ set: () => {}, get: async () => ({ data: () => record }), update: (_, values) => {
        writes++;
        for (const [key,value] of Object.entries(values)) {
          if (key.includes('.')) { const [field,task] = key.split('.'); (record[field] ||= {})[task] = value; }
          else record[key] = value;
        }
      }});
    }
  });
  vm.runInContext(source.slice(source.indexOf('function renderTaskCompletion()'), source.indexOf('async function endClassroom(')), context);
  vm.runInContext(source.slice(source.indexOf('function renderAnswers()'), source.indexOf('function renderAnswerZone(')), context);
  return { state, record, els, buttons, writes: () => writes, check: (task = 'factors') => context.checkStudentTask(task), next: () => context.nextNumber() };
}
test('rapid and repeated confirmation awards only 14 points', async () => {
  const app = setup();
  await Promise.all([app.check(), app.check(), app.check()]);
  await app.check();
  assert.equal(app.record.score, 14);
  assert.equal(app.writes(), 1);
  assert.equal(app.record.passCounts.factors, 1);
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

for (const task of ['factors', 'pairs', 'primes']) {
  test(task + ': fifth wrong confirmation reveals answer without points and disables completion', async () => {
    const app = setup();
    app.state.answers.factors = [];
    for (let i = 1; i <= 4; i++) {
      await app.check(task);
      assert.equal(app.record.wrongAttempts[task], i);
      assert.equal(Boolean(app.record.tasks[task]), false);
      assert.equal(app.record.score, 0);
    }
    await app.check(task);
    assert.equal(app.record.tasks[task], true);
    assert.equal(app.record.revealedTasks[task], true);
    assert.equal(app.record.score, 0);
    assert.ok(app.state.answers[task].length > 0);
    assert.equal(app.buttons['[data-check="' + task + '"]'].textContent, '已完成');
    assert.equal(app.buttons['[data-check="' + task + '"]'].disabled, true);
    await app.check(task);
    assert.equal(app.record.score, 0);
    await app.next();
    assert.equal(Object.keys(app.state.wrongAttempts).length, 0);
    assert.equal(Object.keys(app.record.revealedTasks).length, 0);
  });
}
test('wrong attempts survive rejoining and fifth attempt reveals without scoring', async () => {
  const app = setup({ wrongAttempts: { factors: 4 } });
  app.state.answers.factors = [];
  await app.check();
  assert.equal(app.record.tasks.factors, true);
  assert.equal(app.record.score, 0);
});

test('pass counts accumulate across questions without resetting', async () => {
 const app = setup();
 await app.check();
 await app.next();
 app.state.answers.factors = [1,2,3,4,6,8,12,24];
 await app.check();
 assert.equal(app.record.passCounts.factors, 2);
 assert.equal(app.record.score, 28);
});
