"use client";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { MAX_PLAYERS, SERVICE_NAME } from "@/domain/catalog";
import { useBooking } from "./provider";
export function SessionStep() {
  const { draft, update } = useBooking();
  return (
    <>
      <h1 className="page-title">Your session</h1>
      <p className="mt-3 text-muted">
        Set the number of players for your booking.
      </p>
      <section className="surface session-product mt-7">
        <span className="session-product-icon">
          <Icon name="ball" />
        </span>
        <div>
          <h2 className="text-2xl">{SERVICE_NAME}</h2>
          <p className="mt-2 text-muted">
            Interactive football in a 360° arena, for individual players and
            groups.
          </p>
        </div>
      </section>
      <div className="config-row mb-7">
        <div>
          <span className="field-label">Session length</span>
          <div className="flex min-h-[46px] items-center gap-3 rounded-lg border border-line bg-white px-4 text-sm">
            <Icon name="clock" />
            <strong>40 minutes per session</strong>
          </div>
        </div>
        <div>
          <span className="field-label" id="players-label">
            Players · maximum 4
          </span>
          <div className="counter">
            <button
              className="disabled:text-slate-300"
              aria-label="Remove one player"
              disabled={draft.players <= 1}
              onClick={() => update({ players: draft.players - 1 })}
            >
              <Icon name="minus" />
            </button>
            <output
              aria-labelledby="players-label"
              aria-live="polite"
              className="font-bold"
            >
              {draft.players} {draft.players === 1 ? "player" : "players"}
            </output>
            <button
              className="disabled:text-slate-300"
              aria-label="Add one player"
              disabled={draft.players >= MAX_PLAYERS}
              onClick={() => update({ players: draft.players + 1 })}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>
      </div>
      <section className="surface session-inclusions">
        <h2 className="mb-6 text-2xl">Included with your session</h2>
        <ul className="space-y-6">
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
            <li key={title} className="flex gap-4">
              <Icon name="check" className="text-cyan" />
              <div>
                <h3 className="font-bold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/book/time/" className="button mt-8">
        See available times <Icon name="arrow" />
      </Link>
    </>
  );
}
