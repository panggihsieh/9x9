import { playSound } from "./sound.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  GoogleAuthProvider,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  signOut,
  signInAnonymously,
  signInWithRedirect
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  deleteDoc,
  setDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { classroomSettings, firebaseConfig } from "./firebase-config.js";
import { SUPER_ADMIN_EMAIL, resolveTeacherAccess } from "./teacher-access.js?v=20260916-firestore-pin";

import { canReclaimRoom, roomIsOpen, timestampMillis } from "./room-lifecycle.mjs";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const ONLINE_WINDOW_MS = 45_000;
const PRESENCE_INTERVAL_MS = 15_000;

const els = {
  tabs: document.querySelectorAll(".tab[data-view]"),
  views: {
    teacher: document.querySelector("#teacherView"),
    student: document.querySelector("#studentView"),
    admin: document.querySelector("#adminView")
  },
  teacherForm: document.querySelector("#teacherForm"),
  teacherCode: document.querySelector("#teacherCode"),
  teacherLoginBtn: document.querySelector("#teacherLoginBtn"),
  teacherIdentityForm: document.querySelector("#teacherIdentityForm"),
  teacherGmail: document.querySelector("#teacherGmail"),
  teacherPasscode: document.querySelector("#teacherPasscode"),
  teacherAccessNote: document.querySelector("#teacherAccessNote"),
  openClassBtn: document.querySelector("#openClassBtn"),
  teacherLogoutBtn: document.querySelector("#teacherLogoutBtn"),
  teacherAuthStatus: document.querySelector("#teacherAuthStatus"),
  teacherGlobalOnline: document.querySelector("#teacherGlobalOnline"),
  teacherRoom: document.querySelector("#teacherRoom"),
  teacherRoomCode: document.querySelector("#teacherRoomCode"),
  studentCount: document.querySelector("#studentCount"),
  onlineCount: document.querySelector("#onlineCount"),
  maxStudents: document.querySelector("#maxStudents"),
  limitStatus: document.querySelector("#limitStatus"),
  classStatus: document.querySelector("#classStatus"),
  leaderboard: document.querySelector("#leaderboard"),
  studentRoster: document.querySelector("#studentRoster"),
  taskStatusLists: {
    factors: document.querySelector("#factorStatusList"),
    pairs: document.querySelector("#pairStatusList"),
    primes: document.querySelector("#primeStatusList")
  },
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
  adminEmail: document.querySelector("#adminEmail"),
  adminName: document.querySelector("#adminName"),
  adminRole: document.querySelector("#adminRole"),
  adminPriority: document.querySelector("#adminPriority"),
  superAdminTools: document.querySelector("#superAdminTools"),
  priorityTeacherForm: document.querySelector("#priorityTeacherForm"),
  priorityTeacherEmail: document.querySelector("#priorityTeacherEmail"),
  priorityTeacherLevel: document.querySelector("#priorityTeacherLevel"),
  priorityTeacherPasscode: document.querySelector("#priorityTeacherPasscode"),
  priorityTeacherList: document.querySelector("#priorityTeacherList"),
  adminClassroomList: document.querySelector("#adminClassroomList"),
  refreshClassroomsBtn: document.querySelector("#refreshClassroomsBtn"),
  releaseAllClassroomsBtn: document.querySelector("#releaseAllClassroomsBtn")
};

const state = {
  teacherCode: "",
  studentCode: "",
  studentId: localStorage.getItem("factor-v3-student-id") || crypto.randomUUID(),
  studentName: "",
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
  teacherRegistered: false,
  globalOnlineCount: null,
  accessReady: false,
  teacherVerificationError: "",
  teacherToken: "",
  teacherExpiresAt: 0,
  identityRevision: 0,
  authRevision: 0,
  unsubTeacherGrants: null,
  teacherGrants: [],
  teacherSessionId: "",
  teacherMaxStudents: classroomSettings.maxStudents,
  teacherStudents: [],
  studentSessionId: "",
  unsubTeacherRoom: null,
  unsubTeacherStudents: null,
  unsubStudentRoom: null,
  unsubStudentDoc: null,
  teacherRefreshTimer: null,
  teacherHeartbeatTimer: null,
  presenceTimer: null
};

localStorage.setItem("factor-v3-student-id", state.studentId);

