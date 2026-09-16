import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  GoogleAuthProvider,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithRedirect
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { classroomSettings, firebaseConfig } from "./firebase-config.js";
import { SUPER_ADMIN_EMAIL, resolveEmailAccess, resolveTeacherAccess } from "./teacher-access.js?v=20260916-role-labels";

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
  priorityTeacherList: document.querySelector("#priorityTeacherList")
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
  authUser: null,
  teacherEmail: "",
  teacherRole: null,
  adminAccess: false,
  teacherHasPriority: false,
  teacherRegistered: false,
  globalOnlineCount: null,
  accessReady: false,
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
  presenceTimer: null
};

localStorage.setItem("factor-v3-student-id", state.studentId);

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

function studentRef(code, studentId = state.studentId) {
  return doc(db, "classrooms", code, "students", studentId);
}

function adminRef(email) {
  return doc(db, "admins", normalizeEmail(email));
}

function switchView(view) {
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
  const ref = classroomRef(code);
  const snapshot = await getDoc(ref);
  if (snapshot.exists() && snapshot.data().teacherUid !== state.studentId
      && !state.adminAccess) {
    throw new Error("這個班級代碼已由其他老師使用，請換一個代碼。");
  }
  const sessionId = crypto.randomUUID();
  state.teacherSessionId = sessionId;
  await clearClassroomStudents(code);
  if (!snapshot.exists()) {
    await setDoc(ref, {
      code,
      sessionId,
      teacherUid: state.studentId,
      teacherEmail: state.teacherEmail,
      teacherRole: state.teacherRole,
      teacherHasPriority: state.teacherHasPriority,
      status: "waiting",
      maxStudents: classroomSettings.maxStudents,
      studentCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } else {
    await updateDoc(ref, {
      sessionId,
      teacherUid: state.studentId,
      teacherEmail: state.teacherEmail,
      teacherRole: state.teacherRole,
      teacherHasPriority: state.teacherHasPriority,
      status: "waiting",
      maxStudents: classroomSettings.maxStudents,
      studentCount: 0,
      startedAt: null,
      updatedAt: serverTimestamp()
    });
  }
}

function subscribeTeacher(code) {
  state.unsubTeacherRoom?.();
  state.unsubTeacherStudents?.();
  clearInterval(state.teacherRefreshTimer);

  state.unsubTeacherRoom = onSnapshot(classroomRef(code), (snapshot) => {
    const room = snapshot.data();
    state.teacherSessionId = room?.sessionId || state.teacherSessionId;
    state.teacherMaxStudents = room?.maxStudents || classroomSettings.maxStudents;
    els.classStatus.textContent = room?.status === "active" ? "練習中" : "等待中";
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
    ? state.teacherEmail === SUPER_ADMIN_EMAIL ? "admin" : state.teacherRole : "";
  els.teacherAuthStatus.dataset.role = displayRole;
  els.teacherAuthStatus.textContent = { admin: "admin｜最高", auth: "auth｜優先", guest: "guest｜一般" }[displayRole] || "尚未查詢";
  els.teacherLoginBtn.textContent = "驗證優先權";
  els.openClassBtn.disabled = !state.accessReady || !state.teacherRegistered;
  els.teacherAccessNote.textContent = !state.accessReady
    ? "輸入老師 Gmail 查詢優先權，無需登入；名單由 admin 在後台設定。"
    : !state.teacherRegistered ? "未列入老師名單，請聯絡 admin 新增。"
    : displayRole === "admin" ? "admin 帳號｜可優先開課；管理名單請至後台登入。"
    : state.teacherHasPriority ? "auth｜admin 已設定為優先使用，可開啟教室。" : "guest｜一般優先權，可開啟教室。";
}

async function refreshTeacherAccess() {
  const email = normalizeEmail(els.teacherGmail.value);
  const snapshot = await getDoc(adminRef(email));
  if (email !== normalizeEmail(els.teacherGmail.value)) return;
  const access = resolveEmailAccess(email, snapshot.data());
  state.teacherEmail = access.email;
  state.teacherRole = access.role;
  state.teacherHasPriority = access.hasPriority;
  state.teacherRegistered = access.registered;
  state.accessReady = Boolean(access.role);
  updateTeacherAccessUi();
  return access;
}

async function refreshGlobalOnlineCount() {
  const rooms = await getDocs(collection(db, "classrooms"));
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
  if (!state.accessReady || state.teacherEmail !== normalizeEmail(els.teacherGmail.value)) {
    throw new Error("請先輸入 Gmail 並查詢優先權。");
  }
  await refreshTeacherAccess();
  if (!state.teacherRegistered) throw new Error("未列入老師名單，請聯絡 admin 新增。");
  const onlineCount = await refreshGlobalOnlineCount();
  const onlineLimit = classroomSettings.maxGlobalOnline || classroomSettings.maxStudents;
  if (!state.teacherHasPriority && onlineCount >= onlineLimit) {
    throw new Error(`目前全站同時上線 ${onlineCount} 人，已達 ${onlineLimit} 人上限。guest 老師暫時不能開新班級。`);
  }
}

async function ensureStudentCanJoinClassroom(code) {
  const roomSnapshot = await getDoc(classroomRef(code));
  if (!roomSnapshot.exists()) throw new Error("找不到班級代碼");
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
    const memberRef = studentRef(code);
    const roomSnap = await transaction.get(roomRef);
    if (!roomSnap.exists()) throw new Error("找不到班級代碼");

    const room = roomSnap.data();
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

    if (!alreadyInSession) {
      transaction.update(roomRef, {
        studentCount: increment(1),
        updatedAt: serverTimestamp()
      });
    }
  });

  state.studentSessionId = joinedSessionId;
  startPresence();
  subscribeStudent(code);
}

function subscribeStudent(code) {
  state.unsubStudentRoom?.();
  state.unsubStudentDoc?.();

  state.unsubStudentRoom = onSnapshot(classroomRef(code), (snapshot) => {
    const room = snapshot.data();
    if (!room) {
      showStudentEnded();
      return;
    }
    if (state.studentSessionId && room.sessionId && room.sessionId !== state.studentSessionId) {
      showStudentEnded();
      return;
    }
    state.studentSessionId = room.sessionId || state.studentSessionId;
    if (room.status === "active") {
      els.studentLobby.classList.add("hidden");
      els.practiceView.classList.remove("hidden");
    } else {
      els.studentLobby.classList.remove("hidden");
      els.practiceView.classList.add("hidden");
    }
  });

  state.unsubStudentDoc = onSnapshot(studentRef(code), (snapshot) => {
    const data = snapshot.data();
    if (!data) return;
    state.score = data.score || 0;
    state.currentNumber = data.currentNumber || state.currentNumber;
    els.studentScore.textContent = state.score;
    updateTargetFocus();
  });
}

function startPresence() {
  stopPresence();
  const updatePresence = () => {
    if (!state.studentCode || !state.studentSessionId) return;
    updateDoc(studentRef(state.studentCode), {
      sessionId: state.studentSessionId,
      onlineAt: Date.now(),
      lastSeen: serverTimestamp()
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
  els.lobbyText.textContent = "老師已清空教室資料。";
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

async function checkStudentTask(task) {
  const n = state.currentNumber;
  let correct = false;
  if (task === "factors") correct = sameNumberList(state.answers.factors, factorsOf(n));
  if (task === "pairs") correct = state.answers.pairDraft.length === 0 && samePairs(state.answers.pairs, factorPairs(n));
  if (task === "primes") correct = JSON.stringify(state.answers.primes) === JSON.stringify(primeFactorsOf(n));

  const note = task === "factors" ? els.factorNote : task === "pairs" ? els.pairNote : els.primeNote;
  if (!correct) {
    note.textContent = "還不正確，再試一次";
    note.style.color = "var(--danger)";
    return;
  }

  note.textContent = "完成";
  note.style.color = "var(--green)";
  await updateDoc(studentRef(state.studentCode), {
    sessionId: state.studentSessionId,
    [`tasks.${task}`]: true,
    score: increment(task === "pairs" ? 18 : 14),
    onlineAt: Date.now(),
    lastSeen: serverTimestamp()
  });
  els.practiceFeedback.textContent = "已同步給老師 dashboard。";
}

function clearStudentTask(task) {
  if (task === "pairs") {
    state.answers.pairs = [];
    state.answers.pairDraft = [];
  } else {
    state.answers[task] = [];
  }
  renderAnswers();
}

async function nextNumber() {
  state.currentNumber = chooseNumber();
  state.answers = { factors: [], pairs: [], pairDraft: [], primes: [] };
  [els.factorNote, els.pairNote, els.primeNote].forEach((note) => {
    note.textContent = "尚未完成";
    note.style.color = "";
  });
  renderAnswers();
  updateTargetFocus();
  await updateDoc(studentRef(state.studentCode), {
    sessionId: state.studentSessionId,
    currentNumber: state.currentNumber,
    tasks: { factors: false, pairs: false, primes: false },
    onlineAt: Date.now(),
    lastSeen: serverTimestamp()
  });
}

async function clearClassroomStudents(code) {
  const students = await getDocs(studentsRef(code));
  await Promise.all(students.docs.map((item) => deleteDoc(item.ref)));
}

async function endClassroom(code) {
  await clearClassroomStudents(code);
  await deleteDoc(classroomRef(code));
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
    info.append(name, email);
    const role = document.createElement("strong");
    role.className = "role-badge";
    role.dataset.role = access.role || "";
    role.textContent = access.registered ? access.label : "已移除開課資格";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = access.role === "admin" ? "固定 admin" : "調整權限";
    button.disabled = access.role === "admin";
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
  if (!state.adminAccess || normalizeEmail(auth.currentUser?.email || "") !== SUPER_ADMIN_EMAIL) {
    throw new Error("只有 admin 可以調整老師權限。");
  }
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === SUPER_ADMIN_EMAIL) throw new Error("最高管理者固定為 admin，無法更改。");
  if (!["auth", "guest"].includes(role)) throw new Error("請選擇 auth 或 guest。");
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(normalizedEmail)) throw new Error("請輸入有效的老師 Email。");
  await setDoc(adminRef(normalizedEmail), {
    email: normalizedEmail,
    role,
    updatedBy: auth.currentUser.uid,
    updatedAt: serverTimestamp()
  });
  els.priorityTeacherEmail.value = "";
}

function stopAccessSubscriptions() {
  state.unsubTeacherGrants?.();
  state.unsubTeacherGrants = null;
  state.teacherGrants = [];
  els.priorityTeacherList.replaceChildren();
  els.superAdminTools.classList.add("hidden");
}

function handleAdminAuth(user) {
  const revision = ++state.authRevision;
  stopAccessSubscriptions();
  state.authUser = user;
  const access = resolveTeacherAccess(user);
  state.adminAccess = access.role === "admin";
  showAdminAccess(user, access);
  els.adminLoginBtn.classList.toggle("hidden", state.adminAccess);
  els.teacherLogoutBtn.classList.toggle("hidden", !user);
  if (!state.adminAccess) return;
  state.unsubTeacherGrants = onSnapshot(collection(db, "admins"), (snapshot) => {
    if (revision !== state.authRevision) return;
    state.teacherGrants = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    renderPriorityTeachers();
  }, showAdminError);
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

els.teacherForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = normalizeCode(els.teacherCode.value);
  if (!code) return;
  try {
    els.openClassBtn.disabled = true;
    await ensureTeacherCanOpenClassroom();
    const previousCode = state.teacherCode;
    await openClassroom(code);
    if (previousCode && previousCode !== code) await endClassroom(previousCode);
    stopTeacherSubscription();
    state.teacherCode = code;
    els.teacherRoomCode.textContent = code;
    els.teacherRoom.classList.remove("hidden");
    els.classStatus.textContent = "等待中";
    renderTeacherDashboard([]);
    subscribeTeacher(code);
  } catch (error) {
    els.teacherAccessNote.textContent = error.message;
  } finally {
    els.openClassBtn.disabled = !state.accessReady || !state.teacherRegistered;
  }
});

els.startClassBtn.addEventListener("click", async () => {
  if (!state.teacherCode) return;
  await updateDoc(classroomRef(state.teacherCode), {
    status: "active",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
});

els.endClassBtn.addEventListener("click", async () => {
  if (!state.teacherCode) return;
  if (!confirm(`確定結束 ${state.teacherCode} 並清空資料？`)) return;
  stopTeacherSubscription();
  await endClassroom(state.teacherCode);
  els.teacherRoom.classList.add("hidden");
  renderTeacherDashboard([]);
  state.teacherCode = "";
  state.teacherSessionId = "";
});

els.studentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await joinStudent(normalizeCode(els.studentCode.value), els.studentName.value.trim());
    els.studentLobby.classList.remove("hidden");
  } catch (error) {
    alert(error.message);
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

els.teacherGmail.addEventListener("input", () => {
  state.accessReady = false;
  state.teacherRegistered = false;
  updateTeacherAccessUi();
});

els.teacherIdentityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.teacherLoginBtn.disabled = true;
  try {
    state.accessReady = false;
    updateTeacherAccessUi();
    await refreshTeacherAccess();
  } catch (error) {
    els.teacherAccessNote.textContent = `優先權查詢失敗：${error.message}`;
  } finally {
    els.teacherLoginBtn.disabled = false;
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
    els.adminStatus.textContent = "已儲存老師名單與身分。";
  } catch (error) {
    els.adminStatus.textContent = error.message;
  }
});

els.priorityTeacherList.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-teacher]");
  if (edit && !edit.disabled) {
    els.priorityTeacherEmail.value = edit.dataset.editTeacher;
    els.priorityTeacherLevel.value = edit.dataset.role === "auth" ? "auth" : "guest";
    els.priorityTeacherEmail.focus();
    return;
  }
  const button = event.target.closest("[data-remove-teacher]");
  if (!button || !state.adminAccess) return;
  if (!confirm(`確定移除 ${button.dataset.removeTeacher} 的開課資格？`)) return;
  try {
    await deleteDoc(adminRef(button.dataset.removeTeacher));
    els.adminStatus.textContent = "已移除老師開課資格。";
  } catch (error) {
    els.adminStatus.textContent = error.message;
  }
});

const loginSource = sessionStorage.getItem("factor-login-source");
if (loginSource === "admin") switchView("admin");
getRedirectResult(auth).catch((error) => {
  if (loginSource === "admin") showAdminError(error);
  else els.teacherAccessNote.textContent = getGoogleLoginErrorMessage(error);
}).finally(() => sessionStorage.removeItem("factor-login-source"));

onAuthStateChanged(auth, handleAdminAuth);
updateTeacherAccessUi();
refreshGlobalOnlineCount().catch(() => { els.teacherGlobalOnline.textContent = "暫時無法取得"; });

renderNumberBoard();
renderAnswers();
