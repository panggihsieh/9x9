import { mergePendingScore } from "./pending-score.mjs";
import { playSound } from "./sound.js?v=20260917-tick-tock";
import { classroomCountdown } from "./countdown.mjs";
import { chooseClassroomNumber } from "./question-difficulty.mjs?v=20260917-modes";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  GoogleAuthProvider,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  signOut,
  signInAnonymously,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  setDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { classroomSettings, firebaseConfig } from "./firebase-config.js";
import { SUPER_ADMIN_EMAIL, resolveTeacherAccess } from "./teacher-access.js?v=20260917-admin-only";

import { canReclaimRoom, roomIsOpen, timestampMillis, withPresence } from "./room-lifecycle.mjs?v=presence";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const ONLINE_WINDOW_MS = 150_000;
const PRESENCE_INTERVAL_MS = 60_000;

const els = {
  tabs: document.querySelectorAll(".tab[data-view]"),
  views: {
    teacher: document.querySelector("#teacherView"),
    student: document.querySelector("#studentView"),
    admin: document.querySelector("#adminView")
  },
  teacherForm: document.querySelector("#teacherForm"),
  teacherCode: document.querySelector("#teacherCode"),
  teacherAccessNote: document.querySelector("#teacherAccessNote"),
  openClassBtn: document.querySelector("#openClassBtn"),
  teacherLogoutBtn: document.querySelector("#teacherLogoutBtn"),
  teacherRoom: document.querySelector("#teacherRoom"),
  teacherRoomCode: document.querySelector("#teacherRoomCode"),
  studentCount: document.querySelector("#studentCount"),
  maxStudents: document.querySelector("#maxStudents"),
  limitStatus: document.querySelector("#limitStatus"),
  classStatus: document.querySelector("#classStatus"),
  leaderboard: document.querySelector("#leaderboard"),
  startClassBtn: document.querySelector("#startClassBtn"),
  endClassBtn: document.querySelector("#endClassBtn"),
  studentForm: document.querySelector("#studentForm"),
  studentJoinBtn: document.querySelector("#studentJoinBtn"),
  studentJoinError: document.querySelector("#studentJoinError"),
  studentCode: document.querySelector("#studentCode"),
  studentName: document.querySelector("#studentName"),
  studentLobby: document.querySelector("#studentLobby"),
  lobbyTitle: document.querySelector("#lobbyTitle"),
  lobbyText: document.querySelector("#lobbyText"),
  practiceView: document.querySelector("#practiceView"),
  numberBoard: document.querySelector("#numberBoard"),
  targetNumber: document.querySelector("#targetNumber"),
  studentScore: document.querySelector("#studentScore"),
  factorAnswer: document.querySelector("#factorAnswer"),
  pairAnswer: document.querySelector("#pairAnswer"),
  primeAnswer: document.querySelector("#primeAnswer"),
  factorNote: document.querySelector("#factorNote"),
  pairNote: document.querySelector("#pairNote"),
  primeNote: document.querySelector("#primeNote"),
  nextNumberBtn: document.querySelector("#nextNumberBtn"),
  practiceFeedback: document.querySelector("#practiceFeedback"),
  adminLoginBtn: document.querySelector("#adminLoginBtn"),
  adminPanel: document.querySelector("#adminPanel"),
  adminStatus: document.querySelector("#adminStatus"),
  superAdminTools: document.querySelector("#superAdminTools"),
  adminClassroomList: document.querySelector("#adminClassroomList"),
  refreshClassroomsBtn: document.querySelector("#refreshClassroomsBtn"),
  releaseAllClassroomsBtn: document.querySelector("#releaseAllClassroomsBtn")
};

const state = {
  teacherCode: "",
  studentCode: "",
  studentId: localStorage.getItem("factor-v3-student-id") || crypto.randomUUID(),
  studentName: "",
  studentDifficulty: "",
  selectedTask: "factors",
  currentNumber: 24,
  answers: {
    factors: [],
    pairs: [],
    pairDraft: [],
    primes: []
  },
  score: 0,
  completedTasks: {},
  wrongAttempts: {},
  revealedTasks: {},
  studentTaskBusy: false,
  studentRoundVersion: 0,
  authUser: null,
  teacherEmail: "",
  teacherRole: null,
  adminAccess: false,
  teacherHasPriority: false,
  teacherSessionId: "",
  teacherMaxStudents: classroomSettings.maxStudents,
  teacherStudents: [],
  studentSessionId: "",
  unsubTeacherRoom: null,
  unsubTeacherStudents: null,
  unsubStudentRoom: null,
  unsubStudentDoc: null,
  teacherRefreshTimer: null,
  teacherCountdownTimer: null,
  teacherHeartbeatTimer: null,
  presenceTimer: null
};

localStorage.setItem("factor-v3-student-id", state.studentId);

// 明確初始化，避免舊表單還原或空白偏好覆蓋內建值。
els.teacherCode.value = "5188";

// 個人開課頁只記住班級代碼。
for (const [input, key] of [
  [els.teacherCode, "factor-v3-teacher-code"]
]) {
  try {
    const saved = localStorage.getItem(key);
    if (saved?.trim()) input.value = saved.trim();
  } catch { /* 瀏覽器禁止儲存時，仍可手動輸入。 */ }
  input.addEventListener("input", () => {
    try { localStorage.setItem(key, input.value.trim()); } catch {}
  });
}


function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function classroomRef(code) {
  return doc(db, "classrooms", code);
}

function studentsRef(code) {
  return collection(db, "classrooms", code, "students");
}

function studentRef(code, studentId = state.studentId, sessionId = state.studentSessionId) {
  return doc(db, "classrooms", code, "students", sessionId ? `${sessionId}_${studentId}` : studentId);
}

function switchView(view) {
  document.body.dataset.view = view;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  Object.entries(els.views).forEach(([key, element]) => {
    element.classList.toggle("active", key === view);
  });
}

function factorsOf(n) {
  const result = [];
  for (let i = 1; i <= n; i += 1) if (n % i === 0) result.push(i);
  return result;
}

