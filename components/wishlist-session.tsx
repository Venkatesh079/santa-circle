"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode, type TransitionStartFunction } from "react";
import { unstable_rethrow } from "next/navigation";
import { act, saveWishlist, saveWishlistAndSignOut, signOut } from "@/app/actions";
import { Button } from "./ui/button";

type WishlistState = {
  draft: string;
  saved: string;
  setDraft: (value: string) => void;
  markSaved: (value: string) => void;
  pending: boolean;
  startTransition: TransitionStartFunction;
};
const WishlistContext = createContext<WishlistState | null>(null);
function useWishlist() {
  const value = useContext(WishlistContext);
  if (!value) throw new Error("Wishlist controls require WishlistSession.");
  return value;
}
export function WishlistSession({ initialWishlist, children }: { initialWishlist: string; children: ReactNode }) {
  const [draft, setDraft] = useState(initialWishlist);
  const [saved, setSaved] = useState(initialWishlist);
  const [pending, startTransition] = useTransition();
  function markSaved(value: string) { setSaved(value); setDraft(value); }
  return <WishlistContext.Provider value={{ draft, saved, setDraft, markSaved, pending, startTransition }}>{children}</WishlistContext.Provider>;
}
export function WishlistEditor({ initiallySaved = false }: { initiallySaved?: boolean }) {
  const { draft, saved, setDraft, markSaved, pending, startTransition } = useWishlist();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(initiallySaved);
  const successfulSaves = useRef(0);
  const [successMessage, setSuccessMessage] = useState("Wishlist saved.");
  return <form action={act.bind(null, "wishlist")} className="form-stack" onSubmit={event => {
    event.preventDefault();
    if (pending) return;
    const fd = new FormData(event.currentTarget);
    setError(""); setSuccess(false);
    startTransition(async () => {
      try {
        const result = await saveWishlist(fd);
        if (result.error) setError(result.error);
        else if (result.wishlist !== undefined) {
          markSaved(result.wishlist); setSuccess(true);
          successfulSaves.current += 1;
          setSuccessMessage(successfulSaves.current % 3 === 0 ? "Wishlist saved. Noted. Forwarded to the North Pole. 🎅" : "Wishlist saved.");
        }
      } catch (cause) { unstable_rethrow(cause); setError("Could not save your wishlist. Your changes are still here. Please try again."); }
    });
  }}>
    <label>What would make you smile?<textarea name="wishlist" maxLength={5000} rows={8} value={draft} disabled={pending} onChange={event => {
      setDraft(event.target.value); setSuccess(false); setError("");
    }} placeholder="A water bottle, a desk plant, a book, chocolates, a card game…" /></label>
    {draft !== saved && <p className="hint" role="status">You have unsaved wishlist changes.</p>}
    <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save wishlist"}</Button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {success && <p className="notice" role="status">{successMessage}</p>}
  </form>;
}
export function SignOutControl() {
  const { draft, saved, pending, startTransition } = useWishlist();
  const dirty = draft !== saved;
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  function leave(save: boolean) {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        if (save) {
          const fd = new FormData(); fd.set("wishlist", draft);
          const result = await saveWishlistAndSignOut(fd);
          if (result.error) setError(result.error);
        } else { await signOut(); }
      } catch (cause) { unstable_rethrow(cause); setError(dirty ? "Could not sign out. Your wishlist changes are still here. Please try again." : "Could not sign out. Please try again."); }
    });
  }
  return <>
    <Button type="button" variant="outline" size="sm" className="sign-out-trigger" disabled={pending} onClick={() => {
      setError(""); dialog.current?.showModal();
    }}>Sign out</Button>
    <dialog ref={dialog} className="wishlist-dialog" aria-labelledby="wishlist-dialog-title" aria-describedby="wishlist-dialog-description" onCancel={event => { if (pending) event.preventDefault(); }}>
      <h2 id="wishlist-dialog-title">{dirty ? "Save your wishlist before signing out?" : "Sign out?"}</h2>
      <p id="wishlist-dialog-description">{dirty ? "Your wishlist has unsaved changes. Choose whether to save them or discard them." : "Are you sure you want to sign out?"}</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions">
        {dirty ? <>
          <Button type="button" disabled={pending} onClick={() => leave(true)}>Save and sign out</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => leave(false)}>Discard and sign out</Button>
        </> : <Button type="button" disabled={pending} onClick={() => leave(false)}>Sign out</Button>}
        <Button type="button" variant="ghost" autoFocus disabled={pending} onClick={() => dialog.current?.close()}>Cancel</Button>
      </div>
      {pending && <p role="status">Please wait…</p>}
    </dialog>
  </>;
}
