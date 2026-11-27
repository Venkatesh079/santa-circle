import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { store } from "@/lib/db";
import { PageFrame } from "@/components/page-frame";
import { AccountForm } from "@/components/forms";
export const dynamic = "force-dynamic";
export default async function SignUp({ searchParams }: { searchParams: Promise<{ error?: string; name?: string; recoveryQuestion?: string }> }) {
  const { error, name, recoveryQuestion } = await searchParams;
  if (await currentUser()) redirect("/dashboard");
  return <PageFrame title="Join the holiday fun" description="One team. One account each. A little mystery."><div className="panel">{error && <p className="notice error" role="alert">{error.slice(0, 500)}</p>}{(await store().enabled()) ? <p>Registration is closed because the draw has been enabled. Existing participants can still sign in.</p> : (await store().needsRosterReview()) ? <p>The administrator is matching existing accounts to the approved roster. Please check back once that review is complete.</p> : <AccountForm key={`${name || ""}:${recoveryQuestion || ""}`} mode="signup" name={name?.slice(0, 80)} recoveryQuestion={recoveryQuestion?.slice(0, 32)} />}</div><p className="intro">Already registered? <Link className="text-link" href="/signin">Sign in</Link></p></PageFrame>;
}
