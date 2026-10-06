"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { blankContact } from "@/domain/contact";
import { services } from "@/services";
import { DEMO_CODE } from "@/services/demo/identity";
import type { AuthChallenge } from "@/services/contracts";
import { useBooking } from "./provider";
export function AccountStep() {
  const { update } = useBooking(),
    router = useRouter();
  const [view, setView] = useState<"choice" | "email" | "code">("choice"),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [remember, setRemember] = useState(true),
    [error, setError] = useState(""),
    [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [identity, setIdentity] = useState(() => services.identity.read());
  function proceed(verifiedEmail?: string) {
    const contact = verifiedEmail
      ? services.identity.profile(verifiedEmail) || {
          ...blankContact(),
          email: verifiedEmail,
        }
      : blankContact();
    update({
      mode: verifiedEmail ? "member" : "guest",
      accountEmail: verifiedEmail || "",
      contact,
    });
    router.push("/book/session/");
  }
  function request() {
    try {
      setChallenge(services.identity.challenge(email));
      setCode("");
      setError("");
      setView("code");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (view === "choice")
    return (
      <>
        <h1 className="page-title">Start your booking</h1>
        <div className="access-options">
          <section className="surface access-option">
            <span className="auth-mark">
              <Icon name="users" />
            </span>
            <h2>Book as a guest</h2>
            <p className="text-muted">Book without creating an account.</p>
            <button className="button wide" onClick={() => proceed()}>
              Continue as guest <Icon name="arrow" />
            </button>
          </section>
          <section className="surface access-option">
            <span className="auth-mark">
              <Icon name="mail" />
            </span>
            <h2>{identity ? "Welcome back" : "Continue with email"}</h2>
            <p className="break-words text-muted">
              {identity
                ? identity.email
                : "Verify your email to prefill your name and phone number."}
            </p>
            <button
              className="button wide"
              onClick={() =>
                identity ? proceed(identity.email) : setView("email")
              }
            >
              {identity ? "Continue signed in" : "Continue with email"}
              <Icon name="arrow" />
            </button>
            {identity && (
              <button
                className="text-link"
                onClick={() => {
                  services.identity.signOut();
                  setIdentity(null);
                }}
              >
                Use another email
              </button>
            )}
          </section>
        </div>
      </>
    );
  return (
    <>
      <h1 className="page-title">
        {view === "email" ? "Continue with email" : "Verify your email"}
      </h1>
      <p className="lead">
        {view === "email" ? (
          "Verify your email to continue with your saved booking contact details."
        ) : (
          <>
            Enter the six-digit code for{" "}
            <strong className="auth-email-address">{challenge?.email}</strong>
          </>
        )}
      </p>
      <form
        className="surface auth-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (view === "email") request();
          else {
            try {
              if (!challenge) return;
              const signedIn = services.identity.verify(
                challenge,
                code,
                remember,
              );
              proceed(signedIn.email);
            } catch (e) {
              setError((e as Error).message);
            }
          }
        }}
      >
        <span className="auth-mark">
          <Icon name="mail" />
        </span>
        {view === "email" ? (
          <>
            <label htmlFor="auth-email" className="field-label">
              Email address
            </label>
            <input
              id="auth-email"
              className="field-control"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={120}
            />
            <label className="check-label auth-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Keep me signed in on this browser for 30 days.
            </label>
          </>
        ) : (
          <>
            <label htmlFor="auth-code" className="field-label">
              Verification code
            </label>
            <input
              id="auth-code"
              className="field-control auth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
            <p className="auth-demo-code">
              Demo code <strong>{DEMO_CODE}</strong>
              <span>No email sent · Code valid for 10 minutes</span>
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="field-error auth-error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="button">
            {view === "email" ? "Continue with email" : "Verify and continue"}
            <Icon name="arrow" />
          </button>
        </div>
        <div className="auth-code-actions">
          {view === "code" && (
            <>
              <button type="button" className="text-link" onClick={request}>
                Resend code
              </button>
              <button
                type="button"
                className="text-link"
                onClick={() => setView("email")}
              >
                Change email
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          className="text-link auth-back"
          onClick={() => {
            setView("choice");
            setError("");
          }}
        >
          Back to booking options
        </button>
        {view === "email" && (
          <p className="auth-demo">
            Email sign-in preview · No email will be sent.
          </p>
        )}
      </form>
    </>
  );
}
