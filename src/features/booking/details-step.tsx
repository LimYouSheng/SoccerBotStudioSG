"use client";
import { BookingLoading as BrandLoading } from "./booking-loading";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CONTACT_METHODS } from "@/domain/catalog";
import {
  contactErrors,
  type ContactDetails,
  type ContactErrors,
} from "@/domain/contact";
import { useBooking } from "./provider";
import { ReviewStep } from "./review-step";
type TextKey = {
  [K in keyof ContactDetails]: ContactDetails[K] extends string ? K : never;
}[keyof ContactDetails];
export function DetailsStep({
  profileOnly = false,
  onClose,
}: { profileOnly?: boolean; onClose?: () => void } = {}) {
  const {
      draft,
      attempt,
      update,
      identityService,
      bookingService,
      reserve,
      action,
      selectionNotice,
      cancel,
    } = useBooking(),
    router = useRouter(),
    c = draft.contact;
  const [working, setChecking] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const checking = working || navigating;
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [saveState, setSaveState] = useState({
    key: "",
    saving: false,
    message: "",
  });
  const activeSave = useRef<AbortController | null>(null);
  const contactKey = JSON.stringify([draft.mode, draft.accountEmail, c]);
  const saving = saveState.key === contactKey && saveState.saving;
  const saveMessage = saveState.key === contactKey ? saveState.message : "";
  useEffect(
    () => () => {
      activeSave.current?.abort();
      activeSave.current = null;
    },
    [contactKey, identityService],
  );
  const remember = identityService.current()?.remember === true;
  async function save() {
    if (activeSave.current || !remember) return false;
    const next = contactErrors(c, draft.accountEmail);
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(first)?.focus();
      return false;
    }
    const controller = new AbortController();
    activeSave.current = controller;
    setSaveState({ key: contactKey, saving: true, message: "" });
    try {
      await identityService.saveProfile(c, controller.signal);
      if (!controller.signal.aborted)
        setSaveState({
          key: contactKey,
          saving: false,
          message: "Contact details saved for your next visit.",
        });
      return !controller.signal.aborted;
    } catch {
      if (!controller.signal.aborted)
        setSaveState({
          key: contactKey,
          saving: false,
          message:
            "Contact details could not be saved. Verify your email and try again.",
        });
      return false;
    } finally {
      if (activeSave.current === controller) {
        activeSave.current = null;
      }
    }
  }
  function change<K extends keyof ContactDetails>(
    key: K,
    value: ContactDetails[K],
  ) {
    activeSave.current?.abort();
    activeSave.current = null;
    setSaveState({ key: "", saving: false, message: "" });
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
  if (!profileOnly && (attempt?.verifying || attempt?.held))
    return <ReviewStep verifying={attempt.verifying === true} />;
  return (
    <>
      <h1 className="page-title">
        {profileOnly ? "Saved contact details" : "Your details"}
      </h1>
      <form
        id="details-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (profileOnly) {
            void save();
            return;
          }
          const next = contactErrors(
            c,
            draft.mode === "member" ? draft.accountEmail : undefined,
          );
          setErrors(next);
          const first = Object.keys(next)[0];
          if (first) document.getElementById(first)?.focus();
          else {
            if (submitting.current) return;
            submitting.current = true;
            setChecking(true);
            void (async () => {
              try {
                if (draft.mode === "member" && remember && !(await save()))
                  return;
                // Preparation validates the selection server-side before the
                // one-use holding operation; no duplicate browser day read.
                if (!mounted.current) return;
                if (bookingService.mode === "live") {
                  await reserve();
                  // BookingPage owns live held/recovery routing. Keep its
                  // existing Review mounted instead of pushing a second route.
                  return;
                }
                if (mounted.current)
                  startNavigation(() => router.push("/book/review/"));
              } finally {
                submitting.current = false;
                if (mounted.current) setChecking(false);
              }
            })();
          }
        }}
      >
        {!profileOnly && bookingService.mode === "live" && (
          <p>
            Review booking checks your selected times and places a temporary
            hold while you review and pay.
          </p>
        )}
        <p className="booking-required">* Required fields</p>
        <section className="surface">
          <h2 className="section-title">
            {profileOnly ? "Contact profile" : "Booking contact"}
          </h2>
          {draft.mode === "member" && (
            <p className="section-description">
              {remember
                ? "Your name and phone will be saved when you submit this form. Anyone using this verified email shares these saved contact details. Previous bookings stay unchanged."
                : "Review your contact details for this booking. Changes will not be saved for your next visit."}
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
            {!profileOnly &&
              select(
                "contactMethod",
                "Preferred contact method",
                CONTACT_METHODS,
              )}
            {!profileOnly &&
              field(
                "academy",
                "Academy / school / organisation",
                "text",
                false,
                120,
              )}
          </div>
        </section>
        {profileOnly && (
          <div className="profile-actions">
            {draft.mode === "member" && remember && (
              <button
                type="submit"
                className="button"
                disabled={saving || checking}
              >
                {saving ? (
                  <BrandLoading compact label="Saving contact details…" />
                ) : (
                  "Save contact details"
                )}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Back to booking options
            </button>
          </div>
        )}
        {saveMessage && <p role="status">{saveMessage}</p>}
        {!profileOnly && selectionNotice && (
          <p role="status">{selectionNotice}</p>
        )}
        {action.error && <p role="alert">{action.error}</p>}
        {!profileOnly && (
          <div className="actions">
            <button
              className="button"
              type="submit"
              disabled={saving || checking}
            >
              {checking || saving ? (
                <BrandLoading
                  compact
                  label={saving ? "Saving details…" : "Checking availability…"}
                />
              ) : (
                "Review booking"
              )}
              {!saving && !checking && <Icon name="arrow" />}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