function factorPairs(n) {
  const pairs = [];
  for (let i = 1; i <= Math.sqrt(n); i += 1) {
    if (n % i === 0) pairs.push([i, n / i]);
  }
  return pairs;
}

function primeFactorsOf(n) {
  const result = [];
  let value = n;
  let divisor = 2;
  while (value > 1) {
    while (value % divisor === 0) {
      result.push(divisor);
      value /= divisor;
    }
    divisor += divisor === 2 ? 1 : 2;
  }
  return result.length ? result : [n];
}

function sameNumberList(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

function samePairs(a, b) {
  if (a.length !== b.length) return false;
  const normalize = (pairs) => pairs
    .map(([x, y]) => [Math.min(x, y), Math.max(x, y)].join("x"))
    .sort();
  const left = normalize(a);
  const right = normalize(b);
  return left.every((value, index) => value === right[index]);
}

function chooseNumber() {
  return chooseClassroomNumber(state.studentDifficulty, state.score, state.currentNumber);
}

const presenceRef = (sessionId) => doc(db, "roomPresence", sessionId);
const activeRoomsQuery = () => query(collection(db, "classrooms"), where("status", "in", ["waiting", "active"]));
const currentStudentsQuery = (code, sessionId) => query(studentsRef(code), where("sessionId", "==", sessionId || ""));
let quotaBackoffUntil = 0;
let lastStudentActivityAt = 0;
const quotaWarningKey = "factor-v3-quota-warning-day";
function quotaDay() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function showQuotaWarning() {
  document.querySelector('#quotaWarning').hidden = false;
  try { localStorage.setItem(quotaWarningKey, quotaDay()); } catch {}
}
function clearQuotaWarning() {
  document.querySelector('#quotaWarning').hidden = true;
  try { localStorage.removeItem(quotaWarningKey); } catch {}
}
function restoreQuotaWarning() {
  try {
    const saved = localStorage.getItem(quotaWarningKey);
    document.querySelector('#quotaWarning').hidden = saved !== quotaDay();
    if (saved && saved !== quotaDay()) localStorage.removeItem(quotaWarningKey);
  } catch {}
}
restoreQuotaWarning();
window.addEventListener('storage', event => { if (event.key === quotaWarningKey) restoreQuotaWarning(); });
function databaseError(error) {
  if (error?.code === "resource-exhausted" || /quota exceeded/i.test(error?.message || "")) {
    showQuotaWarning();
    quotaBackoffUntil = Date.now() + 5 * 60_000;
    const notice = document.querySelector('#classroomModeHint');
    if (notice) notice.textContent = "資料庫配額已用盡，暫時無法開啟教室；請等待配額恢復後重試。";
    return "資料庫配額已用盡，暫時無法讀寫。背景查詢已暫停 5 分鐘，請等待配額恢復。";
  }
  return error?.message || "連線失敗，請稍後再試。";
}
function subscriptionError(error) {
  const message = databaseError(error);
  els.teacherAccessNote.textContent = message;
  els.practiceFeedback.textContent = message;
  els.adminStatus.textContent = message;
}
function canUseDatabase() { return !document.hidden && Date.now() >= quotaBackoffUntil; }
async function activityRoom(room, reader = getDoc) {
  if (!room?.sessionId) return room;
  const presence = await reader(presenceRef(room.sessionId));
  return withPresence(room, presence.data());
}
async function writeStudentPresence() {
  if (!state.studentCode || !state.studentSessionId || state.studentFinished || !canUseDatabase() || Date.now() - lastStudentActivityAt < 50_000) return;
  const memberRef = studentRef(state.studentCode);
  const batch = writeBatch(db);
  batch.update(memberRef, { onlineAt: Date.now(), lastSeen: serverTimestamp() });
  batch.set(presenceRef(state.studentSessionId), {
    code: state.studentCode, sessionId: state.studentSessionId,
    lastStudentSeenAt: serverTimestamp(), studentHeartbeatId: memberRef.id
  }, { merge: true });
  await batch.commit();
  lastStudentActivityAt = Date.now();
}

async function openClassroom(code) {
  const difficulty = document.querySelector('#classroomDifficulty').value;
  const sessionId = await runTransaction(db, async (tx) => {
    const ref = classroomRef(code);
    const snapshot = await tx.get(ref);
    const room = snapshot.data();
    if (room && room.teacherEmail === state.teacherEmail && roomIsOpen(room)) {
      tx.update(ref, { teacherUid: auth.currentUser.uid, teacherLastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return room.sessionId;
    }
    const liveRoom = room ? await activityRoom(room, ref => tx.get(ref)) : null;
    if (room && !canReclaimRoom(liveRoom)) {
      throw new Error(!room.teacherEmail
        ? "這是舊版保留的班級代碼，請 admin 在後台釋放。"
        : "此班級仍有老師或學生近期活動；雙方離線滿 5 分鐘後可重新使用，或請 admin 釋放。");
    }
    if (room) tx.set(doc(db, "classrooms", code, "sessions", room.sessionId || "legacy"), room);
    const nextSessionId = crypto.randomUUID();
    tx.set(ref, { code, sessionId: nextSessionId, teacherUid: auth.currentUser.uid,
      teacherEmail: state.teacherEmail, teacherRole: state.teacherRole, teacherHasPriority: state.teacherHasPriority,
      status: "waiting", difficulty, maxStudents: classroomSettings.maxStudents, studentCount: 0,
      teacherLastSeenAt: serverTimestamp(), lastStudentSeenAt: serverTimestamp(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return nextSessionId;
  });
  clearQuotaWarning();
  state.teacherSessionId = sessionId;
}

async function updateCurrentRoom(code, sessionId, changes) {
  await runTransaction(db, async (tx) => {
    const ref = classroomRef(code);
    const snapshot = await tx.get(ref);
    const room = snapshot.data();
    if (!roomIsOpen(room) || room.sessionId !== sessionId) throw new Error("此課堂已結束或代碼已重新使用。");
    tx.update(ref, changes);
  });
}

function startTeacherHeartbeat(code) {
  clearInterval(state.teacherHeartbeatTimer);
  const sessionId = state.teacherSessionId;
  const heartbeat = async () => {
    if (!canUseDatabase()) return;
    try {
      await setDoc(presenceRef(sessionId), { code, sessionId, teacherLastSeenAt: serverTimestamp() }, { merge: true });
    } catch (error) {
      els.teacherAccessNote.textContent = databaseError(error);
    }
  };
  heartbeat();
  state.teacherHeartbeatTimer = setInterval(heartbeat, PRESENCE_INTERVAL_MS);
}

function subscribeTeacher(code) {
  state.unsubTeacherRoom?.();
  state.unsubTeacherStudents?.();
  clearInterval(state.teacherRefreshTimer);
  clearInterval(state.teacherCountdownTimer);

  let countdownRoom;
  let finalTimer;
  clearTimeout(state.teacherFinalTimer);
  let lastSecond;
  const updateCountdown = () => {
    const countdown = classroomCountdown(countdownRoom);
    els.classStatus.textContent = !countdown
      ? countdownRoom?.status === "active" ? "準備倒數…" : "等待中"
      : countdown.seconds === 0 ? "時間到 · 00:00" : `練習中 · ${countdown.text}`;
    els.classStatus.classList.toggle("countdown-urgent", Boolean(countdown && countdown.seconds <= 10));
    if (countdown && countdown.seconds !== lastSecond && lastSecond !== undefined && lastSecond > 0
        && !document.hidden && document.body.dataset.view === "teacher") {
      playSound(countdown.seconds === 0 ? "timeup" : countdown.seconds <= 10 ? "countdown"
        : countdown.seconds % 2 ? "tick" : "tock");
    }
    lastSecond = countdown?.seconds;
    if (countdown?.seconds === 0 && !finalTimer) {
      // Allow one final student upload before freezing the top ten.
      finalTimer = state.teacherFinalTimer = setTimeout(() => {
        state.unsubTeacherStudents?.(); state.unsubTeacherRoom?.();
        clearInterval(state.teacherHeartbeatTimer); clearInterval(state.teacherCountdownTimer);
        els.classStatus.textContent = "已結束 · 排行榜已定格";
      }, 20_000);
    }
  };
  state.teacherCountdownTimer = setInterval(updateCountdown, 250);

  let lastDuration;
  state.unsubTeacherRoom = onSnapshot(classroomRef(code), (snapshot) => {
    const room = snapshot.data();
    if (!roomIsOpen(room) || room.sessionId !== state.teacherSessionId) {
      stopTeacherSubscription();
      els.classStatus.textContent = "班級已結束 · 排行榜已定格";
      els.startClassBtn.disabled = true;
      state.teacherCode = "";
      els.teacherAccessNote.textContent = "此課堂已釋放或代碼已重新使用，請重新開課。";
      return;
    }
    state.teacherMaxStudents = room?.maxStudents || classroomSettings.maxStudents;
    const modeName = { beginner: '初級', intermediate: '中級', advanced: '高級' }[room.difficulty] || '漸進模式';
    document.querySelector('#classroomModeHint').textContent = `目前 ${code}：${modeName}。此選單套用於新教室；更換本班模式請先結束班級再開課。`;
    countdownRoom = room;
    updateCountdown();
    const duration = [2, 3, 5, 10].includes(room.durationMinutes) ? room.durationMinutes : 3;
    if (duration !== lastDuration) document.querySelectorAll('[name="durationMinutes"]').forEach(input => { input.checked = Number(input.value) === duration; });
    lastDuration = duration;
    document.querySelector('#durationOptions').disabled = room.status === "active";
    els.startClassBtn.disabled = room.status === "active";
    els.maxStudents.textContent = state.teacherMaxStudents;
    els.studentCount.textContent = room.studentCount || 0;
    els.limitStatus.textContent = (room.studentCount || 0) >= state.teacherMaxStudents ? "已滿" : "可加入";
  }, subscriptionError);

  state.unsubTeacherStudents = onSnapshot(query(currentStudentsQuery(code, state.teacherSessionId), orderBy("score", "desc"), limit(10)), (snapshot) => {
    const students = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((student) => !state.teacherSessionId || student.sessionId === state.teacherSessionId);
    state.rankingCode = code; state.rankingSessionId = state.teacherSessionId;
    state.teacherStudents = students;
    renderTeacherDashboard(students);
  }, subscriptionError);


}

function stopTeacherSubscription() {
  document.querySelector('#classroomModeHint').textContent = '請先選擇模式，再開啟教室。';
  clearTimeout(state.teacherFinalTimer);
  clearInterval(state.teacherCountdownTimer);
  state.teacherCountdownTimer = null;
  clearInterval(state.teacherHeartbeatTimer);
  state.teacherHeartbeatTimer = null;
  state.unsubTeacherRoom?.();
  state.unsubTeacherStudents?.();
  clearInterval(state.teacherRefreshTimer);
  state.unsubTeacherRoom = null;
  state.unsubTeacherStudents = null;
  state.teacherRefreshTimer = null;
  state.teacherStudents = [];
}

function isStudentOnline(student) {
  const seen = timestampMillis(student.lastSeen) || student.onlineAt || 0;
  return seen > 0 && Date.now() - seen <= ONLINE_WINDOW_MS;
}

function updateTeacherAccessUi() {
  els.openClassBtn.disabled = Boolean(els.openClassBtn.dataset.busy);
}

async function ensureTeacherCanOpenClassroom() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  state.teacherEmail = auth.currentUser.uid + "@guest.invalid";
  state.teacherRole = "guest";
  state.teacherHasPriority = false;
}

async function ensureStudentCanJoinClassroom(code) {
  const roomSnapshot = await getDoc(classroomRef(code));
  if (!roomSnapshot.exists() || !roomIsOpen(roomSnapshot.data())) throw new Error("找不到開放中的班級，請向老師確認代碼。");
  const room = roomSnapshot.data();

}

function renderTeacherDashboard(students) {
  const top = [...students]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);
  els.leaderboard.innerHTML = top.length
    ? top.map((student) => `<li><strong>${escapeHtml(student.name)}</strong> ${student.score || 0} 分</li>`).join("")
    : "<li>等待學生加入</li>";


}

async function joinStudent(code, name) {
  await ensureStudentCanJoinClassroom(code);
  state.studentCode = code;
  state.studentName = name;
  let joinedSessionId = "";
  await runTransaction(db, async (transaction) => {
    const roomRef = classroomRef(code);
    const roomSnap = await transaction.get(roomRef);
    if (!roomSnap.exists() || !roomIsOpen(roomSnap.data())) throw new Error("班級已結束，請向老師確認代碼。");

    const room = roomSnap.data();
    const memberRef = studentRef(code, state.studentId, room.sessionId);
    const memberSnap = await transaction.get(memberRef);
    const existingStudent = memberSnap.exists() ? memberSnap.data() : null;
    const sessionId = room.sessionId || "";
    const alreadyInSession = existingStudent?.sessionId === sessionId;
    const maxStudents = room.maxStudents || classroomSettings.maxStudents;
    const currentCount = room.studentCount || 0;
    if (!alreadyInSession && currentCount >= maxStudents) {
      throw new Error("班級人數已滿，無法加入");
    }

    joinedSessionId = sessionId;
    transaction.set(memberRef, {
      name,
      sessionId,
      score: alreadyInSession ? existingStudent.score || 0 : 0,
      status: "joined",
      currentNumber: alreadyInSession ? existingStudent.currentNumber || state.currentNumber
        : { beginner: 12, intermediate: 36, advanced: 72 }[room.difficulty] || 24,
      tasks: alreadyInSession ? existingStudent.tasks || { factors: false, pairs: false, primes: false } : { factors: false, pairs: false, primes: false },
      joinedAt: alreadyInSession ? existingStudent.joinedAt : serverTimestamp(),
      onlineAt: Date.now(),
      lastSeen: serverTimestamp()
    }, { merge: true });

    transaction.update(roomRef, {
      ...(alreadyInSession ? {} : { studentCount: increment(1) }),
      lastStudentSeenAt: serverTimestamp(), studentHeartbeatId: memberRef.id, updatedAt: serverTimestamp()
    });
  });

  state.completedTasks = {};
  state.wrongAttempts = {};
  state.revealedTasks = {};
  state.answers = { factors: [], pairs: [], pairDraft: [], primes: [] };
  state.studentRoundVersion = 0;
  renderAnswers();
  clearQuotaWarning();
  state.studentSessionId = joinedSessionId;
  state.studentFinished = false;
  state.studentReleased = false;
  studentSavedData = null;
  pendingScore = null;
  try { pendingScore = JSON.parse(localStorage.getItem(pendingKey()) || "null"); } catch {}
  startPresence();
  subscribeStudent(code);
}

function subscribeStudent(code) {
  state.unsubStudentRoom?.();
  state.unsubStudentDoc?.();

  let wasActive = false;
  clearInterval(state.studentCountdownTimer);
  state.unsubStudentRoom = onSnapshot(classroomRef(code), (snapshot) => {
    const room = snapshot.data();
    if (!roomIsOpen(room)) {
      showStudentEnded();
      return;
    }
    if (state.studentSessionId && room.sessionId && room.sessionId !== state.studentSessionId) {
      showStudentEnded();
      return;
    }
    state.studentSessionId = room.sessionId || state.studentSessionId;
    state.studentDifficulty = room.difficulty || "";
    clearInterval(state.studentCountdownTimer);
    const tick = () => {
      const remaining = classroomCountdown(room);
      document.querySelector('#studentTimeLeft').textContent = remaining ? `剩餘 ${remaining.text}` : "等待開始";
      if (remaining?.seconds === 0 && !state.studentFinished && studentSavedData) {
        state.studentFinished = true;
        renderTaskCompletion();
        stopPresence();
        clearInterval(state.studentCountdownTimer);
        state.unsubStudentRoom?.(); state.unsubStudentDoc?.();
        (async () => { while (pendingScore) await flushPendingScore(); })().then(() => { els.practiceFeedback.textContent = "時間到，成績已同步。"; })
          .catch(error => { els.practiceFeedback.textContent = `時間到，未同步答案已保留：${databaseError(error)}`; });
      }
    };
    state.studentCountdownTimer = setInterval(tick, 250);
    tick();
    document.querySelector('#studentDifficultyLabel').textContent = `教室模式：${{ beginner: "初級", intermediate: "中級", advanced: "高級" }[state.studentDifficulty] || "漸進練習"}`;
    if (room.status === "active") {
      if (!wasActive) playSound("start");
      wasActive = true;
      els.studentLobby.classList.add("hidden");
      els.practiceView.classList.remove("hidden");
    } else {
      wasActive = false;
      els.studentLobby.classList.remove("hidden");
      els.practiceView.classList.add("hidden");
    }
  }, subscriptionError);

  state.unsubStudentDoc = onSnapshot(studentRef(code), (snapshot) => {
    const data = snapshot.data();
    if (!data) return;
    if (state.currentNumber !== data.currentNumber || state.studentRoundVersion !== (data.roundVersion || 0)) {
      state.answers = { factors: [], pairs: [], pairDraft: [], primes: [] };
    }
    lastStudentActivityAt = timestampMillis(data.lastSeen);
    applyStudentData(data);
  }, subscriptionError);
}

function startPresence() {
  stopPresence();
  const updatePresence = () => writeStudentPresence().catch(error => {
    els.practiceFeedback.textContent = databaseError(error);
  });
  updatePresence();
  state.presenceTimer = setInterval(updatePresence, PRESENCE_INTERVAL_MS);
}

function stopPresence() {
  if (!state.presenceTimer) return;
  clearInterval(state.presenceTimer);
  state.presenceTimer = null;
}

function showStudentEnded() {
  state.studentReleased = true;
  clearInterval(state.studentCountdownTimer);
  stopPresence();
  state.unsubStudentRoom?.();
  state.unsubStudentDoc?.();
  state.studentFinished = true;
  if (pendingScore) els.practiceFeedback.textContent = "班級已釋放，未同步答案仍保留在這台裝置。";
  els.practiceView.classList.add("hidden");
  els.studentLobby.classList.remove("hidden");
  els.lobbyTitle.textContent = "班級已結束";
  els.lobbyText.textContent = "本次課堂已結束，請向老師確認新的班級代碼。";
}

function renderNumberBoard() {
  els.numberBoard.innerHTML = "";
  for (let i = 1; i <= 100; i += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = i;
    button.dataset.value = i;
    button.addEventListener("click", () => addAnswer(i));
    els.numberBoard.append(button);
  }
  updateTargetFocus();
}

function updateTargetFocus() {
  els.targetNumber.textContent = state.currentNumber;
  els.numberBoard.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.value) === state.currentNumber);
  });
}

