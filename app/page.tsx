import { currentUser } from "@/lib/auth";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  UserRoundPlus,
  UsersRound,
  MailOpen,
  Shuffle,
  LockKeyhole,
  Gift,
  Snowflake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventDetails } from "@/components/event-details";
import { GiftSurprise } from "@/components/easter-eggs";
const steps = [
  {
    icon: UsersRound,
    title: "Create your account",
    body: "Sign up with your Aria Profile name and password. Everyone on the team registers once.",
    color: "sage",
  },
  {
    icon: MailOpen,
    title: "Add your wishlist",
    body: "Share gift ideas and preferences to help your Secret Santa choose.",
    color: "rose",
  },
  {
    icon: Shuffle,
    title: "Draw names",
    body: "Once the administrator opens the draw, reveal your private recipient.",
    color: "gold",
  },
];
export default async function Home() {
  const user = await currentUser();
  return (
    <>
      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="red-star" aria-hidden="true">
              ✳
            </span>{" "}
            Secret Santa gift exchanges
          </div>
          <h1>
            A little mystery.
            <br />
            <em>A lot of joy.</em>
          </h1>
          <p>
            A Secret Santa for our team. Create an account, add your wishlist,
            and discover who you’ll surprise.
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link href={user ? "/dashboard" : "/signup"}>
                <Gift size={18} />
                {user ? "My dashboard" : "Create account"} <ArrowRight size={16} />
              </Link>
            </Button>
            {!user && <Button asChild variant="outline">
              <Link href="/signin">
                <UserRoundPlus size={17} />
                Sign in
              </Link>
            </Button>}
          </div>
          <div className="privacy">
            <LockKeyhole size={14} />
            Your match is visible only in your signed-in account.
          </div>
        </div>
        <div className="hero-gift">
          <EventDetails compact />
          <div className="postcard">
            <div className="postcard-sheet">
              <GiftSurprise>
                <Image
                  src="/gifts.webp"
                  alt="Holiday postcard with three ribbon-wrapped gifts and pine sprigs"
                  fill
                  priority
                  sizes="(max-width: 760px) 88vw, 44vw"
                />
              </GiftSurprise>
              <div className="stamp" aria-hidden="true">
                <Snowflake size={24} />
              </div>
              <div className="post-lines" aria-hidden="true">
                〰<br />〰
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="steps-section" id="how-it-works">
        <div className="shell">
          <h2>How it works</h2>
          <div className="steps">
            {steps.map(({ icon: Icon, title, body, color }, i) => (
              <article className={"step " + color} key={title}>
                <div className="step-top">
                  <span className="icon-tile">
                    <Icon size={25} strokeWidth={1.6} />
                  </span>
                  <span className="step-no">0{i + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
