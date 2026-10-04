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
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <section className="surface flex flex-col items-start gap-4">
            <Icon name="users" className="h-9 w-9 text-action" />
            <h2 className="text-2xl">Book as a guest</h2>
            <p className="mb-auto text-muted">
              Book without creating an account.
            </p>
            <button className="button mt-3 w-full" onClick={() => proceed()}>
              Continue as guest <Icon name="arrow" />
            </button>
          </section>
          <section className="surface flex flex-col items-start gap-4">
            <Icon name="mail" className="h-9 w-9 text-action" />
            <h2 className="text-2xl">
              {identity ? "Welcome back" : "Continue with email"}
            </h2>
            <p className="mb-auto break-all text-muted">
              {identity
                ? identity.email
                : "Verify your email to prefill your name and phone number."}
            </p>
            <button
              className="button mt-3 w-full"
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
      <form
        className="surface mt-7 max-w-xl"
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
            <label className="mt-5 flex gap-3 text-sm">
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
            <p className="mb-5 break-all">
              Enter the six-digit code for <strong>{challenge?.email}</strong>.
            </p>
            <label htmlFor="auth-code" className="field-label">
              Verification code
            </label>
            <input
              id="auth-code"
              className="field-control tracking-[.3em]"
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
            <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm">
              Demo code <strong>{DEMO_CODE}</strong>
              <br />
              <span className="text-xs text-muted">
                No email sent · Code valid for 10 minutes
              </span>
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <button type="submit" className="button mt-6">
          {view === "email" ? "Continue with email" : "Verify and continue"}
          <Icon name="arrow" />
        </button>
        <div className="mt-4 flex flex-wrap gap-5">
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
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setView("choice");
              setError("");
            }}
          >
            Back to booking options
          </button>
        </div>
        {view === "email" && (
          <p className="mt-4 text-xs text-muted">
            Email sign-in preview · No email will be sent.
          </p>
        )}
      </form>
    </>
  );
}
