"use client";
import { useState } from "react";
import { Snowflake } from "lucide-react";
export function Snowfall() {
  const [active, setActive] = useState(false);
  return (
    <>
      <div
        className={"snow-drift" + (active ? " active" : "")}
        aria-hidden="true"
      >
        {Array.from({ length: 20 }, (_, i) => (
          <i
            key={i}
            style={{
              left: ((i * 37) % 100) + "%",
              animationDelay: -(i % 7) + "s",
              animationDuration: 5 + (i % 4) + "s",
            }}
          />
        ))}
      </div>
      <button
        className="snow-control"
        type="button"
        aria-pressed={active}
        aria-label="Snowfall"
        title={active ? "Turn snowfall off" : "Turn snowfall on"}
        onClick={() => setActive(!active)}
      >
        <Snowflake size={14} />
        Snowfall
      </button>
    </>
  );
}
