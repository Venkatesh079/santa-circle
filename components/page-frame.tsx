import Link from "next/link";
import { ChevronLeft, FlaskConical } from "lucide-react";
import { demo } from "@/lib/config";
export function DemoNote() {
  return demo ? (
    <p className="demo-note">
      <FlaskConical size={15} />
      <span>
        <b>Demo mode</b> · Use fictional details. Demo groups are temporary.
      </span>
    </p>
  ) : null;
}
export function PageFrame({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={"shell interior " + (wide ? "wide" : "narrow")}>
      <Link className="back" href="/">
        <ChevronLeft size={16} />
        Home
      </Link>
      <h1>{title}</h1>
      {description && <p className="intro">{description}</p>}
      <DemoNote />
      {children}
    </div>
  );
}
