export const dynamic = "force-dynamic";
import { ArrowRight } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ActionForm, Submit } from "@/components/forms";
import { requireUser } from "@/lib/data";
import { demo } from "@/lib/config";
export default async function Join({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code.slice(0, 12) : "";
  const user = await requireUser(
    "/join" + (code ? "?code=" + encodeURIComponent(code) : ""),
  );
  return (
    <PageFrame
      title="Join a group"
      description="Enter the code from your invitation to join the gift exchange."
    >
      <ActionForm op="join" className="panel form-stack">
        <label>
          Group code
          <input
            name="code"
            required
            maxLength={12}
            minLength={12}
            defaultValue={code}
            placeholder="12-character invitation code"
            autoCapitalize="characters"
          />
        </label>
        <label>
          Your name
          <input name="person" autoComplete="name" required maxLength={80} />
        </label>
        <label>
          {demo ? "Demo email address" : "Verified email address"}
          <input
            name="email"
            type="email"
            pattern="[^@\s]+@[oO][rR][aA][cC][lL][eE]\.[cC][oO][mM]"
            title="Use your @oracle.com email address."
            autoComplete="email"
            required
            readOnly={!demo}
            defaultValue={user?.email}
            placeholder="you@oracle.com"
          />
        </label>
        <Submit>
          Join group <ArrowRight size={16} />
        </Submit>
      </ActionForm>
    </PageFrame>
  );
}