// 明確初始化，避免舊表單還原或空白偏好覆蓋內建值。
els.teacherGmail.value = "guest@gmail.com";
els.teacherCode.value = "5188";
els.teacherPasscode.type = "text";
els.teacherPasscode.value = "1234";

// 僅記住老師帳號及班級代碼；不儲存通行碼或視為已驗證。
for (const [input, key] of [
  [els.teacherGmail, "factor-v3-teacher-gmail"],
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

function normalizeEmail(value) {
  return value.trim().toLowerCase();
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
  const values = Array.from({ length: 99 }, (_, index) => index + 2)
    .filter((value) => primeFactorsOf(value).length >= 2);
  return values[Math.floor(Math.random() * values.length)];
}

async function openClassroom(code) {
  const sessionId = await runTransaction(db, async (tx) => {
    const ref = classroomRef(code);
    const snapshot = await tx.get(ref);
    const room = snapshot.data();
    if (room && room.teacherEmail === state.teacherEmail && roomIsOpen(room)) {
      tx.update(ref, { teacherUid: auth.currentUser.uid, teacherLastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return room.sessionId;
    }
    if (room && !canReclaimRoom(room)) {
      throw new Error(!room.teacherEmail
        ? "這是舊版保留的班級代碼，請 admin 在後台釋放。"
        : "此班級仍有老師或學生近期活動；雙方離線滿 5 分鐘後可重新使用，或請 admin 釋放。");
    }
    if (room) tx.set(doc(db, "classrooms", code, "sessions", room.sessionId || "legacy"), room);
    const nextSessionId = crypto.randomUUID();
    tx.set(ref, { code, sessionId: nextSessionId, teacherUid: auth.currentUser.uid,
      teacherEmail: state.teacherEmail, teacherRole: state.teacherRole, teacherHasPriority: state.teacherHasPriority,
      status: "waiting", maxStudents: classroomSettings.maxStudents, studentCount: 0,
      teacherLastSeenAt: serverTimestamp(), lastStudentSeenAt: serverTimestamp(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return nextSessionId;
  });
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
  const heartbeat = () => updateCurrentRoom(code, sessionId, {
    teacherLastSeenAt: serverTimestamp(), updatedAt: serverTimestamp()
  }).catch(() => {
    clearInterval(state.teacherHeartbeatTimer);
    els.teacherAccessNote.textContent = "老師連線回報失敗，請重新驗證並開啟原班級。";
  });
  heartbeat();
  state.teacherHeartbeatTimer = setInterval(heartbeat, PRESENCE_INTERVAL_MS);
}

function subscribeTeacher(code) {
  state.unsubTeacherRoom?.();
  state.unsubTeacherStudents?.();
  clearInterval(state.teacherRefreshTimer);

  let lastDuration;
  state.unsubTeacherRoom = onSnapshot(classroomRef(code), (snapshot) => {
    const room = snapshot.data();
    if (!roomIsOpen(room) || room.sessionId !== state.teacherSessionId) {
      stopTeacherSubscription();
      els.teacherRoom.classList.add("hidden");
      state.teacherCode = "";
      els.teacherAccessNote.textContent = "此課堂已釋放或代碼已重新使用，請重新開課。";
      return;
    }
    state.teacherMaxStudents = room?.maxStudents || classroomSettings.maxStudents;
    els.classStatus.textContent = room?.status === "active" ? "練習中" : "等待中";
    const duration = [2, 3, 5, 10].includes(room.durationMinutes) ? room.durationMinutes : 3;
    if (duration !== lastDuration) document.querySelectorAll('[name="durationMinutes"]').forEach(input => { input.checked = Number(input.value) === duration; });
    lastDuration = duration;
    document.querySelector('#durationOptions').disabled = room.status === "active";
    els.startClassBtn.disabled = room.status === "active";
    if (room.status === "active") els.classStatus.textContent = `練習中 · ${duration} 分鐘`;
    els.maxStudents.textContent = state.teacherMaxStudents;
  });

  state.unsubTeacherStudents = onSnapshot(studentsRef(code), (snapshot) => {
    const students = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((student) => !state.teacherSessionId || student.sessionId === state.teacherSessionId);
    state.teacherStudents = students;
    renderTeacherDashboard(students);
  });

  state.teacherRefreshTimer = setInterval(() => {
    renderTeacherDashboard(state.teacherStudents);
  }, PRESENCE_INTERVAL_MS);
}

function stopTeacherSubscription() {
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
  return typeof student.onlineAt === "number" && Date.now() - student.onlineAt <= ONLINE_WINDOW_MS;
}

function updateTeacherAccessUi() {
  const onlineLimit = classroomSettings.maxGlobalOnline || classroomSettings.maxStudents;
  els.teacherGlobalOnline.textContent = state.globalOnlineCount === null
    ? "讀取中" : `${state.globalOnlineCount} / ${onlineLimit}`;
  const displayRole = state.accessReady
    ? state.teacherEmail === SUPER_ADMIN_EMAIL ? "admin" : state.teacherRole : "guest";
  els.teacherAuthStatus.dataset.role = displayRole;
  els.teacherAuthStatus.textContent = { admin: "admin｜最高", auth: "auth｜優先", guest: "guest｜一般" }[displayRole] || "尚未驗證";
  els.teacherLoginBtn.textContent = els.teacherLoginBtn.dataset.busy ? "驗證中…" : "驗證優先權";
  els.openClassBtn.disabled = Boolean(els.openClassBtn.dataset.busy);
  els.teacherAccessNote.textContent = state.teacherVerificationError || (!state.accessReady
    ? "只輸入班級代碼即可用 guest 開課；驗證 Gmail 與通行碼可取得優先權。"
    : !state.teacherRegistered ? "未列入老師名單，請聯絡 admin 新增。"
    : displayRole === "admin" ? "admin 帳號｜可優先開課；管理名單請至後台登入。"
    : state.teacherHasPriority ? "auth｜admin 已設定為優先使用，可開啟教室。" : "guest｜一般優先權，可開啟教室。");
}

function resetTeacherVerification() {
  state.identityRevision += 1;
  state.teacherVerificationError = "";
  state.accessReady = false;
  state.teacherRole = null;
  state.teacherHasPriority = false;
  state.teacherRegistered = false;
  state.teacherToken = "";
  state.teacherExpiresAt = 0;
  updateTeacherAccessUi();
}

async function verifyTeacher({ email, passcode }) {
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) || !/^[0-9]{4}$/.test(passcode)) {
    throw new Error("請輸入有效的 Gmail 與 4 位數字通行碼。");
  }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  await deleteDoc(doc(db, "teacherSessions", uid));
  const attemptRef = doc(db, "teacherAttempts", email);
  const attempt = { uid, passcode, attemptedAt: serverTimestamp() };
  try {
    await updateDoc(attemptRef, { ...attempt, count: increment(1) });
  } catch (error) {
    if (!["permission-denied", "not-found"].includes(error.code)) throw error;
    try {
      await setDoc(attemptRef, { ...attempt, count: 1, windowStartedAt: serverTimestamp() });
    } catch (resetError) {
      if (resetError.code !== "permission-denied") throw resetError;
      throw new Error("驗證過於頻繁，請稍候重試；每個帳號 15 分鐘最多驗證 5 次。");
    }
  }
  const roles = email === SUPER_ADMIN_EMAIL ? ["admin"] : ["auth", "guest"];
  for (const role of roles) {
    try {
      await setDoc(doc(db, "teacherSessions", uid), { email, passcode, role, verifiedAt: serverTimestamp() });
      return { data: { email, role, hasPriority: role !== "guest", registered: true,
        expiresAt: Date.now() + 8 * 60 * 60_000 } };
    } catch (error) {
      if (error.code !== "permission-denied") throw error;
    }
  }
  throw new Error("Gmail 或通行碼錯誤，或 admin 尚未設定通行碼。");
}

async function saveTeacher({ email, role, passcode = "", remove = false }) {
  email = normalizeEmail(email);
  if (!state.adminAccess) throw new Error("只有 admin 可以設定通行碼。");
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) throw new Error("請輸入有效的 Email。");
  const ref = doc(db, "admins", email);
  if (remove) {
    if (email === SUPER_ADMIN_EMAIL) throw new Error("無法移除最高管理者。");
    await deleteDoc(ref);
    return;
  }
  const existing = await getDoc(ref);
  const value = passcode || existing.data()?.passcode;
  if (!/^[0-9]{4}$/.test(value || "")) throw new Error("請設定 4 位數字通行碼（例如 0037）。");
  await setDoc(ref, { email, role: email === SUPER_ADMIN_EMAIL ? "admin" : role,
    passcode: value, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
}

async function refreshTeacherAccess() {
  const revision = state.identityRevision;
  const email = normalizeEmail(els.teacherGmail.value);
  const { data: access } = await verifyTeacher({ email, passcode: els.teacherPasscode.value });
  if (revision !== state.identityRevision) return;
  state.teacherEmail = access.email;
  state.teacherRole = access.role;
  state.teacherHasPriority = access.hasPriority;
  state.teacherRegistered = access.registered;
  state.teacherToken = auth.currentUser.uid;
  state.teacherExpiresAt = access.expiresAt;
  state.accessReady = true;
  els.teacherPasscode.value = "";
  updateTeacherAccessUi();
}

async function refreshGlobalOnlineCount() {
  const rooms = await getDocs(collection(db, "classrooms"));
  await Promise.all(rooms.docs.filter((item) => roomIsOpen(item.data()) && canReclaimRoom(item.data())).map(async (item) => {
    try {
      await runTransaction(db, async (tx) => {
        const latest = (await tx.get(item.ref)).data();
        if (!roomIsOpen(latest) || !canReclaimRoom(latest)) return;
        tx.update(item.ref, { status: "released", releasedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
    } catch (error) {
      // Server rules take precedence over the browser clock and concurrent activity.
      if (error.code !== "permission-denied") console.warn("閒置教室檢查暫時失敗", error.code);
    }
  }));
  const counts = await Promise.all(rooms.docs.map(async (room) => {
    const members = await getDocs(studentsRef(room.id));
    return members.docs.filter((member) => member.data().sessionId === room.data().sessionId
      && isStudentOnline(member.data())).length;
  }));
  state.globalOnlineCount = counts.reduce((total, count) => total + count, 0);
  updateTeacherAccessUi();
  return state.globalOnlineCount;
}

async function ensureTeacherCanOpenClassroom() {
  if (!state.accessReady || state.teacherEmail !== normalizeEmail(els.teacherGmail.value)
      || Date.now() >= state.teacherExpiresAt) {
    resetTeacherVerification();
    if (!auth.currentUser) await signInAnonymously(auth);
    const email = auth.currentUser.uid + "@guest.invalid";
    await setDoc(doc(db, "teacherSessions", auth.currentUser.uid), {
      email, role: "guest", passcode: "", verifiedAt: serverTimestamp()
    });
    state.teacherEmail = email;
    state.teacherRole = "guest";
    state.teacherHasPriority = false;
    state.teacherRegistered = true;
    state.accessReady = true;
    state.teacherExpiresAt = Date.now() + 8 * 60 * 60 * 1000;
    updateTeacherAccessUi();
  }
  const online = await refreshGlobalOnlineCount();
  if (!state.teacherHasPriority && online >= classroomSettings.maxGlobalOnline) throw new Error("全站已滿，guest 暫時不能開課。");
}

async function ensureStudentCanJoinClassroom(code) {
  const roomSnapshot = await getDoc(classroomRef(code));
  if (!roomSnapshot.exists() || !roomIsOpen(roomSnapshot.data())) throw new Error("找不到開放中的班級，請向老師確認代碼。");
  const room = roomSnapshot.data();
  const onlineCount = await refreshGlobalOnlineCount();
  const onlineLimit = classroomSettings.maxGlobalOnline || classroomSettings.maxStudents;
  if (!room.teacherHasPriority && onlineCount >= onlineLimit) {
    throw new Error(`目前全站同時上線 ${onlineCount} 人，已達 ${onlineLimit} 人上限。這個班級不是優先權老師開課，暫時不能加入。`);
  }
}

function renderTeacherDashboard(students) {
  els.studentCount.textContent = students.length;
  const onlineCount = students.filter((student) => isStudentOnline(student)).length;
  const limitReached = students.length >= state.teacherMaxStudents;
  els.onlineCount.textContent = onlineCount;
  els.limitStatus.textContent = limitReached ? "✕ 已限制" : "✓ 可加入";
  els.limitStatus.classList.toggle("closed", limitReached);
  els.limitStatus.classList.toggle("open", !limitReached);

  const top = [...students]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);
  els.leaderboard.innerHTML = top.length
    ? top.map((student) => `<li><strong>${escapeHtml(student.name)}</strong> ${student.score || 0} 分</li>`).join("")
    : "<li>等待學生加入</li>";

  els.studentRoster.innerHTML = "";
  Object.values(els.taskStatusLists).forEach((list) => list.innerHTML = "");
  students
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .forEach((student) => {
      const rosterRow = document.querySelector("#rosterRowTemplate").content.firstElementChild.cloneNode(true);
      rosterRow.querySelector("[data-name]").textContent = student.name;
      rosterRow.querySelector("[data-score]").textContent = `${student.score || 0} 分`;
      els.studentRoster.append(rosterRow);

      ["factors", "pairs", "primes"].forEach((task) => {
        const row = document.querySelector("#taskStatusRowTemplate").content.firstElementChild.cloneNode(true);
        const done = Boolean(student.tasks?.[task]);
        row.querySelector("[data-name]").textContent = student.name;
        const stateCell = row.querySelector("[data-state]");
        stateCell.textContent = done ? "完成" : "進行中";
        stateCell.classList.toggle("done", done);
        stateCell.classList.toggle("working", !done);
        els.taskStatusLists[task].append(row);
      });
    });
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
      currentNumber: alreadyInSession ? existingStudent.currentNumber || state.currentNumber : state.currentNumber,
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
  state.studentSessionId = joinedSessionId;
  startPresence();
  subscribeStudent(code);
}

function subscribeStudent(code) {
  state.unsubStudentRoom?.();
  state.unsubStudentDoc?.();

  let wasActive = false;
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
  });

  state.unsubStudentDoc = onSnapshot(studentRef(code), (snapshot) => {
    const data = snapshot.data();
    if (!data) return;
    if (state.currentNumber !== data.currentNumber || state.studentRoundVersion !== (data.roundVersion || 0)) {
      state.answers = { factors: [], pairs: [], pairDraft: [], primes: [] };
    }
    state.completedTasks = data.tasks || {};
    state.wrongAttempts = data.wrongAttempts || {};
    state.revealedTasks = data.revealedTasks || {};
    state.studentRoundVersion = data.roundVersion || 0;
    state.score = data.score || 0;
    state.currentNumber = data.currentNumber || state.currentNumber;
    els.studentScore.textContent = state.score;
    renderAnswers();
    updateTargetFocus();
  });
}

function startPresence() {
  stopPresence();
  const updatePresence = () => {
    if (!state.studentCode || !state.studentSessionId) return;
    const code = state.studentCode;
    const sessionId = state.studentSessionId;
    const memberRef = studentRef(code, state.studentId, sessionId);
    runTransaction(db, async (tx) => {
      const ref = classroomRef(code);
      const room = (await tx.get(ref)).data();
      if (!roomIsOpen(room) || room.sessionId !== sessionId) return;
      tx.update(memberRef, { onlineAt: Date.now(), lastSeen: serverTimestamp() });
      tx.update(ref, { lastStudentSeenAt: serverTimestamp(), studentHeartbeatId: memberRef.id });
    }).catch(() => {});
  };
  updatePresence();
  state.presenceTimer = setInterval(updatePresence, PRESENCE_INTERVAL_MS);
}

function stopPresence() {
  if (!state.presenceTimer) return;
  clearInterval(state.presenceTimer);
  state.presenceTimer = null;
}

function showStudentEnded() {
  stopPresence();
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
    checkButton.disabled = done || state.studentTaskBusy;
    checkButton.textContent = done ? "已完成" : state.studentTaskBusy ? "儲存中…" : "確認";
    document.querySelector(`[data-clear="${task}"]`).disabled = done || state.studentTaskBusy;
  }
  els.nextNumberBtn.disabled = state.studentTaskBusy;
}

async function checkStudentTask(task) {
  if (!state.studentCode || !state.studentSessionId || state.studentTaskBusy || state.completedTasks[task]) return;
  const n = state.currentNumber;
  const roundVersion = state.studentRoundVersion;
  const sessionId = state.studentSessionId;
  const ref = studentRef(state.studentCode);
  let correct = false;
  if (task === "factors") correct = sameNumberList(state.answers.factors, factorsOf(n));
  if (task === "pairs") correct = state.answers.pairDraft.length === 0 && samePairs(state.answers.pairs, factorPairs(n));
  if (task === "primes") correct = JSON.stringify(state.answers.primes) === JSON.stringify(primeFactorsOf(n));
  state.studentTaskBusy = true;
  renderTaskCompletion();
  try {
    const result = await runTransaction(db, async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data || data.sessionId !== sessionId || data.currentNumber !== n
          || (data.roundVersion || 0) !== roundVersion) throw new Error("題目已更新，請依目前題目作答。");
      if (data.tasks?.[task]) return { done: true, revealed: Boolean(data.revealedTasks?.[task]), awarded: false };
      if (!correct) {
        const attempts = Math.min(5, (data.wrongAttempts?.[task] || 0) + 1);
        const revealed = attempts >= 5;
        tx.update(ref, {
          [`wrongAttempts.${task}`]: attempts,
          ...(revealed ? { [`tasks.${task}`]: true, [`revealedTasks.${task}`]: true } : {}),
          onlineAt: Date.now(), lastSeen: serverTimestamp()
        });
        return { done: revealed, revealed, attempts, awarded: false };
      }
      tx.update(ref, {
        [`tasks.${task}`]: true,
        score: (data.score || 0) + (task === "pairs" ? 18 : 14),
        onlineAt: Date.now(), lastSeen: serverTimestamp()
      });
      return { done: true, revealed: false, awarded: true };
    });
    if (state.studentSessionId === sessionId && state.currentNumber === n && state.studentRoundVersion === roundVersion) {
      state.completedTasks[task] = result.done;
      state.revealedTasks[task] = result.revealed;
      if (result.attempts) state.wrongAttempts[task] = result.attempts;
      renderAnswers();
    }
    playSound(result.awarded ? "correct" : "wrong");
    els.practiceFeedback.textContent = result.awarded ? "已計分並同步給老師。"
      : result.revealed ? "答錯 5 次，已顯示正確答案，本小題不計分。"
      : result.done ? "這一小題已完成，不會重複加分。" : `還不正確，已答錯 ${result.attempts} / 5 次。`;
  } catch (error) {
    els.practiceFeedback.textContent = `計分未完成：${error.message}`;
  } finally {
    state.studentTaskBusy = false;
    renderTaskCompletion();
  }
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
  if (!state.studentCode || !state.studentSessionId || state.studentTaskBusy) return;
  const sessionId = state.studentSessionId;
  const roundVersion = state.studentRoundVersion;
  const ref = studentRef(state.studentCode);
  const number = chooseNumber();
  state.studentTaskBusy = true;
  renderTaskCompletion();
  try {
    await runTransaction(db, async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data || data.sessionId !== sessionId || (data.roundVersion || 0) !== roundVersion) {
        throw new Error("題目已更新，請稍後再試。");
      }
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
    els.practiceFeedback.textContent = `換題失敗：${error.message}`;
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
    const rooms = await getDocs(collection(db, "classrooms"));
    const entries = await Promise.all(rooms.docs.map(async (item) => {
      const room = item.data();
      const members = await getDocs(studentsRef(item.id));
      const online = members.docs.filter((member) => member.data().sessionId === room.sessionId && isStudentOnline(member.data())).length;
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
      title.textContent = `${code}｜${room.status === "released" ? "已釋放" : teacherOnline || online ? "在線" : canReclaimRoom(room) ? "閒置已到期" : "閒置／保留中"}`;
      const detail = document.createElement("small");
      const lastSeen = Math.max(timestampMillis(room.teacherLastSeenAt), timestampMillis(room.lastStudentSeenAt), timestampMillis(room.updatedAt));
      detail.textContent = `${room.teacherEmail || "舊版：無老師 Email"}｜老師${teacherOnline ? "在線" : "離線"}｜在線學生 ${online} 人｜最後活動 ${lastSeen ? new Date(lastSeen).toLocaleString("zh-TW") : "未知"}`;
      info.append(title, detail);
      const release = document.createElement("button");
      release.type = "button";
      release.className = "danger";
      release.textContent = "釋放班級代碼";
      release.disabled = room.status === "released";
      release.addEventListener("click", async () => {
        if (!confirm(`釋放 ${code}？這會結束該課堂，保留既有答題資料。畫面載入時有 ${online} 位學生在線。`)) return;
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
        } catch (error) { els.adminStatus.textContent = error.message; release.disabled = false; }
      });
      row.append(info, release);
      els.adminClassroomList.append(row);
    }
    if (!entries.length) els.adminClassroomList.textContent = "目前沒有班級紀錄。";
  } catch (error) { els.adminStatus.textContent = error.message; }
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

function showAdminAccess(user, access) {
  els.adminPanel.classList.toggle("hidden", access.role !== "admin");
  els.adminEmail.textContent = access.email || "尚未登入";
  els.adminName.textContent = user?.displayName || "--";
  els.adminRole.textContent = access.label;
  els.adminRole.className = "role-badge";
  els.adminRole.dataset.role = access.role || "";
  els.adminPriority.textContent = access.priority;
  els.adminStatus.textContent = access.role === "admin" ? "admin｜最高管理者" : "後台僅限 admin 登入";
  els.superAdminTools.classList.toggle("hidden", access.role !== "admin");
}

function showAdminError(error) {
  els.adminStatus.textContent = getGoogleLoginErrorMessage(error);
}

function getGoogleLoginErrorMessage(error) {
  if (["auth/configuration-not-found", "auth/operation-not-allowed"].includes(error?.code)) {
    return "Google 登入服務尚未啟用，請聯絡管理者。";
  }
  if (error?.code === "auth/unauthorized-domain") return "這個網址尚未獲准使用 Google 登入，請聯絡管理者。";
  return `Google 登入失敗：${error?.code || "unknown"} ${error?.message || ""}`;
}

async function startGoogleLogin(source) {
  const provider = new GoogleAuthProvider();
  const email = source === "admin" ? SUPER_ADMIN_EMAIL : normalizeEmail(els.teacherGmail.value || "");
  provider.setCustomParameters({ prompt: "select_account", ...(email ? { login_hint: email } : {}) });
  sessionStorage.setItem("factor-login-source", source);
  await signInWithRedirect(auth, provider);
}

function renderPriorityTeachers() {
  if (!state.adminAccess) return;
  const grants = new Map(state.teacherGrants.map((item) => [item.id, item]));
  const teachers = [...new Set([SUPER_ADMIN_EMAIL, ...grants.keys()])]
    .sort((a, b) => a === SUPER_ADMIN_EMAIL ? -1 : b === SUPER_ADMIN_EMAIL ? 1 : a.localeCompare(b))
    .map((id) => ({ id }));
  els.priorityTeacherList.replaceChildren();
  teachers.forEach((teacher) => {
    const access = resolveTeacherAccess({ email: teacher.id, emailVerified: true,
      providerData: [{ providerId: "google.com" }] }, grants.get(teacher.id));
    const row = document.createElement("div");
    row.className = "priority-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = teacher.displayName || teacher.id;
    const email = document.createElement("small");
    email.textContent = teacher.id;
    const passcodeStatus = document.createElement("small");
    passcodeStatus.textContent = /^[0-9]{4}$/.test(grants.get(teacher.id)?.passcode || "") ? "通行碼已設定" : "尚未設定通行碼";
    info.append(name, email, passcodeStatus);
    const role = document.createElement("strong");
    role.className = "role-badge";
    role.dataset.role = access.role || "";
    role.textContent = access.registered ? access.label : "已移除開課資格";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = access.role === "admin" ? "設定通行碼" : "編輯／重設通行碼";

    button.dataset.editTeacher = teacher.id;
    button.dataset.role = access.role;
    const actions = document.createElement("div");
    actions.className = "room-actions";
    actions.append(button);
    if (access.role !== "admin" && grants.has(teacher.id)) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "移除";
      remove.dataset.removeTeacher = teacher.id;
      actions.append(remove);
    }
    row.append(info, role, actions);
    els.priorityTeacherList.append(row);
  });
  if (!teachers.length) els.priorityTeacherList.textContent = "目前尚無老師名單。";
}

async function saveTeacherRole(email, role) {
  await saveTeacher({ email: normalizeEmail(email), role, passcode: els.priorityTeacherPasscode.value });
  els.priorityTeacherEmail.value = "";
  els.priorityTeacherPasscode.value = "";
}

function stopAccessSubscriptions() {
  state.unsubTeacherGrants?.();
  state.unsubTeacherGrants = null;
  state.teacherGrants = [];
  els.priorityTeacherList.replaceChildren();
  els.adminClassroomList.replaceChildren();
  els.superAdminTools.classList.add("hidden");
}

function handleAdminAuth(user) {
  const revision = ++state.authRevision;
  if (state.teacherToken && state.teacherToken !== user?.uid) resetTeacherVerification();
  stopAccessSubscriptions();
  state.authUser = user;
  const access = resolveTeacherAccess(user);
  state.adminAccess = access.role === "admin";
  showAdminAccess(user, access);
  els.adminLoginBtn.classList.toggle("hidden", state.adminAccess);
  els.teacherLogoutBtn.classList.toggle("hidden", !state.adminAccess);
  if (!state.adminAccess) return;
  loadAdminClassrooms();
  state.unsubTeacherGrants = onSnapshot(collection(db, "admins"), (snapshot) => {
    if (revision !== state.authRevision) return;
    state.teacherGrants = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    renderPriorityTeachers();
  }, showAdminError);
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
    els.teacherAccessNote.textContent = error.message;
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
    els.teacherAccessNote.textContent = error.message;
  }
});

els.endClassBtn.addEventListener("click", async () => {
  if (!state.teacherCode || !confirm(`確定結束 ${state.teacherCode} 並釋放代碼？答題資料會保留。`)) return;
  try {
    await endClassroom(state.teacherCode);
    stopTeacherSubscription();
    els.teacherRoom.classList.add("hidden");
    renderTeacherDashboard([]);
    state.teacherCode = "";
    state.teacherSessionId = "";
  } catch (error) { els.teacherAccessNote.textContent = error.message; }
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
    els.studentJoinError.textContent = error.message;
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

els.teacherGmail.addEventListener("input", resetTeacherVerification);
els.teacherPasscode.addEventListener("input", resetTeacherVerification);

els.teacherIdentityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (els.teacherLoginBtn.dataset.busy) return;
  setButtonBusy(els.teacherLoginBtn, true, "驗證中…");
  resetTeacherVerification();
  const revision = state.identityRevision;
  try {
    await refreshTeacherAccess();
  } catch (error) {
    if (revision !== state.identityRevision) return;
    state.teacherRole = "guest";
    state.teacherVerificationError = `guest｜驗證未通過，無法取得優先等級。${error.message}`;
    updateTeacherAccessUi();
  } finally {
    setButtonBusy(els.teacherLoginBtn, false, "驗證優先權");
  }
});

els.teacherLogoutBtn.addEventListener("click", async () => {
  await signOut(auth).catch(showAdminError);
});

els.adminLoginBtn.addEventListener("click", async () => {
  els.adminLoginBtn.disabled = true;
  els.adminStatus.textContent = "正在前往 Google 登入...";
  await startGoogleLogin("admin").catch(showAdminError).finally(() => { els.adminLoginBtn.disabled = false; });
});

els.priorityTeacherForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveTeacherRole(els.priorityTeacherEmail.value, els.priorityTeacherLevel.value);
    els.adminStatus.textContent = "已儲存老師權限與通行碼設定。";
  } catch (error) {
    els.adminStatus.textContent = error.message;
  }
});

