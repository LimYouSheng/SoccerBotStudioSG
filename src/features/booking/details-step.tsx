"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import {
  AGE_GROUPS,
  CONTACT_METHODS,
  EMERGENCY_RELATIONSHIPS,
  EXPERIENCE,
  RELATIONSHIPS,
} from "@/domain/catalog";
import {
  contactErrors,
  needsGuardian,
  type ContactDetails,
  type ContactErrors,
} from "@/domain/contact";
import { useBooking } from "./provider";
type TextKey = {
  [K in keyof ContactDetails]: ContactDetails[K] extends string ? K : never;
}[keyof ContactDetails];
export function DetailsStep() {
  const { draft, update } = useBooking(),
    router = useRouter(),
    c = draft.contact;
  const [errors, setErrors] = useState<ContactErrors>({});
  const guardian = needsGuardian(c),
    reuse = c.emergencySame && !c.self;
  function change<K extends keyof ContactDetails>(
    key: K,
    value: ContactDetails[K],
  ) {
    update({ contact: { ...c, [key]: value } });
    setErrors((current) => ({ ...current, [key]: undefined }));
  }
  function field(
    key: TextKey,
    label: string,
    type = "text",
    required = true,
    maxLength = 80,
  ) {
    return (
      <div>
        <label className="field-label" htmlFor={key}>
          {label}
          {required ? (
            " *"
          ) : (
            <span className="ml-2 font-normal text-muted">Optional</span>
          )}
        </label>
        <input
          id={key}
          name={key}
          className="field-control"
          type={type}
          maxLength={maxLength}
          required={required}
          readOnly={key === "email" && draft.mode === "member"}
          value={c[key]}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
          onChange={(e) => change(key, e.target.value)}
        />
        {errors[key] && (
          <p className="mt-2 text-sm text-red-700" id={`${key}-error`}>
            {errors[key]}
          </p>
        )}
      </div>
    );
  }
  function select(
    key: TextKey,
    label: string,
    options: Record<string, string>,
  ) {
    return (
      <div>
        <label className="field-label" htmlFor={key}>
          {label} *
        </label>
        <select
          id={key}
          name={key}
          className="field-control"
          value={c[key]}
          required
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
          onChange={(e) => change(key, e.target.value)}
        >
          <option value="">Select {label.toLowerCase()}</option>
          {Object.entries(options).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
        {errors[key] && (
          <p className="mt-2 text-sm text-red-700" id={`${key}-error`}>
            {errors[key]}
          </p>
        )}
      </div>
    );
  }
  function textarea(key: TextKey, label: string, maxLength = 300) {
    return (
      <div>
        <label className="field-label" htmlFor={key}>
          {label} <span className="font-normal text-muted">Optional</span>
        </label>
        <textarea
          id={key}
          className="field-control"
          rows={3}
          maxLength={maxLength}
          value={c[key]}
          onChange={(e) => change(key, e.target.value)}
        />
      </div>
    );
  }
  return (
    <>
      <h1 className="page-title">Your details</h1>
      <form
        className="mt-7 space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const next = contactErrors(
            c,
            draft.mode === "member" ? draft.accountEmail : undefined,
          );
          setErrors(next);
          const first = Object.keys(next)[0];
          if (first) document.getElementById(first)?.focus();
          else router.push("/book/review/");
        }}
      >
        <p className="text-xs text-muted">* Required fields</p>
        <section className="surface">
          <h2 className="mb-6 text-2xl">Booking contact</h2>
          {draft.mode === "member" && (
            <p className="mb-5 text-sm text-muted">
              Review your prefilled name and phone number. You can correct them
              here.
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            {field("name", "Full name")}
            {field(
              "email",
              draft.mode === "member"
                ? "Email address (verified)"
                : "Email address",
              "email",
              true,
              120,
            )}
            {field("phone", "Mobile number", "tel", true, 24)}
            {select(
              "contactMethod",
              "Preferred contact method",
              CONTACT_METHODS,
            )}
            {field(
              "academy",
              "Academy / school / organisation",
              "text",
              false,
              120,
            )}
          </div>
        </section>
        <section className="surface">
          <h2 className="mb-6 text-2xl">Participants</h2>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={c.self}
              onChange={(e) =>
                update({
                  contact: {
                    ...c,
                    self: e.target.checked,
                    emergencySame: false,
                  },
                })
              }
            />
            I am the lead participant.
          </label>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {!c.self && (
              <>
                {field("participant", "Lead participant’s name")}
                {select(
                  "relationship",
                  "Relationship to participant",
                  RELATIONSHIPS,
                )}
              </>
            )}
            {select("ageGroup", "Participant age group", AGE_GROUPS)}
            {select("experience", "Football experience", EXPERIENCE)}
          </div>
          {draft.players > 1 && (
            <div className="mt-5">
              {textarea(
                "additionalParticipants",
                "Additional participant names",
                240,
              )}
            </div>
          )}
        </section>
        <section className="surface">
          <h2 className="mb-3 text-2xl">
            {guardian ? "Parent / guardian contact" : "Emergency contact"}
          </h2>
          <p className="mb-5 text-sm text-muted">
            {guardian
              ? "Provide a parent or guardian contact for participants under 18."
              : "Someone we can contact during your session."}
          </p>
          {!c.self && (
            <label className="mb-5 flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={c.emergencySame}
                onChange={(e) => change("emergencySame", e.target.checked)}
              />
              Use the booking contact’s name and mobile number.
            </label>
          )}
          {reuse && (
            <p className="mb-5 text-sm">
              {c.name}
              <br />
              {c.phone}
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            {!reuse && (
              <>
                {field(
                  "emergencyName",
                  guardian
                    ? "Parent / guardian name"
                    : "Emergency contact name",
                )}
                {field(
                  "emergencyPhone",
                  guardian
                    ? "Parent / guardian mobile"
                    : "Emergency contact mobile",
                  "tel",
                  true,
                  24,
                )}
              </>
            )}
            {select(
              "emergencyRelationship",
              "Emergency contact relationship",
              guardian
                ? { parent: "Parent", guardian: "Legal guardian" }
                : EMERGENCY_RELATIONSHIPS,
            )}
          </div>
        </section>
        <section className="surface">
          <h2 className="mb-6 text-2xl">Session requirements</h2>
          <div className="space-y-5">
            {textarea("requirements", "Access or support requirements")}
            {textarea("notes", "Additional booking notes")}
          </div>
        </section>
        <button className="button" type="submit">
          Review booking <Icon name="arrow" />
        </button>
      </form>
    </>
  );
}