function addAnswer(value) {
  const task = state.selectedTask;
  if (state.studentTaskBusy || state.completedTasks[task]) return;
  if (task === "factors") {
    if (!state.answers.factors.includes(value)) state.answers.factors.push(value);
  } else if (task === "pairs") {
    state.answers.pairDraft.push(value);
    if (state.answers.pairDraft.length === 2) {
      state.answers.pairs.push([...state.answers.pairDraft]);
      state.answers.pairDraft = [];
    }
  } else {
    state.answers.primes.push(value);
  }
  renderAnswers();
}

function renderAnswers() {
  for (const task of ["factors", "pairs", "primes"]) {
    if (!state.revealedTasks[task]) continue;
    state.answers[task] = task === "factors" ? factorsOf(state.currentNumber)
      : task === "pairs" ? factorPairs(state.currentNumber) : primeFactorsOf(state.currentNumber);
    if (task === "pairs") state.answers.pairDraft = [];
  }
  renderTaskCompletion();
  renderAnswerZone(els.factorAnswer, state.answers.factors);
  renderAnswerZone(els.pairAnswer, [
    ...state.answers.pairs.map((pair) => pair.join(" × ")),
    ...state.answers.pairDraft
  ]);
  renderAnswerZone(els.primeAnswer, state.answers.primes);
}

