import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { PageFrame } from "@/components/page-frame";
import { ChangePasswordForm } from "@/components/forms";
export const dynamic = "force-dynamic";
export default async function ChangePassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  const { error } = await searchParams;
  return <PageFrame title="Reset password" description="Answer your recovery question and choose a new password.">
    <div className="panel">
      <p className="notice">If you did not set a recovery hint when registering, contact admin <strong>Test Participant 23</strong> for a one-time password reset link.</p>
      {error && <p className="notice error" role="alert">{error.slice(0, 500)}</p>}
      {user?.admin ? <p>Admin credentials are managed through ADMIN_PASSWORD in the server configuration.</p> : <ChangePasswordForm name={user?.name} />}
    </div>
    <p className="intro"><Link className="text-link" href={user ? "/dashboard" : "/signin"}>{user ? "Back to dashboard" : "Back to sign in"}</Link></p>
  </PageFrame>;
}
