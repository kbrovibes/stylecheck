import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: "StyleCheck",
  description: "Your wardrobe, styled. Personal fit checks and outfit rendering.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable}`}>
      <body className="min-h-screen">
        {user && <Nav email={user.email ?? ""} />}
        <main className={user ? "mx-auto max-w-6xl px-6 pb-24 pt-10" : ""}>
          {children}
        </main>
        <Analytics />
      </body>
    </html>
  );
}
