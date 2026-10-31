import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const IconSettings = (p: P) => <Svg {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" /></Svg>;
export const IconPause = (p: P) => <Svg {...p}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></Svg>;
export const IconPrev = (p: P) => <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>;
export const IconNext = (p: P) => <Svg {...p}><path d="M9 18l6-6-6-6" /></Svg>;
export const IconBack = (p: P) => <Svg {...p}><path d="M19 12H5M12 19l-7-7 7-7" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" /></Svg>;
export const IconLink = (p: P) => <Svg {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Svg>;
export const IconSparkle = (p: P) => <Svg {...p}><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" /></Svg>;
export const IconShare = (p: P) => <Svg {...p}><path d="M12 15V3M7 7l5-4 5 4" /><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="M20 6L9 17l-5-5" /></Svg>;
export const IconLock = (p: P) => <Svg {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const IconX = (p: P) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
export const IconWand = (p: P) => <Svg {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M3 21l9-9" /></Svg>;
export const IconRefresh = (p: P) => <Svg {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></Svg>;

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-ink" />
      <path d="M9 22.5c3.5-7 8-11 14.5-13" className="stroke-bg" strokeWidth="2" strokeLinecap="round" fill="none" strokeDasharray="0.5 4" />
      <circle cx="23.5" cy="9.5" r="3" className="fill-bg" />
    </svg>
  );
}
