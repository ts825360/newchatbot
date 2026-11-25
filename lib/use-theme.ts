"use client";

import { useEffect, useState } from "react";

export type DisplaySettings = { theme: "light" | "dark" | "system"; size: "small" | "standard" | "large" | "largest"; density: "spacious" | "standard" | "compact" };
export const defaultDisplay: DisplaySettings = { theme: "system", size: "standard", density: "standard" };
const key = "church-planner-display";
const legacy = "church-planner-theme";
const changed = "church-display-changed";
const query = "(prefers-color-scheme: dark)";

export function readDisplaySettings(): DisplaySettings {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    const previousTheme = localStorage.getItem(legacy);
    const theme = value?.theme ?? previousTheme;
    return {
      theme: theme === "light" || theme === "dark" ? theme : "system",
      size: value?.size === "small" || value?.size === "large" || value?.size === "largest" ? value.size : "standard",
      density: value?.density === "spacious" || value?.density === "compact" ? value.density : "standard",
    };
  } catch { return defaultDisplay; }
}

function isDark(settings: DisplaySettings) {
  return settings.theme === "dark" || settings.theme === "system" && (window.matchMedia?.(query).matches ?? false);
}

export function saveDisplaySettings(settings: DisplaySettings) {
  localStorage.setItem(key, JSON.stringify(settings));
  window.dispatchEvent(new Event(changed));
}

export function usePrototypeTheme() {
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    const sync = () => {
      const settings = readDisplaySettings();
      const dark = isDark(settings);
      setDarkMode(dark);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.uiSize = settings.size;
      document.documentElement.dataset.uiDensity = settings.density;
    };
    const syncStorage = (event: StorageEvent) => { if (!event.key || event.key === key || event.key === legacy) sync(); };
    sync();
    window.addEventListener(changed, sync);
    window.addEventListener("storage", syncStorage);
    media?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener(changed, sync);
      window.removeEventListener("storage", syncStorage);
      media?.removeEventListener?.("change", sync);
    };
  }, []);
  return { darkMode, toggleTheme: () => {
    try { saveDisplaySettings({ ...readDisplaySettings(), theme: darkMode ? "light" : "dark" }); }
    catch { document.documentElement.classList.toggle("dark", !darkMode); setDarkMode(!darkMode); }
  } };
}
