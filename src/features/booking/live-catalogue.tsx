"use client";
import { useEffect, useState } from "react";
import type { CustomerCatalogue } from "@/domain/catalog";
import {
  customerCatalogueService,
  type CustomerCatalogueService,
} from "@/services/customer-catalogue";
import { CONTACT } from "@/domain/catalog";
import { money } from "@/domain/dates";
export function LiveCatalogue({
  service = customerCatalogueService,
}: {
  service?: CustomerCatalogueService;
}) {
  const [revision, retry] = useState(0);
  const [result, setResult] = useState<{
    owner: CustomerCatalogueService;
    revision: number;
    data?: CustomerCatalogue;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void service
      .read(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ owner: service, revision, data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ owner: service, revision, failed: true });
      });
    return () => controller.abort();
  }, [service, revision]);
  const current =
    result?.owner === service && result.revision === revision ? result : null;
  if (!current) return <p role="status">Loading current sessions…</p>;
  if (current.failed)
    return (
      <section className="surface">
        <p role="alert">
          Session information is unavailable. Your details have been kept.
        </p>
        <button className="button" onClick={() => retry((n) => n + 1)}>
          Try again
        </button>
      </section>
    );
  const sessions = current.data?.services.filter((item) => item.active) ?? [];
  return (
    <section className="surface" aria-label="Current sessions">
      {sessions.length ? (
        sessions.map((item) => (
          <article key={item.id}>
            <h2>{item.name}</h2>
            <p>
              {item.durationMinutes} minutes ·{" "}
              {item.currency === "SGD"
                ? money(item.priceMinor)
                : `${item.currency} ${(item.priceMinor / 100).toFixed(2)}`}
            </p>
            <p>
              {current.data?.instructors
                .filter(
                  (person) =>
                    person.active &&
                    (item.instructorIds === null ||
                      item.instructorIds.includes(person.id)),
                )
                .map((person) => person.name)
                .join(", ") || "No instructor currently available"}
            </p>
          </article>
        ))
      ) : (
        <p>No sessions are currently available.</p>
      )}
      <p>
        Online booking is not available yet.{" "}
        <a href={`mailto:${CONTACT.email}`}>Contact the studio</a> for help.
      </p>
    </section>
  );
}
