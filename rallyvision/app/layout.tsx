import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import ThemeSync from "@/components/ThemeSync";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "RallyVision — badminton video analysis",
  description: "Turn a phone video of your badminton game into a broadcast-style breakdown: shuttle trail, shot speed, court map, players and score. Runs on your device.",
  applicationName: "RallyVision",
  appleWebApp: { capable: true, title: "RallyVision", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

const themeBoot = `try{var s=JSON.parse(localStorage.getItem("rallyvision.settings.v1")||"{}").theme||"light";var d=s==="dark"||(s==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" className={`${inter.variable} ${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="min-h-dvh">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
