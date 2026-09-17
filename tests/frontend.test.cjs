const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = readFileSync(require("node:path").join(__dirname, "../v3/app.js"), "utf8");
function page(verifyTeacher) {
  let submit;
  const state = { identityRevision: 0, accessReady: false, teacherRegistered: false, globalOnlineCount: 0 };
  const els = Object.fromEntries(["teacherGlobalOnline", "teacherAuthStatus", "teacherLoginBtn", "openClassBtn", "teacherAccessNote", "teacherPasscode", "teacherGmail"].map((key) => [key, { dataset: {}, value: "", setAttribute(name, value) { this[name] = value; } }]));
  els.teacherGmail.value = "teacher@example.com";
  els.teacherPasscode.value = "0037";
  els.teacherIdentityForm = { addEventListener: (event, fn) => { submit = fn; } };
  const context = vm.createContext({ databaseError: error => error.message, state, els, verifyTeacher, auth: { currentUser: { uid: "test-uid" } }, classroomSettings: { maxGlobalOnline: 100 }, SUPER_ADMIN_EMAIL: "teacher.hsieh@gmail.com", normalizeEmail: (value) => value.trim().toLowerCase() });
  vm.runInContext(source.slice(source.indexOf("function setButtonBusy("), source.indexOf('els.teacherForm.addEventListener')), context);
  vm.runInContext(source.slice(source.indexOf("function updateTeacherAccessUi()"), source.indexOf("async function verifyTeacher(")), context);
  vm.runInContext(source.slice(source.indexOf("async function refreshTeacherAccess()"), source.indexOf("async function ensureTeacherCanOpenClassroom()")), context);
  vm.runInContext(source.slice(source.indexOf('els.teacherIdentityForm.addEventListener("submit"'), source.indexOf('els.teacherLogoutBtn.addEventListener')), context);
  return { state, els, context, submit: () => submit({ preventDefault() {} }) };
}
test("wrong passcode clears previous priority, displays guest, and permits guest opening", async () => {
  const app = page(async () => { throw new Error("帳號或通行碼錯誤"); });
  Object.assign(app.state, { accessReady: true, teacherRegistered: true, teacherRole: "auth", teacherHasPriority: true, teacherToken: "old" });
  await app.submit();
  assert.equal(app.els.teacherAuthStatus.textContent, "guest｜一般");
  assert.equal(app.els.openClassBtn.disabled, false);
  assert.equal(app.state.teacherToken, "");
  assert.equal(app.state.accessReady, false);
  assert.equal(app.state.teacherRole, "guest");
  assert.equal(app.state.teacherHasPriority, false);
});
test("only successful verification exposes returned priority and enables opening", async () => {
  const app = page(async ({ email, passcode }) => {
    assert.equal(passcode, "0037");
    return { data: { email, token: "verified", role: "auth", hasPriority: true, registered: true, expiresAt: Date.now() + 1000 } };
  });
  await app.submit();
  assert.equal(app.els.teacherAuthStatus.textContent, "auth｜優先");
  assert.equal(app.els.openClassBtn.disabled, false);
  assert.equal(app.els.teacherPasscode.value, "");
});
test("changing credentials during verification discards the old result", async () => {
  let resolve;
  const app = page(() => new Promise((done) => { resolve = done; }));
  const pending = app.submit();
  vm.runInContext("resetTeacherVerification()", app.context);
  resolve({ data: { email: "teacher@example.com", role: "auth", registered: true, token: "stale" } });
  await pending;
  assert.equal(app.state.accessReady, false);
  assert.equal(app.state.teacherToken, "");
  assert.equal(app.els.openClassBtn.disabled, false);
});

test("verification shows waiting state, ignores repeat submission, and restores button", async () => {
  let resolve;
  let calls = 0;
  const app = page(() => { calls++; return new Promise(done => { resolve = done; }); });
  const pending = app.submit();
  assert.equal(app.els.teacherLoginBtn.dataset.busy, "true");
  assert.equal(app.els.teacherLoginBtn.disabled, true);
  assert.equal(app.els.teacherLoginBtn["aria-busy"], "true");
  await app.submit();
  assert.equal(calls, 1);
  resolve({ data: { email: "teacher@example.com", role: "auth", registered: true, token: "ok" } });
  await pending;
  assert.equal(app.els.teacherLoginBtn.dataset.busy, undefined);
  assert.equal(app.els.teacherLoginBtn.disabled, false);
  assert.equal(app.els.teacherLoginBtn.textContent, "驗證優先權");
});
