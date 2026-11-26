import { cookies } from "next/headers";
import { buildPasswordResetLink } from "@/lib/reset-url";
import { requireUser } from "@/lib/auth";
import { store } from "@/lib/db";
import { linkParticipant } from "@/app/actions";
import { ActionForm, Draw, Submit, AdminPasswordReset, GeneratedPasswordResetLink } from "@/components/forms";
import { PageFrame } from "@/components/page-frame";
import { WishlistEditor } from "@/components/wishlist-session";
import { RefreshStatus } from "@/components/refresh-status";
import { EventDetails } from "@/components/event-details";
import { AddPersonForm, RemovePersonForm } from "@/components/admin-roster";
import { DrawReset } from "@/components/draw-reset";
export const dynamic = "force-dynamic";
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ saved?: string; reveal?: string; error?: string }> }) {
  const user = await requireUser();
  const { saved, reveal, error } = await searchParams;
  const resetToken = user.admin && saved === "reset-link" ? (await cookies()).get("santa-reset-link")?.value : undefined;
  const resetInfo = resetToken ? store().resetLinkInfo(resetToken) : undefined;
  const enabled = store().enabled();
  const recipient = !user.admin && enabled && reveal === "1" ? store().reveal(user.id) : undefined;
  const participants = user.admin ? store().participants() : [];
  const unlinked = participants.filter(p => p.approved_person_id === null);
  const approvedPeople = user.admin ? store().approvedPeople() : [];
  const registeredPeople = new Set(participants.map(person => person.approved_person_id));
  const available = approvedPeople.filter(person => !registeredPeople.has(person.id));
  return <PageFrame wide title={user.admin ? "Administrator" : `Hello, ${user.name}`} description={user.admin ? "Enable the draw when everyone has registered and saved their wishlist. You do not participate in the exchange." : enabled ? "Wishlists are locked. Draw your secret recipient when you’re ready." : "Add a few gift ideas, then draw your secret recipient when it’s time."}>
    <EventDetails />
    {error && <p className="notice error" role="alert">{error.slice(0, 500)}</p>}
    {saved === "enable" && user.admin && enabled && <p className="notice" role="status">Draw enabled! Registration is closed, wishlists are locked, and matches are ready.</p>}
    {saved === "roster" && user.admin && <p className="notice" role="status">Account matched to the approved roster.</p>}
    {saved === "person-added" && user.admin && <p className="notice" role="status">Person added. They can now create an account using their Aria Profile name.</p>}
    {saved === "person-removed" && user.admin && <p className="notice" role="status">Person removed from the approved list. Any associated account and account data have been deleted.</p>}
    {saved === "draw-reset" && user.admin && <p className="notice" role="status">Draw reset. Previous assignments are invalid. Registration, roster changes, and wishlists are open again. Finalize the team, then enable a new draw.</p>}
    {user.admin && resetToken && resetInfo && <GeneratedPasswordResetLink link={buildPasswordResetLink(resetToken)} name={resetInfo.name} expires={resetInfo.expires} />}
    {user.admin && saved === "reset-link" && !resetInfo && <p className="notice">This reset link has been used or expired. Generate a new link beside the participant's name.</p>}
    {user.admin ? <>
      <section className="panel"><h2>Approved people ({approvedPeople.length})</h2>
        <p>{enabled ? "The participant list is locked because the draw has started." : "Finalize the team before enabling the draw. Add each person’s full name from their Aria Profile so they can register. Deleting a person also permanently deletes their account, if registered."}</p>
        {!enabled && <AddPersonForm key={approvedPeople.length} />}
        {approvedPeople.length ? <ul className="people roster-list">{approvedPeople.map(person => <li className="roster-person" key={person.id}>
          <div className="roster-person-details"><span>{person.name}</span><span className="hint">{registeredPeople.has(person.id) ? "Registered" : "Not registered"}</span></div>
          {!enabled && <RemovePersonForm personId={person.id} name={person.name} registered={registeredPeople.has(person.id)} />}
        </li>)}</ul> : <p>No approved people yet. Add a name above to get started.</p>}
      </section>
      {unlinked.length > 0 && <section className="panel"><h2>Match existing accounts</h2>
        <p>These accounts were created before the approved roster. Match each account to its full approved name. New registrations are blocked until all accounts are matched. Existing wishlists and draw assignments are preserved.</p>
        {unlinked.map(p => <form key={p.id} action={linkParticipant} className="form-stack panel">
          <input type="hidden" name="userId" value={p.id} />
          <p>{p.name}</p><label>Approved name<select name="personId" required defaultValue=""><option value="" disabled>Select the correct person</option>{available.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <Submit>Match account</Submit>
        </form>)}
      </section>}
      <section className="panel"><h2>{enabled ? "The draw is open" : "Ready to draw?"}</h2>
        <p>{enabled ? "Matches are saved and wishlists are locked. Participants can sign in and press Draw to see their recipient." : "Make sure everyone has saved their wishlist. Enabling the draw closes registration, locks all wishlists, and assigns everyone exactly one recipient. Changes afterward require the protected reset process."}</p>
        <ActionForm op="enable" confirm="Enable the draw now? This closes registration, locks all wishlists, and assigns matches for all registered participants. Make sure everyone has saved their wishlist first."><Submit disabled={enabled || participants.length < 2}>{enabled ? "Draw enabled" : "Enable draw"}</Submit></ActionForm>
        {!enabled && participants.length < 2 && <p className="hint">At least two participants must register first.</p>}
      </section>
      <section className="panel"><h2>Participants ({participants.length})</h2><p>Only participants appear here. The administrator is excluded.</p>{participants.length ? <ul className="people">{participants.map(p => <li className="admin-person" key={p.id}><span className="avatar">{p.name.slice(0, 1)}</span><div>{p.name}</div><AdminPasswordReset participantId={p.id} name={p.name} /></li>)}</ul> : <p>No participants yet. Share this app’s address with your team.</p>}<RefreshStatus /></section>
      {enabled && <DrawReset key={store().drawRevision()} revision={store().drawRevision()} participantCount={participants.length} />}
    </> : <div className="dashboard-grid">
      <section className="panel"><h2>My wishlist</h2>{enabled ? <><p className="notice">Wishlists are locked because the draw has started.</p><p className="wishlist-text">{user.wishlist || "You did not add a wishlist before the draw started."}</p></> : <><p>Gift ideas, links, interests, sizes, or things to avoid. Save your wishlist before the administrator enables the draw; it will be locked afterward.</p><WishlistEditor initiallySaved={saved === "wishlist"} /></>}</section>
      <section className="panel"><h2>My draw</h2><Draw enabled={enabled} recipient={recipient} />{!enabled && <div className="draw-status-actions"><RefreshStatus /></div>}</section>
    </div>}
  </PageFrame>;
}
