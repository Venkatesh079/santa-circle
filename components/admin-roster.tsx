"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { addPerson, removePerson } from "@/app/actions";
import { Button } from "./ui/button";

function ConfirmationControls({ label, approve, cancel }: { label: string; approve: () => void; cancel: () => void }) {
  const { pending } = useFormStatus();
  return <div className="actions">
    <Button type="submit" name="confirmed" value="yes" disabled={pending} aria-busy={pending} onClick={approve}>{pending ? "Please wait…" : label}</Button>
    <Button type="button" variant="outline" disabled={pending} onClick={cancel}>Cancel</Button>
  </div>;
}
function RequestButton({ label, destructive }: { label: string; destructive?: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="outline" size="sm" className={destructive ? "delete-person" : undefined} disabled={pending}>{label}</Button>;
}
function ConfirmRosterForm({ action, title, description, label, destructive, children }: {
  action: (fd: FormData) => Promise<void>; title: string; description: string; label: string;
  destructive?: boolean; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const approved = useRef(false);
  return <form action={action} className={destructive ? "remove-person-form" : "form-stack add-person-form"} onSubmit={event => {
    if (approved.current) { approved.current = false; return; }
    event.preventDefault();
    dialog.current?.showModal();
  }}>
    {children}
    <RequestButton label={label} destructive={destructive} />
    <dialog ref={dialog} className="wishlist-dialog" aria-label={title} onCancel={() => { approved.current = false; }}>
      <h2>{title}</h2>
      <p>{description}</p>
      <ConfirmationControls label={`Yes, ${label.toLowerCase()}`} approve={() => { approved.current = true; }} cancel={() => dialog.current?.close()} />
    </dialog>
  </form>;
}
export function AddPersonForm() {
  const [name, setName] = useState("");
  return <ConfirmRosterForm action={addPerson} title={`Add ${name.trim() || "this person"}?`} description="Confirm that you have entered their full name exactly as shown in their Aria Profile. They will be able to create an account and save a wishlist." label="Add person">
    <label>Full name from Aria Profile<input name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder="First name Last name" autoComplete="off" /></label>
  </ConfirmRosterForm>;
}
export function RemovePersonForm({ personId, name, registered }: { personId: number; name: string; registered: boolean }) {
  return <ConfirmRosterForm action={removePerson} title={`Delete ${name}?`} description={registered ? "This permanently deletes their account, password, recovery hint, wishlist, active sessions, and reset links. They will also be removed from the approved list and cannot register again unless added back." : "This removes them from the approved list. They will not be able to create an account unless added back."} label="Delete person" destructive>
    <input type="hidden" name="personId" value={personId} />
    <input type="hidden" name="name" value={name} />
  </ConfirmRosterForm>;
}
