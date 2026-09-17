export const SUPER_ADMIN_EMAIL = "teacher.hsieh@gmail.com";

export function isGoogleTeacher(user) {
  return Boolean(user?.emailVerified && user.email
    && user.providerData?.some((provider) => provider.providerId === "google.com"));
}

export function resolveTeacherAccess(user) {
  if (!isGoogleTeacher(user)) {
    return { email: "", role: null, registered: false, hasPriority: false, label: "未驗證", priority: "--" };
  }
  const email = user.email.trim().toLowerCase();
  const role = email === SUPER_ADMIN_EMAIL ? "admin" : "guest";
  const registered = role === "admin";
  return {
    email,
    role,
    registered,
    hasPriority: role !== "guest",
    label: registered ? "admin｜最高管理者" : "非管理員",
    priority: registered ? "最高" : "--"
  };
}
