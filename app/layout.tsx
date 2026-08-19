import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import NextTopLoader from "nextjs-toploader";
import { createClient } from "@/lib/supabase/server";
import { getActivePerson, listPeople } from "@/lib/person";
import { imgUrl } from "@/lib/storage";
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
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StyleCheck",
  },
};

export const viewport: Viewport = {
  themeColor: "#FAF8F5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let switcher: { people: { id: string; name: string; role: "owner" | "manager" | "viewer"; img: string | null }[]; activeId: string } | null = null;
  if (user) {
    const [{ person }, all] = await Promise.all([
      getActivePerson(supabase, user),
      listPeople(supabase, user),
    ]);
    switcher = {
      people: all.map((p) => ({
        id: p.person.id,
        name: p.person.name,
        role: p.role,
        img: p.person.avatar_path ? imgUrl(p.person.avatar_path) : null,
      })),
      activeId: person.id,
    };
  }

  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable}`}>
      <body className="min-h-screen">
        <NextTopLoader color="#9A7B4F" height={2} showSpinner={false} shadow={false} />
        {user && <Nav email={user.email ?? ""} switcher={switcher} />}
        <main
          className={
            user
              ? "mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6 sm:pt-10 md:pb-24"
              : ""
          }
        >
          {children}
        </main>
        <Analytics />
      </body>
    </html>
  );
}