function renderAnswerZone(zone, values) {
  zone.innerHTML = "";
  if (!values.length) {
    zone.textContent = zone.id === "pairAnswer" ? "每兩個數字形成一組配對" : "點左側數字作答";
    return;
  }
  values.forEach((value) => {
    const token = document.createElement("span");
    token.className = "token";
    token.textContent = value;
    zone.append(token);
  });
}

function renderTaskCompletion() {
  for (const task of ["factors", "pairs", "primes"]) {
    const done = Boolean(state.completedTasks[task]);
    const note = task === "factors" ? els.factorNote : task === "pairs" ? els.pairNote : els.primeNote;
    note.textContent = done ? state.revealedTasks[task] ? "完成（顯示答案，不計分）" : "完成（已計分）"
      : state.wrongAttempts[task] ? `答錯 ${state.wrongAttempts[task]} / 5 次` : "尚未完成";
    note.style.color = done ? "var(--green)" : "";
    const checkButton = document.querySelector(`[data-check="${task}"]`);
    checkButton.disabled = done || state.studentTaskBusy || state.studentFinished;
    checkButton.textContent = done ? "已完成" : state.studentTaskBusy ? "儲存中…" : "確認";
    document.querySelector(`[data-clear="${task}"]`).disabled = done || state.studentTaskBusy;
  }
  els.nextNumberBtn.disabled = state.studentTaskBusy || state.studentFinished;
}

