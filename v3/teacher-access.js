export const SUPER_ADMIN_EMAIL = "teacher.hsieh@gmail.com";

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
    label: { admin: "admin｜最高管理者", auth: "auth｜優先老師", guest: registered ? "guest｜一般老師" : "guest｜未列入名單" }[role],
    priority: { admin: "最高", auth: "優先", guest: "最低" }[role]
  };
}
