export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Gift,
  UsersRound,
  ClipboardList,
  Settings2,
  Shuffle,
  CalendarDays,
  Coins,
  Trash2,
  LockKeyhole,
} from "lucide-react";
import { requireUser, call } from "@/lib/data";
import { budgetLabel, displayDate, type Circle } from "@/lib/types";
import { PageFrame } from "@/components/page-frame";
import {
  ActionForm,
  CopyInvite,
  GroupFields,
  Reveal,
  Submit,
  Wishlist,
} from "@/components/forms";

export default async function Group({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) notFound();
  await requireUser("/groups/" + id);
  let g: Circle;
  try {
    g = await call<Circle>("view", { id });
  } catch (e) {
    if (e instanceof Error && e.message.includes("unavailable")) notFound();
    throw e;
  }
  const tabs = [
    { id: "overview", name: "Overview", icon: Gift },
    { id: "people", name: "Participants", icon: UsersRound },
    { id: "wishlist", name: "My wishlist", icon: ClipboardList },
    ...(g.organizer
      ? [{ id: "settings", name: "Settings", icon: Settings2 }]
      : []),
  ];
  const selected = (await searchParams).tab;
  const tab = tabs.some((t) => t.id === selected) ? selected : "overview";
  const name = (id: string) =>
    g.members.find((m) => m.id === id)?.name || "Participant";
  return (
    <PageFrame wide title={g.name}>
      <div className="group-meta">
        <span>
          <CalendarDays />
          {displayDate(g.date)}
        </span>
        <span>
          <Coins />
          {budgetLabel(g)}
        </span>
        <span>
          <UsersRound />
          {g.members.length} participants
        </span>
      </div>
      <nav className="tabs" aria-label="Group sections">
        {tabs.map(({ id: t, name, icon: Icon }) => (
          <Link
            key={t}
            aria-current={tab === t ? "page" : undefined}
            href={"?tab=" + t}
          >
            <Icon size={16} />
            {name}
          </Link>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="dashboard-grid">
          <section className="panel">
            <div className="eyebrow">
              <Shuffle size={16} />
              Gift exchange
            </div>
            <h2>{g.drawn ? "Names are drawn" : "Gathering the circle"}</h2>
            {g.message && <blockquote>{g.message}</blockquote>}
            <p>
              {g.drawn
                ? "Your match is ready to reveal."
                : g.organizer
                  ? "Invite everyone and set any exclusions before you draw names."
                  : "Your organizer will draw names once everyone has joined."}
            </p>
            {!g.drawn && g.organizer && (
              <>
                <CopyInvite code={g.code!} />
                <ActionForm
                  op="draw"
                  id={id}
                  confirm="Draw names now? This locks participants, exclusions, and group settings."
                >
                  <Submit disabled={g.members.length < 3}>
                    <Shuffle size={16} />
                    Draw names
                  </Submit>
                  {g.members.length < 3 && (
                    <p className="hint">
                      At least three participants are needed.
                    </p>
                  )}
                </ActionForm>
              </>
            )}
            {g.drawn && <Reveal group={g} />}
          </section>
          <aside className="panel">
            <div className="eyebrow">
              <UsersRound size={16} />
              Your circle
            </div>
            <h2>Participants</h2>
            <ul className="people">
              {g.members.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <span className="avatar">{m.name.slice(0, 1)}</span>
                  <span>
                    {m.name}
                    {m.id === g.me ? " (you)" : ""}
                  </span>
                  {m.organizer && <small>Organizer</small>}
                </li>
              ))}
            </ul>
            <Link className="text-link" href="?tab=people">
              View all participants →
            </Link>
          </aside>
        </div>
      )}
      {tab === "people" && (
        <div className="dashboard-grid">
          <section className="panel">
            <h2>Participants ({g.members.length})</h2>
            <ul className="people">
              {g.members.map((m) => (
                <li key={m.id}>
                  <span className="avatar">{m.name.slice(0, 1)}</span>
                  <div>
                    {m.name}
                    {m.id === g.me ? " (you)" : ""}
                    <small>
                      {m.organizer ? "Organizer" : "Joined"}
                      {g.drawn && g.organizer
                        ? m.revealed
                          ? " · Revealed"
                          : " · Unopened"
                        : ""}
                    </small>
                  </div>
                  {g.organizer && !g.drawn && m.id !== g.me && (
                    <ActionForm
                      op="remove"
                      id={id}
                      confirm={"Remove " + m.name + " from this group?"}
                    >
                      <input type="hidden" name="member" value={m.id} />
                      <button className="theme" aria-label={"Remove " + m.name}>
                        <Trash2 size={15} />
                      </button>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {g.organizer && (
            <aside className="panel">
              <h2>Invitations</h2>
              {!g.drawn && (
                <>
                  <CopyInvite code={g.code!} />
                  <ActionForm op="invite" id={id} className="form-stack">
                    <label>
                      Track an invited guest
                      <input
                        name="email"
                        type="email"
                        required
                        placeholder="guest@example.com"
                      />
                    </label>
                    <p className="hint">
                      Share the link yourself. This list tracks who still needs
                      to join.
                    </p>
                    <Submit outline>Track invitation</Submit>
                  </ActionForm>
                </>
              )}
              <h3>Pending ({g.pending.length})</h3>
              {g.pending.length ? (
                <ul>
                  {g.pending.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : (
                <p>No pending invitations.</p>
              )}
            </aside>
          )}
        </div>
      )}
      {tab === "wishlist" && (
        <section className="panel editor">
          <h2>My wishlist</h2>
          <p>
            Your Secret Santa can see these details after opening their match.
          </p>
          <Wishlist group={g} />
        </section>
      )}
      {tab === "settings" && g.organizer && (
        <div className="dashboard-grid">
          <section className="panel">
            <h2>Group settings</h2>
            {g.drawn ? (
              <p>Settings are locked after the draw.</p>
            ) : (
              <ActionForm op="settings" id={id} className="form-stack">
                <GroupFields group={g} />
                <Submit>Save settings</Submit>
              </ActionForm>
            )}
          </section>
          <section className="panel">
            <div className="eyebrow">
              <LockKeyhole size={15} />
              Draw rules
            </div>
            <h2>Exclusions</h2>
            <p>Excluded pairs can’t draw each other in either direction.</p>
            {g.exclusions.length ? (
              <ul className="people">
                {g.exclusions.map((pair) => (
                  <li key={pair.a + pair.b}>
                    {name(pair.a)} &amp; {name(pair.b)}
                    {!g.drawn && (
                      <ActionForm op="allow" id={id}>
                        <input type="hidden" name="a" value={pair.a} />
                        <input type="hidden" name="b" value={pair.b} />
                        <button
                          className="theme"
                          aria-label={
                            "Remove exclusion for " +
                            name(pair.a) +
                            " and " +
                            name(pair.b)
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No exclusions configured.</p>
            )}
            {!g.drawn && g.members.length >= 2 && (
              <ActionForm op="exclude" id={id} className="form-stack">
                {["a", "b"].map((k, i) => (
                  <label key={k}>
                    {i ? "Second participant" : "First participant"}
                    <select name={k} defaultValue={g.members[i].id}>
                      {g.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <Submit outline>Add exclusion</Submit>
              </ActionForm>
            )}
          </section>
        </div>
      )}
    </PageFrame>
  );
}
