"use client";
import { useEffect, useRef, useState } from "react";
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
  const { draft, update, identityService } = useBooking(),
    router = useRouter(),
    c = draft.contact;
  const [errors, setErrors] = useState<ContactErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const activeSave = useRef<AbortController | null>(null);
  const contactKey = JSON.stringify([draft.mode, draft.accountEmail, c]);
  useEffect(
    () => () => {
      activeSave.current?.abort();
      activeSave.current = null;
    },
    [contactKey, identityService],
  );
  async function save() {
    if (activeSave.current) return;
    const next = contactErrors(c, draft.accountEmail);
    setErrors(next);
    if (Object.keys(next).length) return;
    const controller = new AbortController();
    activeSave.current = controller;
    setSaving(true);
    setSaveMessage("");
    try {
      await identityService.saveProfile(c, controller.signal);
      if (!controller.signal.aborted)
        setSaveMessage("Contact details saved for your next visit.");
    } catch {
      if (!controller.signal.aborted)
        setSaveMessage(
          "Contact details could not be saved. Verify your email and try again.",
        );
    } finally {
      if (activeSave.current === controller) {
        activeSave.current = null;
        setSaving(false);
      }
    }
  }
  function change<K extends keyof ContactDetails>(
    key: K,
    value: ContactDetails[K],
  ) {
    activeSave.current?.abort();
    activeSave.current = null;
    setSaving(false);
    setSaveMessage("");
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
              Review your name and phone number, then save them for your next
              visit. Anyone using this verified email shares these saved contact
              details. Saving does not change previous bookings.
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
        {draft.mode === "member" && (
          <>
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving contact details…" : "Save contact details"}
            </button>
            {saveMessage && <p role="status">{saveMessage}</p>}
          </>
        )}
        <div className="actions">
          <button className="button" type="submit">
            Review booking <Icon name="arrow" />
          </button>
        </div>
      </form>
    </>
  );
}
