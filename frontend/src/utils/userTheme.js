export function userThemeKey(user) {
  if (!user?.id || !user?.role) return "";
  return `retela-theme-${user.role}-${user.id}`;
}

export function readUserTheme(user) {
  const key = userThemeKey(user);
  if (!key) return "light";
  return localStorage.getItem(key) === "dark" ? "dark" : "light";
}

export function saveUserTheme(user, theme) {
  const key = userThemeKey(user);
  if (!key) return;
  localStorage.setItem(key, theme === "dark" ? "dark" : "light");
}

export function applyUserTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("retela-dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function emitUserThemeChange(user, theme) {
  window.dispatchEvent(new CustomEvent("retela:user-theme", {
    detail: {
      userId: user?.id,
      role: user?.role,
      theme: theme === "dark" ? "dark" : "light"
    }
  }));
}
