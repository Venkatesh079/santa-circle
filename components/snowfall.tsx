"use client";
import { useState, type CSSProperties } from "react";
import { Snowflake } from "lucide-react";

export function Snowfall() {
  const [active, setActive] = useState(true);
  return <>
    <div className={"snowfall-overlay" + (active ? "" : " is-paused")} aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => {
        const foreground = i % 5 === 0;
        const size = foreground ? 3.2 : 1.5 + (i % 3) * 0.4;
        return <span key={i} style={{
          left: ((i * 37 + 7) % 100) + "%",
          width: size,
          height: size,
          opacity: foreground ? 0.3 : 0.18 + (i % 3) * 0.04,
          filter: foreground ? "blur(0.6px)" : undefined,
          animationDelay: -(i * 11.7) + "s",
          animationDuration: (foreground ? 28 : 34 + (i % 5) * 2) + "s",
          "--snow-drift": ((i % 2 ? 1 : -1) * (4 + (i % 3) * 3)) + "px",
        } as CSSProperties} />;
      })}
    </div>
    <button className="snow-control" type="button" aria-pressed={active} aria-label="Snowfall"
      title={active ? "Turn snowfall off" : "Turn snowfall on"} onClick={() => setActive(value => !value)}>
      <Snowflake size={15} aria-hidden="true" />{active ? "Snow on" : "Snow off"}
    </button>
  </>;
}
