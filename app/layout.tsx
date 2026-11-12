import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import "@fontsource-variable/recursive/full.css";
import "katex/dist/katex.min.css";
import "./globals.css";
import { getViewerSafe } from "@/lib/auth";
import { getSettingsSafe } from "@/lib/settings";
import { logout } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ActionForm";
import { NavLinks, ThemeToggle } from "@/components/Chrome";

// Every page depends on who is looking at it and on the clock, so nothing is prebuilt.
export const dynamic = "force-dynamic";
// Judging continues after a response is sent; allow the longest run Vercel's free plan permits.
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { siteName } = await getSettingsSafe();
  return {
    title: { default: siteName, template: `%s | ${siteName}` },
    description: `Programming contests, problems and standings for ${siteName}.`,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [viewer, settings, jar] = await Promise.all([getViewerSafe(), getSettingsSafe(), cookies()]);
  const saved = jar.get("ahs_theme")?.value;
  const theme = saved === "dark" || saved === "light" ? saved : null;

  const links = [
    { href: "/", label: "Contests", also: ["/contests"] },
    { href: "/archive", label: "Archive" },
    ...(viewer.user ? [{ href: "/submissions", label: "My submissions" }] : []),
  ];

  return (
    <html lang="en" data-theme={theme ?? undefined}>
      <body>
        <header className="nav">
          <div className="nav-inner">
            <Link href="/" className="brand">
              {settings.siteName}
            </Link>
            <NavLinks className="nav-links" items={links} />
            <div className="nav-user">
              {viewer.isAdmin && <Link href="/admin">Admin</Link>}
              {viewer.user ? (
                <>
                  <Link href="/profile" className="who">
                    {viewer.user.username}
                  </Link>
                  <ActionForm action={logout} className="inline" messages="none">
                    <button className="plain">Log out</button>
                  </ActionForm>
                </>
              ) : (
                <>
                  <Link href="/login">Log in</Link>
                  <Link href="/register" className="who">
                    Create account
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="footer-inner">
            <span>{settings.siteName}</span>
            <ThemeToggle initial={theme} />
            <span className="push">
              <Link href="/admin">Organizers</Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
