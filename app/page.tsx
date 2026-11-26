import Link from "next/link";
import { Snowfall } from "@/components/snowfall";
import Image from "next/image";
import {
  ArrowRight,
  UserRoundPlus,
  UsersRound,
  MailOpen,
  Shuffle,
  LockKeyhole,
  FlaskConical,
  Gift,
  Snowflake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm, Submit } from "@/components/forms";
import { demo } from "@/lib/config";
const steps = [
  {
    icon: UsersRound,
    title: "Gather your circle",
    body: "Create a group, set your gift budget, and pick a date to exchange gifts.",
    color: "sage",
  },
  {
    icon: MailOpen,
    title: "Send the invitations",
    body: "Share your group link so everyone can join and add a few wishlist ideas.",
    color: "rose",
  },
  {
    icon: Shuffle,
    title: "Draw names",
    body: "Draw once, then let each person unwrap their private match.",
    color: "gold",
  },
];
export default function Home() {
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
            Bring your favorite people together for a Secret Santa gift
            exchange. We’ll keep the names a secret.
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link href="/create">
                <Gift size={18} />
                Create a Group <ArrowRight size={16} />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/join">
                <UserRoundPlus size={17} />
                Join a Group
              </Link>
            </Button>
          </div>
          <div className="privacy">
            <LockKeyhole size={14} />
            Private matches, even from the organizer.
          </div>
        </div>
        <div className="postcard">
          <div className="postcard-sheet">
            <div className="postcard-art">
              <Image
                src="/gifts.webp"
                alt="Holiday postcard with three ribbon-wrapped gifts and pine sprigs"
                fill
                priority
                sizes="(max-width: 760px) 88vw, 44vw"
              />
            </div>
            <Snowfall />
            <div className="stamp" aria-hidden="true">
              <Snowflake size={24} />
            </div>
            <div className="post-lines" aria-hidden="true">
              〰<br />〰
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
      {demo && (
        <section className="shell demo-section">
          <div>
            <span className="eyebrow">
              <FlaskConical size={15} />
              Demo mode
            </span>
            <h2>Take a sample circle for a spin.</h2>
            <p>
              Try the organizer dashboard and private reveal with a group of
              fictional friends.
            </p>
          </div>
          <ActionForm op="sample">
            <Submit outline>
              Open sample group <ArrowRight size={16} />
            </Submit>
          </ActionForm>
        </section>
      )}
    </>
  );
}
