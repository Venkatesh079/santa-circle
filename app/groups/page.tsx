export const dynamic = "force-dynamic";
import Link from "next/link";
import { ArrowRight, Gift, Plus } from "lucide-react";
import { requireUser, call } from "@/lib/data";
import { displayDate, type Summary } from "@/lib/types";
import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { ActionForm, Submit } from "@/components/forms";
import { demo } from "@/lib/config";
import { signOut } from "@/app/actions";
export default async function Groups() {
  await requireUser("/groups");
  const groups = await call<Summary[]>("list");
  return (
    <PageFrame
      wide
      title="My groups"
      description="Your gift exchanges, all in one place."
    >
      <div className="actions">
        <Button asChild>
          <Link href="/create">
            <Plus size={16} />
            Create a group
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/join">Join a group</Link>
        </Button>
        {!demo && (
          <form action={signOut}>
            <Button variant="ghost">Sign out</Button>
          </form>
        )}
      </div>
      {groups.length ? (
        <div className="group-list">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={"/groups/" + g.id}
              className="panel group-row"
            >
              <Gift />
              <div>
                <h2>{g.name}</h2>
                <p>
                  {displayDate(g.date)} ·{" "}
                  {g.organizer ? "Organizer" : "Participant"} ·{" "}
                  {g.drawn ? "Names drawn" : "Open for participants"}
                </p>
              </div>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel empty">
          <Gift size={30} />
          <h2>Your circle starts here.</h2>
          <p>Create a group or enter an invitation code to join one.</p>
          {demo && (
            <ActionForm op="sample">
              <Submit outline>Open sample group</Submit>
            </ActionForm>
          )}
        </div>
      )}
    </PageFrame>
  );
}
