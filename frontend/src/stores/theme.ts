import { create } from "zustand";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  localStorage.setItem("infatoz_theme", theme);
  const color = theme === "dark" ? "#0A0C10" : "#1B365D";
  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => {
    el.setAttribute("content", color);
  });
}

function readTheme(): Theme {
  const stored = localStorage.getItem("infatoz_theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type ThemeState = {
  theme: Theme;
  hydrate: () => void;
  toggle: () => void;
};

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "light",
  hydrate: () => {
    const theme = readTheme();
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    set({ theme });
  }
}));