els.priorityTeacherList.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-teacher]");
  if (edit && !edit.disabled) {
    els.priorityTeacherEmail.value = edit.dataset.editTeacher;
    els.priorityTeacherLevel.value = edit.dataset.role === "auth" ? "auth" : "guest";
    els.priorityTeacherPasscode.value = "";
    els.priorityTeacherPasscode.focus();
    return;
  }
  const button = event.target.closest("[data-remove-teacher]");
  if (!button || !state.adminAccess) return;
  if (!confirm(`確定移除 ${button.dataset.removeTeacher} 的開課資格？`)) return;
  try {
    await saveTeacher({ email: button.dataset.removeTeacher, remove: true });
    els.adminStatus.textContent = "已移除老師開課資格。";
  } catch (error) {
    els.adminStatus.textContent = error.message;
  }
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
refreshGlobalOnlineCount().catch(() => { els.teacherGlobalOnline.textContent = "暫時無法取得"; });

setInterval(async () => {
  if (document.hidden || document.body.dataset.view === "student") return;
  try {
    await refreshGlobalOnlineCount();
    if (document.body.dataset.view === "admin" && state.adminAccess) await loadAdminClassrooms();
  } catch { /* Retry on the next visible-page check. */ }
}, 30_000);

renderNumberBoard();
renderAnswers();
