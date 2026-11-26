import Link from "next/link";
import { ChevronLeft } from "lucide-react";
export function PageFrame({ title, description, children, wide = false }: { title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={"shell interior " + (wide ? "wide" : "narrow")}>
    <Link className="back" href="/"><ChevronLeft size={16} />Home</Link>
    <h1>{title}</h1>{description && <p className="intro">{description}</p>}{children}
  </div>;
}
