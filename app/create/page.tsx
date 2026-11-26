export const dynamic = "force-dynamic";
import { ArrowRight } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ActionForm, Submit, GroupFields } from "@/components/forms";
import { requireUser } from "@/lib/data";
export default async function Create() {
  await requireUser("/create");
  return (
    <PageFrame
      title="Create a group"
      description="Start with the details. You can invite your circle next."
    >
      <ActionForm op="create" className="panel form-stack">
        <GroupFields />
        <Submit>
          Create group <ArrowRight size={16} />
        </Submit>
      </ActionForm>
    </PageFrame>
  );
}
