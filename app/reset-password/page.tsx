import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { PasswordResetLinkForm } from "@/components/forms";
export const dynamic = "force-dynamic";
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <PageFrame title="Choose a new password" description="Use the private, one-time link shared by your administrator.">
    <div className="panel"><PasswordResetLinkForm error={error?.slice(0, 500)} /></div>
    <p className="hint">For a new reset link, contact your administrator.</p>
    <p className="intro"><Link className="text-link" href="/signin">Back to sign in</Link></p>
  </PageFrame>;
}
