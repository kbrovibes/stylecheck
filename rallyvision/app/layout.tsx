import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RallyVision — badminton video analysis",
  description: "Upload a casual badminton video and get shuttle tracking, estimated smash speed, a 2D court tracker, player tracking and an automatic score overlay. Runs in your browser.",
  applicationName: "RallyVision",
};

export const viewport: Viewport = { themeColor: "#0b0f17", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
