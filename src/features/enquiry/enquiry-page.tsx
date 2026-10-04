"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { ENQUIRY_TYPES } from "@/domain/catalog";
import { todaySG } from "@/domain/dates";
import { services } from "@/services";
import type { Enquiry } from "@/services/contracts";
const blank: Enquiry = {
  name: "",
  email: "",
  phone: "",
  organisation: "",
  purpose: "",
  guests: "",
  date: "",
  time: "",
  message: "",
};
// The exported HTML must not accept input before React can retain changes.
const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;
export function EnquiryPage() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  );
  const [value, setValue] = useState(blank),
    [receipt, setReceipt] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const change = (key: keyof Enquiry, text: string) =>
    setValue((current) => ({ ...current, [key]: text }));
  const field = (
    key: keyof Enquiry,
    label: string,
    type = "text",
    required = false,
  ) => (
    <div>
      <label className="field-label" htmlFor={`enquiry-${key}`}>
        {label}{" "}
        {required ? (
          "*"
        ) : (
          <span className="font-normal text-muted">Optional</span>
        )}
      </label>
      <input
        id={`enquiry-${key}`}
        className="field-control"
        value={value[key]}
        type={type}
        required={required}
        min={type === "date" ? todaySG() : type === "number" ? 1 : undefined}
        max={type === "number" ? 999 : undefined}
        maxLength={key === "email" ? 120 : 160}
        onChange={(e) => change(key, e.target.value)}
      />
    </div>
  );
  return (
    <div className="mx-auto min-h-[65vh] max-w-4xl px-5 py-10 sm:px-10">
      <Link className="back mb-8" href="/">
        <Icon name="back" />
        Back to home
      </Link>
      {receipt ? (
        <div className="py-12 text-center">
          <Icon
            name="check"
            className="mx-auto mb-6 h-16 w-16 text-emerald-600"
          />
          <h1 className="page-title">Thank you.</h1>
          <p className="mt-6">
            Your enquiry for <strong>{receipt}</strong> is ready in this
            preview.
          </p>
          <p className="mt-3 text-sm text-muted">Preview · No enquiry sent.</p>
          <button
            className="button mt-8"
            onClick={() => {
              setReceipt("");
              setValue(blank);
            }}
          >
            Send another enquiry
          </button>
        </div>
      ) : (
        <>
          <h1 className="page-title">Contact the studio.</h1>
          <p className="mt-4 text-muted">
            Tell us about your special arrangements or reservation.
          </p>
          <form
            className="surface mt-8 space-y-7"
            aria-busy={!ready || busy}
            onSubmit={async (event) => {
              event.preventDefault();
              if (!ready || busy) return;
              setBusy(true);
              setError("");
              try {
                const result = await services.enquiry.submit(value);
                setReceipt(result.email);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="text-xs text-muted">* Required fields</p>
            <fieldset disabled={!ready}>
              <legend className="mb-5 text-xl font-bold">Your details</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                {field("name", "Full name", "text", true)}
                {field("email", "Email address", "email", true)}
                {field("phone", "Contact number", "tel", true)}
                {field("organisation", "Academy, school or organisation")}
              </div>
            </fieldset>
            <fieldset disabled={!ready}>
              <legend className="mb-5 text-xl font-bold">Your plans</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="enquiry-purpose" className="field-label">
                    Enquiry type *
                  </label>
                  <select
                    id="enquiry-purpose"
                    className="field-control"
                    required
                    value={value.purpose}
                    onChange={(e) => change("purpose", e.target.value)}
                  >
                    <option value="">Select an arrangement</option>
                    {ENQUIRY_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </div>
                {field("guests", "Number of guests", "number")}
                {field("date", "Preferred date", "date")}
                {field("time", "Preferred time", "time")}
                <div className="sm:col-span-2">
                  <label htmlFor="enquiry-message" className="field-label">
                    Your requirements *
                  </label>
                  <textarea
                    id="enquiry-message"
                    rows={5}
                    className="field-control"
                    required
                    maxLength={2000}
                    value={value.message}
                    onChange={(e) => change("message", e.target.value)}
                  />
                </div>
              </div>
            </fieldset>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <button className="button" disabled={!ready || busy}>
              {busy ? "Preparing…" : "Send enquiry"}
              <Icon name="arrow" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
