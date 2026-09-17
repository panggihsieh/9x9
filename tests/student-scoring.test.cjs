const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../v3/app.js'), 'utf8');
function setup(saved = {}, fail = false) {
  const record = { sessionId: 'session', currentNumber: 24, score: 0, tasks: {}, ...saved };
  const state = { studentCode: 'TEST', studentSessionId: 'session', currentNumber: 24, studentRoundVersion: 0,
    completedTasks: {}, wrongAttempts: {}, revealedTasks: {}, studentTaskBusy: false, answers: { factors: [1,2,3,4,6,8,12,24], pairs: [], pairDraft: [], primes: [] } };
  const els = Object.fromEntries(['factorNote','pairNote','primeNote','nextNumberBtn','practiceFeedback','factorAnswer','pairAnswer','primeAnswer','studentScore'].map(k => [k, { style: {} }]));
  let writes = 0;
  const buttons = {};
  const storage = new Map();
  const context = vm.createContext({ state, els, db: {}, localStorage: { setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k), getItem: k => storage.get(k) }, document: { querySelector: (selector) => buttons[selector] ||= {} },
    clearQuotaWarning: () => {}, databaseError: error => error.message, studentRef: () => 'student', presenceRef: () => 'presence', serverTimestamp: () => 0, playSound: () => {},
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
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../v3/pending-score.mjs'), 'utf8').replace('export function', 'function'), context);
  vm.runInContext(source.slice(source.indexOf('function renderTaskCompletion()'), source.indexOf('async function endClassroom(')), context);
  vm.runInContext(source.slice(source.indexOf('function renderAnswers()'), source.indexOf('function renderAnswerZone(')), context);
  context.applyStudentData(record);
  return { state, record, els, buttons, storage, restore: value => { context.restored = value; vm.runInContext("pendingScore = JSON.parse(restored); applyStudentData(studentSavedData)", context); }, flush: () => context.flushPendingScore(), queue: (task = 'factors') => context.checkStudentTask(task), writes: () => writes, check: async (task = 'factors') => { await context.checkStudentTask(task); await context.flushPendingScore(); }, next: async () => { await context.nextNumber(); context.applyStudentData(record); } };
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
test('failed upload retains local answers and retry awards points once', async () => {
  const app = setup({}, true);
  await app.queue();
  assert.equal(app.state.completedTasks.factors, true);
  await assert.rejects(app.flush(), /offline/);
  assert.equal(app.record.score, 0);
  assert.equal(app.storage.size, 1);
  await app.flush();
  assert.equal(app.record.score, 14);
  assert.equal(app.storage.size, 0);
});

test('stale pending round cannot score a different round', async () => {
  const app = setup();
  await app.queue();
  app.record.roundVersion = 1;
  await assert.rejects(app.flush(), /題目或課堂已變更/);
  assert.equal(app.record.score, 0);
  assert.equal(app.storage.size, 1);
});

test('next question flushes pending score before changing round', async () => {
  const app = setup();
  await app.queue();
  assert.equal(app.record.score, 0);
  await app.next();
  assert.equal(app.record.roundVersion, 1);
  assert.equal(app.record.score, 14);
  assert.equal(app.state.completedTasks.factors, false);
});

test('three answers combine into one student write and duplicate retries do not add points', async () => {
  const app = setup();
  app.state.answers.pairs = [[1,24],[2,12],[3,8],[4,6]];
  app.state.answers.primes = [2,2,2,3];
  await app.queue('factors'); await app.queue('pairs'); await app.queue('primes');
  assert.equal(app.writes(), 0);
  assert.equal(app.state.score, 46);
  await app.flush(); await app.flush();
  assert.equal(app.writes(), 1);
  assert.equal(app.record.score, 46);
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

test('reloading with an unacknowledged batch does not duplicate committed score', async () => {
  const first = setup();
  await first.queue();
  const pending = [...first.storage.values()][0];
  await first.flush();
  const reloaded = setup(JSON.parse(JSON.stringify(first.record)));
  reloaded.restore(pending);
  await reloaded.flush();
  assert.equal(reloaded.record.score, 14);
  assert.equal(reloaded.record.passCounts.factors, 1);
});