function pendingKey() { return `factor-pending:${state.studentId}:${state.studentCode}:${state.studentSessionId}`; }
let pendingScore = null;
let scoreFlush = null;
let studentSavedData = null;
function storePending(value) {
  // Save before acknowledging the answer. Storage failures leave the answer retryable.
  if (value) localStorage.setItem(pendingKey(), JSON.stringify(value));
  else localStorage.removeItem(pendingKey());
  pendingScore = value;
}
function applyStudentData(data) {
  if (!data) return;
  studentSavedData = data;
  let view = data;
  if (pendingScore) {
    try { view = { ...data, ...mergePendingScore(data, pendingScore) }; }
    catch (error) { els.practiceFeedback.textContent = error.message; }
  }
  state.completedTasks = view.tasks || {};
  state.wrongAttempts = view.wrongAttempts || {};
  state.revealedTasks = view.revealedTasks || {};
  state.studentRoundVersion = view.roundVersion || 0;
  state.score = view.score || 0;
  state.currentNumber = view.currentNumber || state.currentNumber;
  els.studentScore.textContent = state.score;
  renderAnswers();
  updateTargetFocus();
}
async function flushPendingScore() {
  if (scoreFlush) return scoreFlush;
  if (!pendingScore) return;
  const pending = JSON.parse(JSON.stringify(pendingScore));
  const key = pendingKey();
  const code = state.studentCode;
  const ref = studentRef(code);
  scoreFlush = (async () => {
    const saved = await runTransaction(db, async tx => {
      const data = (await tx.get(ref)).data();
      if (!data) throw new Error("找不到學生紀錄，尚未同步的答案已保留。");
      const values = mergePendingScore(data, pending);
      tx.update(ref, { ...values, onlineAt: Date.now(), lastSeen: serverTimestamp() });
      tx.set(presenceRef(pending.sessionId), { code, sessionId: pending.sessionId,
        lastStudentSeenAt: serverTimestamp(), studentHeartbeatId: ref.id }, { merge: true });
      return { ...data, ...values };
    });
    clearQuotaWarning();
    if (key !== pendingKey()) return;
    // Answers entered while a request was in flight remain queued for the next flush.
    if (JSON.stringify(pendingScore) === JSON.stringify(pending)) storePending(null);
    applyStudentData(saved);
    lastStudentActivityAt = Date.now();
    els.practiceFeedback.textContent = pendingScore ? "新答案已暫存，等待同步。" : "成績已同步。";
  })().finally(() => { scoreFlush = null; });
  return scoreFlush;
}
async function checkStudentTask(task) {
  if (!state.studentCode || !state.studentSessionId || state.studentTaskBusy || state.studentFinished || !studentSavedData || state.completedTasks[task]) return;
  const n = state.currentNumber;
  const correct = task === "factors" ? sameNumberList(state.answers.factors, factorsOf(n))
    : task === "pairs" ? state.answers.pairDraft.length === 0 && samePairs(state.answers.pairs, factorPairs(n))
    : JSON.stringify(state.answers.primes) === JSON.stringify(primeFactorsOf(n));
  try {
    const wrong = correct ? state.wrongAttempts[task] || 0 : Math.min(5, (state.wrongAttempts[task] || 0) + 1);
    const pending = pendingScore ? JSON.parse(JSON.stringify(pendingScore)) : {
      sessionId: state.studentSessionId, number: n, round: state.studentRoundVersion, targets: {}
    };
    pending.targets[task] = { done: correct || wrong >= 5, revealed: !correct && wrong >= 5, wrong };
    storePending(pending);
    applyStudentData(studentSavedData);
    playSound(correct ? "correct" : "wrong");
    els.practiceFeedback.textContent = correct ? "答對！已暫存，15 秒內同步成績。"
      : wrong >= 5 ? "答錯 5 次，已顯示答案，本小題不計分。" : `還不正確，已答錯 ${wrong} / 5 次。`;
  } catch (error) { els.practiceFeedback.textContent = `未能暫存，請重試：${error.message}`; }
}

