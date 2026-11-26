"use client";
import { useActionState, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  ArrowRight,
  Copy,
  Check,
  Plus,
  Trash2,
  LoaderCircle,
  Gift,
  Mail,
  Sparkles,
} from "lucide-react";
import { act, authenticate } from "@/app/actions";
import { Button } from "./ui/button";
import {
  budgetCurrency,
  displayDate,
  budgetLabel,
  type Circle,
  type Idea,
  type Result,
} from "@/lib/types";

function Status({ result }: { result: Result }) {
  return (
    <>
      {result.error && (
        <p role="alert" className="notice error">
          {result.error}
        </p>
      )}
      {result.success && (
        <p role="status" className="notice">
          {result.success}
        </p>
      )}
    </>
  );
}
export function Submit({
  children,
  outline = false,
  disabled = false,
}: {
  children: ReactNode;
  outline?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={outline ? "outline" : "default"}
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? <LoaderCircle className="spin" size={17} /> : null}
      {children}
    </Button>
  );
}
type Op = Parameters<typeof act>[0];
export function ActionForm({
  op,
  children,
  id,
  className,
  confirm,
}: {
  op: Op;
  id?: string;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const keepInput = useRef(false);
  const [state, action] = useActionState(
    async (previous: Result, data: FormData) => {
      const result = await act(op, previous, data);
      keepInput.current = Boolean(result.error);
      return result;
    },
    {},
  );
  return (
    <form
      action={action}
      onReset={(event) => {
        if (keepInput.current) event.preventDefault();
      }}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {id && <input type="hidden" name="id" value={id} />}
      {children}
      <Status result={state} />
    </form>
  );
}
export function GroupFields({ group }: { group?: Circle }) {
  return (
    <>
      <label>
        Group name
        <input
          name="name"
          required
          maxLength={80}
          placeholder="e.g. The Fireside Friends"
          defaultValue={group?.name}
        />
      </label>
      {!group && (
        <label>
          Your name
          <input
            name="person"
            autoComplete="name"
            required
            maxLength={80}
            placeholder="Your organizer name"
          />
        </label>
      )}
      <label>
        Gift budget (INR ₹)
        <input
          name="budget"
          type="number"
          min="0"
          max="999999999"
          step=".01"
          required
          defaultValue={
            group
              ? group.currency === budgetCurrency
                ? group.budget
                : ""
              : 800
          }
        />
      </label>
      <label>
        Exchange date
        <input type="date" name="date" required defaultValue={group?.date} />
      </label>
      <label>
        Group message <span>(optional)</span>
        <textarea
          name="message"
          maxLength={1000}
          defaultValue={group?.message}
          placeholder="Where and when will you exchange gifts?"
        />
      </label>
    </>
  );
}
export function CopyInvite({ code }: { code: string }) {
  const [status, set] = useState("");
  const [fallback, show] = useState("");
  async function copy() {
    const link = new URL("/join", window.location.origin);
    link.searchParams.set("code", code);
    try {
      await navigator.clipboard.writeText(link.href);
      set("Invitation link copied.");
    } catch {
      show(link.href);
      set("Select the invitation link to copy it.");
    }
  }
  return (
    <div className="share-box">
      <div>
        <small>Group code</small>
        <code>{code}</code>
      </div>
      <Button variant="outline" size="sm" onClick={copy}>
        {status.startsWith("Invitation") ? (
          <Check size={15} />
        ) : (
          <Copy size={15} />
        )}
        Copy invite link
      </Button>
      {status && (
        <p className="share-note" role="status">
          {status}
        </p>
      )}
      {fallback && (
        <input
          aria-label="Invitation link"
          readOnly
          value={fallback}
          onFocus={(e) => e.target.select()}
        />
      )}
    </div>
  );
}
export function Wishlist({ group }: { group: Circle }) {
  const [ideas, setIdeas] = useState<(Idea & { key: number })[]>(
    group.ideas.map((x, key) => ({ ...x, key })),
  );
  const [next, setNext] = useState(ideas.length);
  return (
    <ActionForm op="wishlist" id={group.id} className="form-stack">
      <label>
        Interests
        <textarea
          name="interests"
          maxLength={1000}
          defaultValue={group.interests}
          placeholder="Hobbies, favorite flavors, colors…"
        />
      </label>
      <label>
        Gift preferences
        <textarea
          name="preferences"
          maxLength={1000}
          defaultValue={group.preferences}
          placeholder="Sizes, allergies, or things to avoid"
        />
      </label>
      {ideas.map((it, i) => (
        <fieldset className="idea" key={it.key}>
          <legend>Gift idea {i + 1}</legend>
          <label>
            Item
            <input
              required
              name="title"
              maxLength={120}
              defaultValue={it.title}
            />
          </label>
          <label>
            Product link <span>(optional)</span>
            <input
              type="url"
              name="url"
              maxLength={1500}
              placeholder="https://"
              defaultValue={it.url}
            />
          </label>
          <label>
            Notes <span>(optional)</span>
            <input name="notes" maxLength={500} defaultValue={it.notes} />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIdeas(ideas.filter((x) => x.key !== it.key))}
          >
            <Trash2 size={14} />
            Remove idea
          </Button>
        </fieldset>
      ))}
      {!ideas.length && (
        <p className="muted">
          Your wishlist is empty. Add a gift idea to help your Santa.
        </p>
      )}
      <div className="actions">
        <Button
          type="button"
          variant="outline"
          disabled={ideas.length >= 12}
          onClick={() => {
            setIdeas([...ideas, { title: "", url: "", notes: "", key: next }]);
            setNext(next + 1);
          }}
        >
          <Plus size={16} />
          Add gift idea
        </Button>
        <Submit>Save wishlist</Submit>
      </div>
    </ActionForm>
  );
}
export function Reveal({ group }: { group: Circle }) {
  const [state, action, pending] = useActionState(
    act.bind(null, "reveal"),
    {} as Result,
  );
  const r = state.recipient;
  return (
    <div className="reveal">
      <div className="ribbon-icon">{r ? <Sparkles /> : <Gift />}</div>
      {r ? (
        <div className="unwrapped" aria-live="polite">
          <p>Your gift is for</p>
          <h3>{r.name}</h3>
          <p>
            {budgetLabel(group)} · {displayDate(group.date)}
          </p>
          <h4>Wishlist</h4>
          {r.ideas.length ? (
            <ul>
              {r.ideas.map((it, i) => (
                <li key={i}>
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noopener noreferrer">
                      {it.title} ↗
                    </a>
                  ) : (
                    it.title
                  )}
                  {it.notes && <small>{it.notes}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No gift ideas yet.</p>
          )}
          {r.interests && (
            <p>
              <b>Interests</b> · {r.interests}
            </p>
          )}
          {r.preferences && (
            <p>
              <b>Preferences</b> · {r.preferences}
            </p>
          )}
        </div>
      ) : (
        <>
          <h3>Your secret recipient</h3>
          <p>Open this card when you have a moment to yourself.</p>
          <form action={action}>
            <input type="hidden" name="id" value={group.id} />
            <Button disabled={pending}>
              {pending
                ? "Opening…"
                : group.revealed
                  ? "View my recipient"
                  : "Unwrap my match"}
              <Gift size={16} />
            </Button>
          </form>
        </>
      )}
      <Status result={state} />
    </div>
  );
}
export function SignIn({ next }: { next: string }) {
  const [address, setAddress] = useState("");
  const [sent, send, sending] = useActionState(
    authenticate.bind(null, "send"),
    {},
  );
  const [verified, verify, checking] = useActionState(
    authenticate.bind(null, "verify"),
    {},
  );
  return (
    <div className="form-stack">
      <form action={send} className="form-stack">
        <label>
          Email address
          <input
            name="email"
            autoComplete="email"
            type="email"
            pattern="[^@\s]+@[oO][rR][aA][cC][lL][eE]\.[cC][oO][mM]"
            title="Use your @oracle.com email address."
            placeholder="you@oracle.com"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <Button disabled={sending}>
          <Mail size={17} />
          {sending
            ? "Sending…"
            : sent.success
              ? "Send another code"
              : "Email me a code"}
        </Button>
        <Status result={sent} />
      </form>
      {sent.sentTo && (
        <form action={verify} className="form-stack">
          <input type="hidden" name="email" value={sent.sentTo} />
          <input type="hidden" name="next" value={next} />
          <label>
            Sign-in code sent to {sent.sentTo}
            <input
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6,10}"
            />
          </label>
          <Button disabled={checking}>
            Verify and continue <ArrowRight size={16} />
          </Button>
          <Status result={verified} />
        </form>
      )}
    </div>
  );
}
