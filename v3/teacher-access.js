export const SUPER_ADMIN_EMAIL = "teacher.hsieh@gmail.com";

// Email lookup grants classroom priority only, never backend administration.
export function resolveEmailAccess(value, grant = {}) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) {
    return { email: "", role: null, registered: false, hasPriority: false };
  }
  const hasPriority = email === SUPER_ADMIN_EMAIL || grant.role === "auth"
    || (grant.role === "priorityTeacher" && grant.priority !== false);
  return { email, role: hasPriority ? "auth" : "guest", hasPriority,
    registered: email === SUPER_ADMIN_EMAIL || ["auth", "guest", "priorityTeacher"].includes(grant.role) };
}

export function isGoogleTeacher(user) {
  return Boolean(user?.emailVerified && user.email
    && user.providerData?.some((provider) => provider.providerId === "google.com"));
}

export function resolveTeacherAccess(user, grant = {}) {
  if (!isGoogleTeacher(user)) {
    return { email: "", role: null, registered: false, hasPriority: false, label: "未驗證", priority: "--" };
  }
  const email = user.email.trim().toLowerCase();
  // Preserve grants created by the earlier priority-teacher interface.
  const approved = grant.role === "auth"
    || (grant.role === "priorityTeacher" && grant.priority !== false);
  const role = email === SUPER_ADMIN_EMAIL ? "admin" : approved ? "auth" : "guest";
  const registered = role === "admin" || ["auth", "guest", "priorityTeacher"].includes(grant.role);
  return {
    email,
    role,
    registered,
    hasPriority: role !== "guest",
    label: { admin: "admin｜最高管理者", auth: "auth｜已核准", guest: "guest｜未核准" }[role],
    priority: { admin: "最高", auth: "優先", guest: "最低" }[role]
  };
}
