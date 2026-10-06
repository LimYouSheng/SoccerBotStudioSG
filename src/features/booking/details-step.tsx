"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CONTACT_METHODS } from "@/domain/catalog";
import {
  contactErrors,
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
      <div className="field">
        <label className="field-label" htmlFor={key}>
          {label}
          {required ? " *" : <span className="field-optional">Optional</span>}
        </label>
        <input
          id={key}
          name={key}

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
          <p className="field-error" id={`${key}-error`}>
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
      <div className="field">
        <label className="field-label" htmlFor={key}>
          {label} *
        </label>
        <select
          id={key}
          name={key}

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
          <p className="field-error" id={`${key}-error`}>
            {errors[key]}
          </p>
        )}
      </div>
    );
  }
  return (
    <>
      <h1 className="page-title">Your details</h1>
      <form
        id="details-form"
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
        <p className="booking-required">* Required fields</p>
        <section className="surface">
          <h2 className="section-title">Booking contact</h2>
          {draft.mode === "member" && (
            <p className="section-description">
              Review your prefilled name and phone number. You can correct them
              here.
            </p>
          )}
          <div className="field-grid">
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
        <div className="actions">
          <button className="button" type="submit">
            Review booking <Icon name="arrow" />
          </button>
        </div>
      </form>
    </>
  );
}
