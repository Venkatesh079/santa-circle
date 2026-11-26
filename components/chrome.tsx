"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gift, Moon, Sun, Menu, X, ArrowUpRight, TreePine } from "lucide-react";
import { Button } from "./ui/button";
import { SignOutControl } from "./wishlist-session";
export function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="brand-mark">
        <Gift size={23} strokeWidth={1.8} />
      </span>
      Santa Circle
    </Link>
  );
}
export function Header({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const [opened, setOpened] = useState(false),
    [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  useEffect(() => {
    setOpened(false);
  }, [path]);
  function toggle() {
    const value = !dark;
    setDark(value);
    document.documentElement.dataset.theme = value ? "dark" : "light";
    try {
      localStorage.setItem("santa-theme", value ? "dark" : "light");
    } catch {}
  }
  return (
    <header className="site-header">
      <div className="shell nav-wrap">
        <Brand />
        <nav
          aria-label="Main navigation"
          className={opened ? "nav open" : "nav"}
        >
          <Link
            href="/"
            aria-current={path === "/" ? "page" : undefined}
            onClick={() => setOpened(false)}
          >
            Home
          </Link>
          <Link href="/#how-it-works" onClick={() => setOpened(false)}>
            How it works
          </Link>
          {signedIn && <Link href="/dashboard" aria-current={path.startsWith("/dashboard") ? "page" : undefined} onClick={() => setOpened(false)}>Dashboard</Link>}
        </nav>
        <div className="header-actions">
          <button
            className="theme"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggle}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          {signedIn ? <SignOutControl /> : <Button asChild size="sm" className="nav-join">
            <Link href="/signin">
              Sign in <ArrowUpRight size={15} />
            </Link>
          </Button>}
          <button
            className="theme mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={opened}
            onClick={() => setOpened(!opened)}
          >
            {opened ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <Brand />
        <TreePine size={18} aria-hidden="true" />
        <Link href="/#how-it-works">How it works</Link>
      </div>
    </footer>
  );
}