function clearStudentTask(task) {
  if (state.studentTaskBusy || state.completedTasks[task]) return;
  if (task === "pairs") {
    state.answers.pairs = [];
    state.answers.pairDraft = [];
  } else {
    state.answers[task] = [];
  }
  renderAnswers();
}

async function nextNumber() {
  if (!state.studentCode || !state.studentSessionId || state.studentTaskBusy || state.studentFinished) return;
  const sessionId = state.studentSessionId;
  const roundVersion = state.studentRoundVersion;
  const ref = studentRef(state.studentCode);
  const number = chooseNumber();
  state.studentTaskBusy = true;
  renderTaskCompletion();
  try {
    while (pendingScore) await flushPendingScore();
    await runTransaction(db, async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data || data.sessionId !== sessionId || (data.roundVersion || 0) !== roundVersion) {
        throw new Error("題目已更新，請稍後再試。");
      }
      tx.set(presenceRef(sessionId), { code: state.studentCode, sessionId,
        lastStudentSeenAt: serverTimestamp(), studentHeartbeatId: ref.id }, { merge: true });
      tx.update(ref, {
        currentNumber: number, roundVersion: roundVersion + 1,
        tasks: { factors: false, pairs: false, primes: false },
        wrongAttempts: {}, revealedTasks: {},
        onlineAt: Date.now(), lastSeen: serverTimestamp()
      });
    });
    if (state.studentSessionId === sessionId && state.studentRoundVersion <= roundVersion + 1) {
      state.currentNumber = number;
      state.studentRoundVersion = roundVersion + 1;
      state.completedTasks = {};
      state.wrongAttempts = {};
      state.revealedTasks = {};
      state.answers = { factors: [], pairs: [], pairDraft: [], primes: [] };
      renderAnswers();
      updateTargetFocus();
    }
  } catch (error) {
    els.practiceFeedback.textContent = `換題失敗：${databaseError(error)}`;
  } finally {
    state.studentTaskBusy = false;
    renderTaskCompletion();
  }
}

