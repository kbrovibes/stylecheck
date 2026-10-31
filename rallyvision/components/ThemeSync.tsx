"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/settings";

export default function ThemeSync() {
  const { theme } = useSettings();
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "dark" || (theme === "system" && mq.matches) ? "dark" : "light"; };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
