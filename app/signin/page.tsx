import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { PageFrame } from "@/components/page-frame";
import { AccountForm } from "@/components/forms";
export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; changed?: string; name?: string }> }) {
  const { error, changed, name } = await searchParams;
  if (await currentUser()) redirect("/dashboard");
  return <PageFrame title="Welcome back" description="Sign in to your team’s Secret Santa."><div className="panel">{changed === "1" && <p className="notice" role="status">Password changed. Sign in with your new password.</p>}{error && <p className="notice error" role="alert">{error.slice(0, 500)}</p>}<AccountForm key={name || ""} mode="signin" name={name?.slice(0, 80)} /><p className="intro"><Link className="text-link" href="/change-password">Reset password</Link></p></div><p className="intro">New here? <Link className="text-link" href={name ? "/signup?name=" + encodeURIComponent(name.slice(0, 80)) : "/signup"}>Create an account</Link></p></PageFrame>;
}