async function endClassroom(code, sessionId = state.teacherSessionId) {
  await updateCurrentRoom(code, sessionId, {
    status: "released", releasedAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
}

async function releaseAllClassrooms() {
  if (!state.adminAccess || els.releaseAllClassroomsBtn.disabled) return;
  els.releaseAllClassroomsBtn.disabled = true;
  els.releaseAllClassroomsBtn.textContent = "讀取班級中…";
  let released = 0;
  let skipped = 0;
  const failed = [];
  try {
    const rooms = await getDocs(collection(db, "classrooms"));
    const targets = rooms.docs.filter((item) => item.data().status !== "released");
    if (!targets.length) {
      els.adminStatus.textContent = "所有班級代碼皆已釋放。";
      return;
    }
    if (!state.adminAccess || !confirm(`確定釋放全部 ${targets.length} 個班級代碼？正在進行的課堂也會結束，學生答題資料將保留。`)) return;
    for (const item of targets) {
      els.releaseAllClassroomsBtn.textContent = `釋放中 ${released + skipped + failed.length + 1} / ${targets.length}`;
      try {
        const changed = await runTransaction(db, async (tx) => {
          if (!state.adminAccess) throw new Error("管理者已登出");
          const current = await tx.get(item.ref);
          if (!current.exists() || current.data().status === "released"
              || current.data().sessionId !== item.data().sessionId) return false;
          tx.update(item.ref, { status: "released", releasedAt: serverTimestamp(), updatedAt: serverTimestamp() });
          return true;
        });
        if (changed) released += 1;
        else skipped += 1;
      } catch {
        failed.push(item.id);
      }
    }
    await loadAdminClassrooms();
    els.adminStatus.textContent = `已釋放 ${released} 個班級代碼，答題資料已保留。`
      + (skipped ? ` ${skipped} 個班級已釋放或已換新課堂，略過。` : "")
      + (failed.length ? ` 釋放失敗：${failed.join("、")}，請重試。` : "");
  } catch (error) {
    els.adminStatus.textContent = `無法釋放全部班級：${error.message}`;
  } finally {
    els.releaseAllClassroomsBtn.disabled = false;
    els.releaseAllClassroomsBtn.textContent = "全部班級代碼釋放";
  }
}

async function loadAdminClassrooms() {
  if (!state.adminAccess) return;
  els.refreshClassroomsBtn.disabled = true;
  try {
    const rooms = await getDocs(activeRoomsQuery());
    const entries = await Promise.all(rooms.docs.filter((item) => item.data().status !== "released").map(async (item) => {
      const room = await activityRoom(item.data());
      const online = Date.now() - timestampMillis(room.lastStudentSeenAt) <= ONLINE_WINDOW_MS;
      return { code: item.id, room, online };
    }));
    if (!state.adminAccess) return;
    els.adminClassroomList.replaceChildren();
    for (const { code, room, online } of entries.sort((a, b) => a.code.localeCompare(b.code))) {
      const row = document.createElement("div");
      row.className = "priority-row";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      const teacherOnline = Date.now() - timestampMillis(room.teacherLastSeenAt) <= ONLINE_WINDOW_MS;
      title.textContent = `${code}｜${teacherOnline || online ? "在線" : canReclaimRoom(room) ? "閒置已到期" : "閒置／保留中"}`;
      const detail = document.createElement("small");
      const lastSeen = Math.max(timestampMillis(room.teacherLastSeenAt), timestampMillis(room.lastStudentSeenAt), timestampMillis(room.updatedAt));
      detail.textContent = `${room.teacherEmail || "舊版：無老師 Email"}｜老師${teacherOnline ? "在線" : "離線"}｜學生近期活動 ${online ? "有" : "無"}｜最後活動 ${lastSeen ? new Date(lastSeen).toLocaleString("zh-TW") : "未知"}`;
      info.append(title, detail);
      const release = document.createElement("button");
      release.type = "button";
      release.className = "danger";
      release.textContent = "釋放班級代碼";
      release.addEventListener("click", async () => {
        if (!confirm(`釋放 ${code}？這會結束該課堂，保留既有答題資料。此操作將結束學生練習。`)) return;
        release.disabled = true;
        try {
          await runTransaction(db, async (tx) => {
            const ref = classroomRef(code);
            const latest = (await tx.get(ref)).data();
            if (!latest || latest.sessionId !== room.sessionId || timestampMillis(latest.createdAt) !== timestampMillis(room.createdAt)) {
              throw new Error("課堂已變更，請重新整理列表後再操作。");
            }
            tx.update(ref, { status: "released", releasedAt: serverTimestamp(), updatedAt: serverTimestamp() });
          });
          await loadAdminClassrooms();
        } catch (error) { els.adminStatus.textContent = databaseError(error); release.disabled = false; }
      });
      row.append(info, release);
      els.adminClassroomList.append(row);
    }
    if (!entries.length) els.adminClassroomList.textContent = "目前沒有尚未釋放的班級。";
  } catch (error) { els.adminStatus.textContent = databaseError(error); }
  finally { els.refreshClassroomsBtn.disabled = false; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function showAdminAccess(access) {
  els.adminPanel.classList.toggle("hidden", access.role !== "admin");
  els.adminStatus.textContent = access.role === "admin" ? "已登入，可釋放班級代碼。" : "請使用管理員 Google 帳號登入。";
  els.superAdminTools.classList.toggle("hidden", access.role !== "admin");
}

function showAdminError(error) {
  databaseError(error);
  els.adminStatus.textContent = getGoogleLoginErrorMessage(error);
}

function getGoogleLoginErrorMessage(error) {
  if (["auth/configuration-not-found", "auth/operation-not-allowed"].includes(error?.code)) {
    return "Google 登入服務尚未啟用，請聯絡管理者。";
  }
  if (error?.code === "auth/popup-blocked") return "請允許這個網站開啟彈出視窗，再按 Google 登入。";
  if (error?.code === "auth/popup-closed-by-user") return "登入視窗已關閉，請再次點選 Google 登入完成驗證。";
  if (error?.code === "auth/unauthorized-domain") return "這個網址尚未獲准使用 Google 登入，請聯絡管理者。";
  return `Google 登入失敗：${error?.code || "unknown"} ${error?.message || ""}`;
}

async function startGoogleLogin(source) {
  const provider = new GoogleAuthProvider();
  const email = SUPER_ADMIN_EMAIL;
  provider.setCustomParameters({ prompt: "select_account", ...(email ? { login_hint: email } : {}) });
  // Popup avoids cross-site redirect state being lost on GitHub Pages.
  sessionStorage.removeItem("factor-login-source");
  await signInWithPopup(auth, provider);
  if (source === "admin") switchView("admin");
}

function stopAccessSubscriptions() {
  els.adminClassroomList.replaceChildren();
  els.superAdminTools.classList.add("hidden");
}

function handleAdminAuth(user) {
  const access = resolveTeacherAccess(user);
  if (access.role !== "admin" || state.authUser?.uid !== user?.uid) {
    stopAccessSubscriptions();
    state.adminClassroomsLoaded = false;
  }
  state.authUser = user;
  state.adminAccess = access.role === "admin";
  showAdminAccess(access);
  els.adminLoginBtn.classList.toggle("hidden", state.adminAccess);
  els.teacherLogoutBtn.classList.toggle("hidden", !state.adminAccess);
  if (!state.adminAccess || !canUseDatabase()) return;
  if (!state.adminClassroomsLoaded) { state.adminClassroomsLoaded = true; loadAdminClassrooms(); }

}

els.refreshClassroomsBtn.addEventListener("click", loadAdminClassrooms);
els.releaseAllClassroomsBtn.addEventListener("click", releaseAllClassrooms);

els.tabs.forEach((tab) => {
  if (tab.tagName === "A") return;
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

function setButtonBusy(button, busy, label) {
  if (busy) button.dataset.busy = "true";
  else delete button.dataset.busy;
  button.setAttribute("aria-busy", String(busy));
  button.disabled = busy;
  button.textContent = label;
}

els.teacherForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (els.openClassBtn.dataset.busy) return;
  const code = normalizeCode(els.teacherCode.value);
  if (!code) return;
  try {
    setButtonBusy(els.openClassBtn, true, "開啟中…");
    await ensureTeacherCanOpenClassroom();
    const previousCode = state.teacherCode;
    const previousSessionId = state.teacherSessionId;
    await openClassroom(code);
    if (previousCode && previousCode !== code) await endClassroom(previousCode, previousSessionId);
    stopTeacherSubscription();
    state.teacherCode = code;
    els.teacherRoomCode.textContent = code;
    els.teacherRoom.classList.remove("hidden");
    els.classStatus.textContent = "等待中";
    renderTeacherDashboard([]);
    subscribeTeacher(code);
    startTeacherHeartbeat(code);
  } catch (error) {
    els.teacherAccessNote.textContent = databaseError(error);
  } finally {
    setButtonBusy(els.openClassBtn, false, "開啟教室");
    els.openClassBtn.disabled = Boolean(els.openClassBtn.dataset.busy);
  }
});

els.startClassBtn.addEventListener("click", async () => {
  if (!state.teacherCode || els.startClassBtn.disabled) return;
  const durationMinutes = Number(document.querySelector('[name="durationMinutes"]:checked')?.value || 3);
  if (![2, 3, 5, 10].includes(durationMinutes)) return;
  els.startClassBtn.disabled = true;
  document.querySelector('#durationOptions').disabled = true;
  try {
    await updateCurrentRoom(state.teacherCode, state.teacherSessionId, { status: "active", durationMinutes, startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    playSound("start");
  } catch (error) {
    els.startClassBtn.disabled = false;
    document.querySelector('#durationOptions').disabled = false;
    els.teacherAccessNote.textContent = databaseError(error);
  }
});

els.endClassBtn.addEventListener("click", async () => {
  if (!state.teacherCode || !confirm(`請先確認學生已顯示「成績已同步」。確定結束 ${state.teacherCode} 並釋放代碼？釋放後不再接受補傳，已儲存的資料會保留。`)) return;
  try {
    await endClassroom(state.teacherCode);
    stopTeacherSubscription();
    els.classStatus.textContent = "班級已結束 · 排行榜已定格";
    els.startClassBtn.disabled = true;
    state.teacherCode = "";
    state.teacherSessionId = "";
  } catch (error) { els.teacherAccessNote.textContent = databaseError(error); }
});

els.studentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (els.studentJoinBtn.disabled) return;
  const code = normalizeCode(els.studentCode.value);
  const name = els.studentName.value.trim();
  els.studentJoinError.hidden = true;
  setButtonBusy(els.studentJoinBtn, true, "加入中…");
  try {
    if (!code || !name) throw new Error("請填寫班級代碼與姓名。");
    els.studentCode.value = code;
    await joinStudent(code, name);
    els.studentLobby.classList.remove("hidden");
    els.studentLobby.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (error) {
    els.studentJoinError.textContent = databaseError(error);
    els.studentJoinError.hidden = false;
  } finally {
    setButtonBusy(els.studentJoinBtn, false, "加入班級");
  }
});

document.querySelectorAll(".task-card").forEach((card) => {
  card.addEventListener("click", () => {
    state.selectedTask = card.dataset.task;
    document.querySelectorAll(".task-card").forEach((item) => item.classList.remove("selected"));
    card.classList.add("selected");
  });
});

document.querySelectorAll("[data-check]").forEach((button) => {
  button.addEventListener("click", () => checkStudentTask(button.dataset.check));
});

document.querySelectorAll("[data-clear]").forEach((button) => {
  button.addEventListener("click", () => clearStudentTask(button.dataset.clear));
});

els.nextNumberBtn.addEventListener("click", nextNumber);

els.teacherLogoutBtn.addEventListener("click", async () => {
  await signOut(auth).catch(showAdminError);
});

els.adminLoginBtn.addEventListener("click", async () => {
  els.adminLoginBtn.disabled = true;
  els.adminStatus.textContent = "正在前往 Google 登入...";
  await startGoogleLogin("admin").catch(showAdminError).finally(() => { els.adminLoginBtn.disabled = false; });
});

const loginSource = sessionStorage.getItem("factor-login-source");
if (loginSource === "admin") switchView("admin");
else {
  const requestedView = new URLSearchParams(location.search).get("view");
  if (["student", "admin"].includes(requestedView)) switchView(requestedView);
}
getRedirectResult(auth).catch((error) => {
  if (loginSource === "admin") showAdminError(error);
  else els.teacherAccessNote.textContent = getGoogleLoginErrorMessage(error);
}).finally(() => sessionStorage.removeItem("factor-login-source"));

onAuthStateChanged(auth, handleAdminAuth);
updateTeacherAccessUi();
renderNumberBoard();
renderAnswers();

// Background tabs pause subscriptions and leases. Returning resumes with a fresh snapshot.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTeacherSubscription();
    stopPresence();
    clearInterval(state.studentCountdownTimer);
    state.unsubStudentRoom?.(); state.unsubStudentDoc?.();
      return;
  }
  if (!canUseDatabase()) return;
  if (state.teacherCode) { subscribeTeacher(state.teacherCode); startTeacherHeartbeat(state.teacherCode); }
  if (state.studentCode && !state.studentFinished) { subscribeStudent(state.studentCode); startPresence(); }
  if (state.adminAccess && document.body.dataset.view === "admin") handleAdminAuth(auth.currentUser);
});

setInterval(() => {
  if (pendingScore && !state.studentReleased && canUseDatabase()) flushPendingScore().catch(error => {
    els.practiceFeedback.textContent = `尚未同步，答案已保留：${databaseError(error)}`;
  });
}, 15_000);
window.addEventListener("online", () => { if (!state.studentReleased) flushPendingScore().catch(subscriptionError); });
window.addEventListener("beforeunload", event => {
  if (!pendingScore) return;
  event.preventDefault(); event.returnValue = "";
});

document.querySelector('#refreshRankingBtn').addEventListener('click', async event => {
  if (!state.rankingCode || !state.rankingSessionId) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await getDocs(query(currentStudentsQuery(state.rankingCode, state.rankingSessionId), orderBy('score', 'desc'), limit(10)));
    renderTeacherDashboard(result.docs.map(item => item.data()));
  } catch (error) { els.teacherAccessNote.textContent = databaseError(error); }
  finally { button.disabled = false; }
});
