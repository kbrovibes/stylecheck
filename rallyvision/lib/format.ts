export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

export function fmtAgo(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms) / 1000;
  if (d < 45) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtEta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "";
  if (sec < 60) return `~${Math.max(5, Math.round(sec / 5) * 5)}s left`;
  return `~${Math.round(sec / 60)} min left`;
}
