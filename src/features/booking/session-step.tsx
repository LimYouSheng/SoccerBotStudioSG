"use client";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { MAX_PLAYERS } from "@/domain/booking-policy";
import { SERVICE_NAME } from "@/domain/demo-catalog";
import { useBooking } from "./provider";
export function SessionStep() {
  const { draft, update } = useBooking();
  return (
    <>
      <h1 className="page-title">Your session</h1>
      <p className="lead">Set the number of players for your booking.</p>
      <section className="surface session-product">
        <span className="session-product-icon">
          <Icon name="ball" />
        </span>
        <div>
          <h2>{SERVICE_NAME}</h2>
          <p>
            Interactive football in a 360° arena, for individual players and
            groups.
          </p>
          <div className="fixed-session-length">
            <Icon name="clock" />
            <strong>40 minutes per session</strong>
          </div>
        </div>
      </section>
      <section
        className="surface player-selection"
        aria-labelledby="players-label"
      >
        <span className="field-label" id="players-label">
          Players · maximum 4
        </span>
        <div className="counter">
          <button
            aria-label="Remove one player"
            disabled={draft.players <= 1}
            onClick={() => update({ players: draft.players - 1 })}
          >
            <Icon name="minus" />
          </button>
          <output aria-labelledby="players-label" aria-live="polite">
            {draft.players} {draft.players === 1 ? "player" : "players"}
          </output>
          <button
            aria-label="Add one player"
            disabled={draft.players >= MAX_PLAYERS}
            onClick={() => update({ players: draft.players + 1 })}
          >
            <Icon name="plus" />
          </button>
        </div>
      </section>
      <section className="session-inclusions">
        <h2 className="section-title">Included with your session</h2>
        <ul className="inclusion-list">
          {[
            [
              "Arena access",
              "Access to the arena’s 360° projection wall and interactive training system.",
            ],
            [
              "Full instructor guidance",
              "Your instructor introduces the activities and guides your group throughout the session.",
            ],
            [
              "Single, Team and Battle play",
              "Explore all three play modes during your studio session.",
            ],
          ].map(([title, text]) => (
            <li key={title}>
              <span className="inclusion-check">
                <Icon name="check" />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="actions">
        <Link href="/book/time/" className="button">
          See available times <Icon name="arrow" />
        </Link>
      </div>
    </>
  );
}
