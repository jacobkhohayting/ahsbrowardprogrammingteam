"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Item = { href: string; label: string; exact?: boolean; also?: string[] };

function isActive(pathname: string, item: Item): boolean {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");
  if (pathname === item.href) return true;
  if (!item.exact && item.href !== "/" && under(item.href)) return true;
  return (item.also ?? []).some(under);
}

/** Navigation links that underline the page you are on. */
export function NavLinks({ items, className }: { items: Item[]; className: string }) {
  const pathname = usePathname();
  return (
    <nav className={className}>
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Switches between the light and dark look and remembers the choice in a cookie. */
export function ThemeToggle({ initial }: { initial: "light" | "dark" | null }) {
  const [theme, setTheme] = useState(initial);

  function toggle() {
    const current =
      theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `ahs_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  }

  return (
    <button type="button" className="plain" onClick={toggle}>
      {theme === "dark" ? "Light mode" : theme === "light" ? "Dark mode" : "Switch theme"}
    </button>
  );
}

/** Copies text to the clipboard and briefly says so. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="plain small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be blocked; the text can still be selected by hand.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
