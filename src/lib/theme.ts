export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "zeeboard-theme";

export function getTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

/** "system" removes the attribute and lets App.css follow Windows (prefers-color-scheme). */
export function applyTheme(theme: ThemeChoice): void {
  // Sin transiciones durante el cambio (ver .theme-switching en App.css): todo cambia en el mismo fotograma
  const root = document.documentElement;
  root.classList.add("theme-switching");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));

  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }

  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Without storage the theme lasts only this session
  }
}
