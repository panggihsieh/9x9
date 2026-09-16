import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  GoogleAuthProvider,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  signInWithRedirect
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  collectionGroup,
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const ONLINE_WINDOW_MS = 45_000;
const PRESENCE_INTERVAL_MS = 15_000;
const SUPER_ADMIN_EMAIL = (classroomSettings.superAdminEmail || "teacher.hsieh@gmail.com").toLowerCase();

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: {
    teacher: document.querySelector("#teacherView"),
    student: document.querySelector("#studentView"),
    admin: document.querySelector("#adminView")
  },
  teacherForm: document.querySelector("#teacherForm"),
  teacherCode: document.querySelector("#teacherCode"),
  teacherLoginBtn: document.querySelector("#teacherLoginBtn"),
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
  teacherRole: "guest",
  teacherHasPriority: false,
  globalOnlineCount: 0,
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
  await ensureTeacherCanOpenClassroom();
  const ref = classroomRef(code);
  const sessionId = crypto.randomUUID();
  state.teacherSessionId = sessionId;
  await clearClassroomStudents(code);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    await setDoc(ref, {
      code,
      sessionId,
      teacherEmail: state.teacherEmail || "guest",
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
      teacherEmail: state.teacherEmail || "guest",
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

async function getTeacherAccess(email) {
  const normalizedEmail = normalizeEmail(email || "");
  if (!normalizedEmail) {
    return {
      email: "",
      role: "guest",
      hasPriority: false,
      priorityLevel: "lowest",
      label: "訪客最低優先"
    };
  }
  const isSuperAdmin = normalizedEmail === SUPER_ADMIN_EMAIL;
  const adminDoc = await getDoc(adminRef(normalizedEmail));
  const adminData = adminDoc.exists() ? adminDoc.data() : {};
  const configuredPriority = classroomSettings.adminEmails.includes(normalizedEmail);
  const hasPriority = isSuperAdmin || configuredPriority || adminDoc.exists();
  const priorityLevel = isSuperAdmin ? "super" : adminData.priorityLevel || (hasPriority ? "normal" : "low");
  return {
    email: normalizedEmail,
    role: isSuperAdmin ? "superAdmin" : hasPriority ? "priorityTeacher" : "teacher",
    hasPriority,
    priorityLevel,
    label: isSuperAdmin ? "最高管理者" : hasPriority ? `優先老師 (${priorityLevel === "high" ? "高" : "一般"})` : "一般老師"
  };
}

function updateTeacherAccessUi() {
  const onlineLimit = classroomSettings.maxGlobalOnline || classroomSettings.maxStudents;
  els.teacherAuthStatus.textContent = state.teacherEmail
    ? `${state.teacherEmail}｜${state.teacherHasPriority ? "優先" : "一般"}`
    : "訪客最低優先";
  els.teacherGlobalOnline.textContent = `${state.globalOnlineCount} / ${onlineLimit}`;
}

async function refreshTeacherAccess(user = auth.currentUser) {
  state.authUser = user;
  const access = await getTeacherAccess(user?.email || "");
  state.teacherEmail = access.email;
  state.teacherRole = access.role;
  state.teacherHasPriority = access.hasPriority;
  updateTeacherAccessUi();
  return access;
}

async function refreshGlobalOnlineCount() {
  const snapshot = await getDocs(collectionGroup(db, "students"));
  state.globalOnlineCount = snapshot.docs
    .map((item) => item.data())
    .filter((student) => isStudentOnline(student)).length;
  updateTeacherAccessUi();
  return state.globalOnlineCount;
}

async function ensureTeacherCanOpenClassroom() {
  await refreshTeacherAccess();
  const onlineCount = await refreshGlobalOnlineCount();
  const onlineLimit = classroomSettings.maxGlobalOnline || classroomSettings.maxStudents;
  if (!state.teacherHasPriority && onlineCount >= onlineLimit) {
    throw new Error(`目前全站同時上線 ${onlineCount} 人，已達 ${onlineLimit} 人上限。未登入或非優先老師暫時不能開新班級。`);
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

async function showAdminAccess(user) {
  const email = normalizeEmail(user.email || "");
  const isSuperAdmin = email === SUPER_ADMIN_EMAIL;
  const adminDoc = await getDoc(adminRef(email));
  const hasPriority = isSuperAdmin || classroomSettings.adminEmails.includes(email) || adminDoc.exists();
  els.adminPanel.classList.remove("hidden");
  els.adminEmail.textContent = email;
  els.adminRole.textContent = isSuperAdmin ? "最高管理者" : hasPriority ? "優先老師" : "一般老師";
  els.adminPriority.textContent = hasPriority ? "有優先權" : "無優先權";
  els.adminStatus.textContent = isSuperAdmin
    ? "你可以管理老師優先使用名單。"
    : "你只能查看自己的登入資料與優先權狀態。";
  els.superAdminTools.classList.toggle("hidden", !isSuperAdmin);
  if (isSuperAdmin) await renderPriorityTeachers();
}

function showAdminError(error) {
  els.adminPanel.classList.remove("hidden");
  els.adminStatus.textContent = getGoogleLoginErrorMessage(error);
}

function getGoogleLoginErrorMessage(error) {
  if (error?.code === "auth/configuration-not-found") {
    return "Google 登入尚未在 Firebase Authentication 啟用，請到 Firebase Console 啟用 Google 登入提供者。";
  }
  return `Google 登入失敗：${error?.code || "unknown"} ${error?.message || ""}`;
}

async function startGoogleLogin(source) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  sessionStorage.setItem("factor-login-source", source);
  await signInWithRedirect(auth, provider);
}

async function renderPriorityTeachers() {
  const snapshot = await getDocs(collection(db, "admins"));
  const teachers = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  els.priorityTeacherList.innerHTML = teachers.length
    ? teachers.map((teacher) => `
      <div class="priority-row">
        <div>
          <strong>${escapeHtml(teacher.email || teacher.id)}</strong>
          <small>${teacher.priorityLevel || "normal"}｜${teacher.role || "priorityTeacher"}</small>
        </div>
        <button type="button" class="danger" data-remove-priority="${escapeHtml(teacher.id)}">移除</button>
      </div>
    `).join("")
    : "<p>目前沒有額外優先老師。</p>";
}

async function addPriorityTeacher(email, priorityLevel = "normal") {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  await setDoc(adminRef(normalizedEmail), {
    email: normalizedEmail,
    role: "priorityTeacher",
    priority: true,
    priorityLevel,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  els.priorityTeacherEmail.value = "";
  await renderPriorityTeachers();
}

async function removePriorityTeacher(email) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === SUPER_ADMIN_EMAIL) {
    alert("最高管理者不能從優先名單移除。");
    return;
  }
  await deleteDoc(adminRef(normalizedEmail));
  await renderPriorityTeachers();
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

els.teacherForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = normalizeCode(els.teacherCode.value);
  if (!code) return;
  try {
    await ensureTeacherCanOpenClassroom();
  const previousCode = state.teacherCode;
  stopTeacherSubscription();
  if (previousCode && previousCode !== code) {
    await endClassroom(previousCode);
  }
  await openClassroom(code);
  state.teacherCode = code;
  els.teacherRoomCode.textContent = code;
  els.teacherRoom.classList.remove("hidden");
  els.classStatus.textContent = "等待中";
  renderTeacherDashboard([]);
  subscribeTeacher(code);
  } catch (error) {
    alert(error.message);
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

els.teacherLoginBtn.addEventListener("click", async () => {
  await startGoogleLogin("teacher").catch((error) => alert(getGoogleLoginErrorMessage(error)));
});

els.adminLoginBtn.addEventListener("click", async () => {
  els.adminPanel.classList.remove("hidden");
  els.adminStatus.textContent = "正在前往 Google 登入...";
  await startGoogleLogin("admin").catch(showAdminError);
});

els.priorityTeacherForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await addPriorityTeacher(els.priorityTeacherEmail.value, els.priorityTeacherLevel.value);
    els.adminStatus.textContent = "已更新優先老師名單。";
  } catch (error) {
    showAdminError(error);
  }
});

els.priorityTeacherList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-priority]");
  if (!button) return;
  if (!confirm(`確定移除 ${button.dataset.removePriority} 的優先權？`)) return;
  try {
    await removePriorityTeacher(button.dataset.removePriority);
    els.adminStatus.textContent = "已更新優先老師名單。";
  } catch (error) {
    showAdminError(error);
  }
});

getRedirectResult(auth)
  .then(async (result) => {
    if (!result?.user) return;
    await refreshTeacherAccess(result.user);
    if (sessionStorage.getItem("factor-login-source") === "admin") {
      await showAdminAccess(result.user);
    }
    sessionStorage.removeItem("factor-login-source");
  })
  .catch(showAdminError);

onAuthStateChanged(auth, async (user) => {
  await refreshTeacherAccess(user);
  await refreshGlobalOnlineCount().catch(() => {});
});

renderNumberBoard();
renderAnswers();
