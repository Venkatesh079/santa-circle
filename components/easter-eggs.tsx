"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, TreePine } from "lucide-react";

export function useSecretReveal(duration = 2500) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }
  function show() {
    if (timer.current) clearTimeout(timer.current);
    setVisible(true);
    if (duration) timer.current = setTimeout(() => setVisible(false), duration);
  }
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (timer.current) clearTimeout(timer.current);
        setVisible(false);
      }
    }
    window.addEventListener("keydown", escape);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  return { visible, show, hide };
}

export function SecretNote({ children }: { children: ReactNode }) {
  return <span className="egg-note" role="status">{children}</span>;
}

export function FooterSecret() {
  const secret = useSecretReveal();
  return <span className="footer-secret">
    <button type="button" className="footer-secret-trigger" aria-label="Discover a little festive secret" aria-expanded={secret.visible} onClick={() => secret.visible ? secret.hide() : secret.show()}>
      <TreePine size={20} aria-hidden="true" />
    </button>
    {secret.visible && <SecretNote>No socks, unless requested. 🧦</SecretNote>}
  </span>;
}

export function DateSecret({ date, label, withIcon = false }: { date: string; label: string; withIcon?: boolean }) {
  const secret = useSecretReveal(0);
  const id = useId();
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) secret.hide();
    }
    if (secret.visible) document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [secret.visible]);
  return <span ref={container} className="date-secret">
    <button type="button" className="date-secret-trigger" aria-expanded={secret.visible} aria-controls={id} title="Santa has a little checklist…" onClick={() => secret.visible ? secret.hide() : secret.show()}>
      {withIcon && <CalendarDays size={21} aria-hidden="true" />}<time dateTime={date}>{label}</time>
    </button>
    {secret.visible && <span className="egg-note date-checklist" id={id} role="group" aria-label="Santa’s checklist">
      <strong>Santa’s checklist</strong>
      {["Gifts wrapped?", "Secret kept?", "Excitement contained?"].map(item => <label key={item}><input type="checkbox" />{item}</label>)}
    </span>}
  </span>;
}

function Santa() {
  return <svg viewBox="0 0 120 142" fill="none" aria-hidden="true">
    <path d="M17 142v-24c0-23 19-38 43-38s43 15 43 38v24" fill="#ac493c" />
    <path d="M49 104h22v38H49z" fill="#f5ead2" />
    <ellipse cx="60" cy="74" rx="38" ry="40" fill="#f8eed7" />
    <ellipse cx="60" cy="64" rx="27" ry="26" fill="#e7b58e" />
    <path d="M29 48C30 19 51 7 73 12c15 3 26 18 29 32-13-8-26-11-37-6-12 5-24 11-36 10Z" fill="#b24a3c" />
    <path d="M29 47c20-6 42-7 61 0" stroke="#fff7e5" strokeWidth="12" strokeLinecap="round" />
    <circle cx="102" cy="42" r="10" fill="#fff7e5" />
    <circle cx="49" cy="64" r="2.5" fill="#483c31" /><circle cx="71" cy="64" r="2.5" fill="#483c31" />
    <ellipse cx="60" cy="74" rx="7" ry="5" fill="#d49179" />
    <path d="M60 79c-10-11-24-5-26 4 10 7 20 4 26-4Zm0 0c10-11 24-5 26 4-10 7-20 4-26-4Z" fill="#fff8e7" />
    <path d="M54 88c4 4 8 4 12 0" stroke="#9d6554" strokeWidth="2" strokeLinecap="round" />
    <ellipse cx="25" cy="127" rx="12" ry="9" fill="#f8eed7" /><ellipse cx="95" cy="127" rx="12" ry="9" fill="#f8eed7" />
  </svg>;
}

export function GiftSurprise({ children }: { children: ReactNode }) {
  const secret = useSecretReveal(4200);
  return <button type="button" className={"postcard-art gift-surprise" + (secret.visible ? " is-open" : "")} aria-label={secret.visible ? "Santa says ho ho ho! Close the gift" : "Holiday gifts. Open a little surprise"} aria-pressed={secret.visible} onClick={() => secret.visible ? secret.hide() : secret.show()}>
    {children}
    <span className="gift-reveal" aria-hidden="true">
      <span className="santa-peek"><Santa /></span>
      <span className="surprise-box"><span className="surprise-ribbon" /></span>
      <span className="surprise-lid"><span className="surprise-ribbon" /></span>
    </span>
    {secret.visible && <span className="gift-greeting" role="status">Ho ho ho! Keep it secret. 🎅</span>}
  </button>;
}
