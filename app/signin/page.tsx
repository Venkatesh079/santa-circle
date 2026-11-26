export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { SignIn } from "@/components/forms";
import { demo } from "@/lib/config";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (demo) redirect("/groups");
  const params = await searchParams;
  return (
    <PageFrame
      title="Sign in to your circle"
      description="We’ll email you a one-time code to keep your match private."
    >
      <div className="panel">
        <SignIn next={params.next || "/groups"} />
      </div>
    </PageFrame>
  );
}
