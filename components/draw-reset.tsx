"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { prepareDrawReset, resetDraw } from "@/app/actions";
import { Button } from "./ui/button";

export function DrawReset({ revision, participantCount }: { revision: number; participantCount: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(1);
  const [understood, setUnderstood] = useState(false);
  const [notified, setNotified] = useState(false);
  const [approval, setApproval] = useState<{ token: string; expires: number; participantCount: number } | null>(null);
  const [phrase, setPhrase] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function clear() {
    setStep(1); setUnderstood(false); setNotified(false); setApproval(null); setPhrase(""); setConfirmed(false); setError("");
  }
  function cancel() { if (!pending) { dialog.current?.close(); clear(); } }
  function advance(next: number) { setStep(next); requestAnimationFrame(() => heading.current?.focus()); }
  return <section className="panel draw-reset-panel">
    <h2>Reset an active draw</h2>
    <p>For essential roster changes only. This invalidates everyone’s current recipient. Inform all participants before continuing.</p>
    <Button type="button" variant="outline" className="delete-person" onClick={() => { clear(); dialog.current?.showModal(); }}>Review draw reset</Button>
    <dialog ref={dialog} className="wishlist-dialog draw-reset-dialog" aria-labelledby="draw-reset-heading" onCancel={event => { if (pending) event.preventDefault(); else clear(); }}>
      <p className="hint">Confirmation {step} of 3</p>
      <h2 id="draw-reset-heading" tabIndex={-1} ref={heading}>{step === 1 ? "Invalidate everyone’s match?" : step === 2 ? "Verify administrator approval" : "Final confirmation"}</h2>
      {error && <p className="notice error" role="alert">{error}</p>}
      {step === 1 && <div className="form-stack">
        <p>This clears all {participantCount} assignments and reopens registration, roster changes, and wishlist editing. Accounts and saved wishlists are preserved. The next draw may give everyone a different recipient.</p>
        <p>People may already have viewed their match or bought a gift. This app does not send notifications. Previously viewed names cannot be taken back.</p>
        <label className="reset-acknowledgement"><input type="checkbox" checked={understood} onChange={event => setUnderstood(event.target.checked)} />I understand that all current assignments will become invalid.</label>
        <label className="reset-acknowledgement"><input type="checkbox" checked={notified} onChange={event => setNotified(event.target.checked)} />I have informed all participants to disregard their current match and wait for a new draw.</label>
        <div className="actions"><Button type="button" disabled={!understood || !notified} onClick={() => advance(2)}>Continue to verification</Button><Button type="button" variant="outline" onClick={cancel}>Cancel</Button></div>
      </div>}
      {step === 2 && <form className="form-stack" onSubmit={event => {
        event.preventDefault(); if (pending) return;
        const form = event.currentTarget;
        const fd = new FormData(form); fd.set("understood", understood ? "yes" : "no"); fd.set("notified", notified ? "yes" : "no"); fd.set("revision", String(revision));
        setError("");
        startTransition(async () => {
          try {
            const result = await prepareDrawReset(fd);
            const passwordInput = form.elements.namedItem("password");
            if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
            if (result.error) setError(result.error);
            else if (result.token && result.expires && result.participantCount !== undefined) {
              setApproval({ token: result.token, expires: result.expires, participantCount: result.participantCount }); advance(3);
            }
          } catch (cause) { unstable_rethrow(cause); setError("Could not verify approval. The draw has not been changed. Try again."); }
        });
      }}>
        <label>Reason for resetting<textarea name="reason" required minLength={10} maxLength={500} rows={3} disabled={pending} placeholder="Explain the essential roster changes…" /></label>
        <label>Administrator password<input name="password" type="password" required maxLength={72} autoComplete="current-password" disabled={pending} /></label>
        <p className="hint">The reason is recorded. Verification allows one reset of this draw within five minutes.</p>
        <div className="actions"><Button type="submit" disabled={pending}>{pending ? "Verifying…" : "Verify and continue"}</Button><Button type="button" variant="outline" disabled={pending} onClick={cancel}>Cancel</Button></div>
      </form>}
      {step === 3 && approval && <form className="form-stack" onSubmit={event => {
        event.preventDefault(); if (pending || !confirmed || phrase !== "RESET DRAW") return;
        const fd = new FormData(); fd.set("token", approval.token); fd.set("phrase", phrase); fd.set("confirmed", confirmed ? "yes" : "no");
        setError("");
        startTransition(async () => {
          try { const result = await resetDraw(fd); if (result.error) setError(result.error); }
          catch (cause) { unstable_rethrow(cause); setError("Could not complete the reset. Refresh the dashboard to check the draw status before trying again."); }
        });
      }}>
        <p>Reset all {approval.participantCount} assignments and reopen setup? A private database backup must succeed before the reset proceeds.</p>
        <label>Type RESET DRAW to confirm<input name="phrase" value={phrase} onChange={event => setPhrase(event.target.value)} required autoComplete="off" spellCheck={false} disabled={pending} /></label>
        <label className="reset-acknowledgement"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} />I authorize clearing this draw and understand that participants must draw again after I re-enable it.</label>
        <p className="hint">For safety, approval expires five minutes after password verification. If it expires, cancel and start again.</p>
        <div className="actions"><Button type="submit" disabled={pending || !confirmed || phrase !== "RESET DRAW"} aria-busy={pending}>{pending ? "Backing up and resetting…" : "Clear assignments and reopen setup"}</Button><Button type="button" variant="outline" disabled={pending} onClick={cancel}>Cancel</Button></div>
      </form>}
    </dialog>
  </section>;
}
