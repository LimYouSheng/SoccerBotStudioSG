"use client";
import { BookingLoading as BrandLoading } from "./booking-loading";
import Link from "next/link";
import { useEffect } from "react";
import type { CustomerCatalogue } from "@/domain/catalog";
import { Icon } from "@/components/icon";
import { MAX_PLAYERS } from "@/domain/booking-policy";
import { SERVICE_NAME } from "@/domain/demo-catalog";
import { LiveCatalogue } from "./live-catalogue";
import { useBooking } from "./provider";
/** Select the live or demo session presentation. */
export function SessionStep() {
  const { bookingService } = useBooking();
  return bookingService.mode === "live" ? (
    <LiveCatalogue render={(data) => <LiveSession data={data} />} />
  ) : (
    <SessionPresentation />
  );
}
/** Resolve live catalogue data for the session selection step. */
function LiveSession({ data }: { data: CustomerCatalogue }) {
  const { draft, update } = useBooking();
  const eligible = data.services.filter(
    (service) =>
      service.active &&
      service.durationMinutes === 40 &&
      service.currency === "SGD" &&
      !service.recurring &&
      data.instructors.some(
        (i) =>
          i.active &&
          (service.instructorIds === null ||
            service.instructorIds.includes(i.id)),
      ),
  );
  const selected =
    eligible.find((service) => service.id === draft.nativeServiceId) ??
    (eligible.length === 1 ? eligible[0] : undefined);
  useEffect(() => {
    if (selected && draft.nativeServiceId !== selected.id)
      update({ nativeServiceId: selected.id, slots: [] });
  }, [selected, draft.nativeServiceId, update]);
  if (!selected)
    return (
      <>
        <h1 className="page-title">Your session</h1>
        <section className="surface">
          <p>
            {eligible.length
              ? "Choose your session."
              : "No sessions are currently available."}
          </p>
          {eligible.map((service) => (
            <button
              key={service.id}
              className="button"
              onClick={() => update({ nativeServiceId: service.id, slots: [] })}
            >
              {service.name}
            </button>
          ))}
        </section>
      </>
    );
  return (
    <SessionPresentation
      serviceName={selected.name}
      pending={draft.nativeServiceId !== selected.id}
    />
  );
}
/** Render session information and player-count controls. */
function SessionPresentation({
  serviceName = SERVICE_NAME,
  pending = false,
}: {
  serviceName?: string;
  pending?: boolean;
}) {
  const { draft, update } = useBooking();
  const playerSelection = (
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
  );
  return (
    <>
      <h1 className="page-title">Your session</h1>
      <p className="lead">Set the number of players for your booking.</p>
      <section className="surface session-product">
        <span className="session-product-icon">
          <Icon name="ball" />
        </span>
        <div>
          <h2>{serviceName}</h2>
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
      <p className="hint">
        S$88 weekdays · S$108 weekends and Singapore public holidays. Per
        session for 1–4 players.
      </p>
      {playerSelection}
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
        {pending ? (
          <button className="button" disabled>
            <BrandLoading
              overlay={false}
              compact
              label="Loading available times…"
            />
          </button>
        ) : (
          <Link href="/book/time/" className="button">
            See available times <Icon name="arrow" />
          </Link>
        )}
      </div>
    </>
  );
}
