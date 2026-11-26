"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Gift, LoaderCircle } from "lucide-react";
import { act, authenticate, resetPassword, generatePasswordResetLink, lookupPasswordResetLink, completePasswordReset } from "@/app/actions";
import { Button } from "./ui/button";
import type { Match } from "@/lib/store";
import recoveryQuestions from "@/lib/recovery-questions.json";
import { RecipientWishlist } from "./recipient-wishlist";

export function Submit({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending} aria-busy={pending}>
    {pending && <LoaderCircle className="spin" size={17} />}{children}
  </Button>;
}
export function ActionForm({ op, children, confirm }: { op: "wishlist" | "enable"; children: ReactNode; confirm?: string }) {
  return <form action={act.bind(null, op)} className="form-stack" onSubmit={e => {
    if (confirm && !window.confirm(confirm)) e.preventDefault();
  }}>{children}</form>;
}
export function AccountForm({ mode, name = "", recoveryQuestion = "" }: { mode: "signup" | "signin"; name?: string; recoveryQuestion?: string }) {
  return <form action={authenticate.bind(null, mode)} className="form-stack" onInput={event => {
    if (mode !== "signup") return;
    const password = event.currentTarget.elements.namedItem("password") as HTMLInputElement;
    const confirmation = event.currentTarget.elements.namedItem("confirmPassword") as HTMLInputElement;
    confirmation.setCustomValidity(confirmation.value === password.value ? "" : "Passwords do not match.");
  }}>
    <label>Name<input name="name" defaultValue={name} autoComplete={mode === "signup" ? "name" : "username"} aria-describedby="name-help" required maxLength={80} placeholder="First name Last name" /></label>
    <p id="name-help" className="hint">{mode === "signup" ? "Use the same full name as shown in your Aria Profile. Capitalization does not matter." : "Participants: use the same full name as shown in your Aria Profile. Capitalization does not matter."}</p>
    <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} maxLength={72} /></label>
    {mode === "signup" && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>}
    {mode === "signup" && <RecoveryFields question={recoveryQuestion} optional />}
    {mode === "signup" && <p className="hint">Each approved person can register only once. Passwords need at least 8 characters.</p>}
    <Submit>{mode === "signup" ? "Create account" : "Sign in"}</Submit>
  </form>;
}
export function ChangePasswordForm({ name = "" }: { name?: string }) {
  return <form action={resetPassword} className="form-stack" onInput={event => {
    const password = event.currentTarget.elements.namedItem("newPassword") as HTMLInputElement;
    const confirmation = event.currentTarget.elements.namedItem("confirmPassword") as HTMLInputElement;
    confirmation.setCustomValidity(confirmation.value === password.value ? "" : "Passwords do not match.");
  }}>
    <label>Name<input name="name" autoComplete="username" defaultValue={name} required maxLength={80} aria-describedby="reset-name-help" /></label>
    <p id="reset-name-help" className="hint">Use the same full name as shown in your Aria Profile. Capitalization does not matter.</p>
    <RecoveryFields resetting />
    <label>New password<input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
    <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
    <p className="hint">Use at least 8 characters. You will be signed out on all devices after changing your password.</p>
    <Submit>Reset password</Submit>
  </form>;
}
export function AdminPasswordReset({ participantId, name }: { participantId: string; name: string }) {
  return <form action={generatePasswordResetLink} aria-label={`Generate reset link for ${name}`}>
    <input type="hidden" name="userId" value={participantId} />
    <Submit>Generate reset link</Submit>
  </form>;
}
export function GeneratedPasswordResetLink({ link, name, expires }: { link: string; name: string; expires: number }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(link); setStatus("Reset link copied."); }
    catch { setStatus("Select and copy the link below."); }
  }
  return <section className="panel" aria-label="Generated password reset link">
    <h2>Reset link for {name}</h2>
    <p>Share this link privately with this participant so they can choose their own password.</p>
    <label>One-time reset link<input readOnly value={link} onFocus={event => event.currentTarget.select()} /></label>
    <div className="actions"><Button type="button" variant="outline" onClick={copy}>Copy reset link</Button><a className="text-link" href={link} target="_blank" rel="noreferrer">Open reset page</a></div>
    <p className="hint">Expires {new Date(expires).toUTCString()}. Opening the link does not use it up. A successful password reset does.</p>
    {status && <p role="status">{status}</p>}
  </section>;
}
export function PasswordResetLinkForm({ error }: { error?: string }) {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<{ name: string; expires: number }>();
  const [lookupError, setLookupError] = useState("");
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let request = 0;
    async function check() {
      const current = ++request;
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      setChecking(true); setInfo(undefined); setLookupError(""); setToken(value);
      if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
        setLookupError("This reset link is invalid or has expired. Ask the administrator for a new link.");
        setChecking(false); return;
      }
      const fd = new FormData(); fd.set("token", value);
      try {
        const result = await lookupPasswordResetLink(fd);
        if (current !== request) return;
        if ("error" in result) setLookupError(result.error); else setInfo(result);
      } catch {
        if (current !== request) return;
        setLookupError("Could not check this reset link. Please refresh and try again.");
      }
      if (current === request) setChecking(false);
    }
    void check();
    window.addEventListener("hashchange", check);
    return () => { request++; window.removeEventListener("hashchange", check); };
  }, []);
  return <>
    <noscript>Enable JavaScript to open this private reset link.</noscript>
    {checking && <p role="status">Checking reset link…</p>}
    {lookupError && <p className="notice error" role="alert">{lookupError}</p>}
    {info && <>
      {error && <p className="notice error" role="alert">{error}</p>}
      <form action={completePasswordReset} className="form-stack" onInput={event => {
        const password = event.currentTarget.elements.namedItem("newPassword") as HTMLInputElement;
        const confirmation = event.currentTarget.elements.namedItem("confirmPassword") as HTMLInputElement;
        confirmation.setCustomValidity(confirmation.value === password.value ? "" : "Passwords do not match.");
      }}>
        <input type="hidden" name="token" value={token} />
        <label>Name<input name="name" value={info.name} readOnly autoComplete="username" /></label>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
        <p className="hint">This link is for {info.name}. All their existing sessions will be signed out after the password is saved.</p>
        <Submit>Save new password</Submit>
      </form>
    </>}
  </>;
}
function RecoveryFields({ resetting = false, question = "", optional = false }: { resetting?: boolean; question?: string; optional?: boolean }) {
  const [selectedQuestion, setSelectedQuestion] = useState(Object.hasOwn(recoveryQuestions, question) ? question : "");
  const [hasAnswer, setHasAnswer] = useState(false);
  return <fieldset className="idea"><legend>Password recovery{optional ? " (optional)" : ""}</legend>
    {optional && <p className="hint">Optional. Add a question and answer now if you want to reset your password later.</p>}
    <label>Recovery question<select name="recoveryQuestion" required={!optional || hasAnswer} value={selectedQuestion} onChange={event => setSelectedQuestion(event.target.value)}><option value="" disabled={!optional}>{resetting ? "Select the question you chose" : "Choose a question"}</option>{Object.entries(recoveryQuestions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>Recovery answer<input name="recoveryAnswer" type="password" autoComplete="off" required={!optional || Boolean(selectedQuestion)} onChange={event => setHasAnswer(Boolean(event.target.value.trim()))} minLength={2} maxLength={72} /></label>
    <p className="hint">{resetting ? "Enter the answer you saved when registering. Capitalization and extra spaces do not matter." : "Remember your question and answer. You will use them to reset your password. Answers are case-insensitive."}</p>
  </fieldset>;
}
export function Draw({ enabled, recipient }: { enabled: boolean; recipient?: Match }) {
  return <div className="reveal">
    <div className="ribbon-icon"><Gift /></div>
    {recipient ? <div className="unwrapped" aria-live="polite">
      <p>You are the Secret Santa for</p><h3>{recipient.name}</h3>
      <RecipientWishlist wishlist={recipient.wishlist || ""} />
    </div> : <>
      <h3>Your secret recipient</h3>
      <p>{enabled ? "Your match is ready. Open it in private." : "Your draw will open when the administrator enables it."}</p>
    </>}
    <form action={act.bind(null, "draw")}><Submit disabled={!enabled}>
      {recipient ? "View my recipient again" : "Draw"}<Gift size={16} />
    </Submit></form>
  </div>;
}
