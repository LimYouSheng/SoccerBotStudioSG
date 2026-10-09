"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { blankContact } from "@/domain/contact";
import { DEMO_CODE } from "@/services/demo/identity";
import type { CustomerChallenge } from "@/services/contracts";
import { useBooking } from "./provider";
import { EmailBotProof } from "./email-bot-proof";
export function AccountStep() {
  const { update, identityService } = useBooking(),
    router = useRouter();
  const [view, setView] = useState<"choice" | "email" | "code">("choice"),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [remember, setRemember] = useState(true),
    [error, setError] = useState(""),
    [challenge, setChallenge] = useState<CustomerChallenge | null>(null);
  const [identity, setIdentity] = useState(() => identityService.current());
  const [busy, setBusy] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [botGeneration, setBotGeneration] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void identityService
      .refresh(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setIdentity(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setIdentity(null);
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [identityService]);
  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setBotToken("");
    setBotGeneration((value) => value + 1);
  }
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      await work(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  async function proceed(signal: AbortSignal, verifiedEmail?: string) {
    if (!verifiedEmail) await identityService.guest(signal);
    const contact = verifiedEmail
      ? (await identityService.profile(verifiedEmail, signal)) || {
          ...blankContact(),
          email: verifiedEmail,
        }
      : blankContact();
    if (signal.aborted) return;
    update({
      mode: verifiedEmail ? "member" : "guest",
      accountEmail: verifiedEmail || "",
      contact,
    });
    router.push("/book/session/");
  }
  function request() {
    void perform(async (signal) => {
      let next: CustomerChallenge;
      try {
        next = await identityService.challenge(email, signal, botToken);
      } finally {
        setBotToken("");
        setBotGeneration((value) => value + 1);
      }
      if (signal.aborted) return;
      setChallenge(next);
      setCode("");
      setView("code");
    });
  }
  if (view === "choice")
    return (
      <>
        <h1 className="page-title">Start your booking</h1>
        {error && <p role="alert">{error}</p>}
        <div className="access-options">
          <section className="surface access-option">
            <span className="auth-mark">
              <Icon name="users" />
            </span>
            <h2>Book as a guest</h2>
            <p className="text-muted">Book without creating an account.</p>
            <button
              className="button wide"
              disabled={busy}
              onClick={() => void perform((signal) => proceed(signal))}
            >
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
                identity
                  ? void perform(async (signal) => {
                      const current = await identityService.refresh(signal);
                      if (!current) throw new Error("Verify your email again.");
                      await proceed(signal, current.email);
                    })
                  : setView("email")
              }
            >
              {identity ? "Continue signed in" : "Continue with email"}
              <Icon name="arrow" />
            </button>
            {identity && (
              <button
                className="text-link"
                onClick={() => {
                  void perform(async (signal) => {
                    await identityService.signOut(signal);
                    if (!signal.aborted) setIdentity(null);
                  });
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
          else
            void perform(async (signal) => {
              if (!challenge) return;
              const signedIn = await identityService.verify(
                challenge,
                code,
                remember,
                signal,
              );
              await proceed(signal, signedIn.email);
            });
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
            {identityService.mode === "demo" && (
              <label className="check-label auth-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Keep me signed in on this browser for 30 days.
              </label>
            )}
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
            {identityService.mode === "demo" && (
              <p className="auth-demo-code">
                Demo code <strong>{DEMO_CODE}</strong>
                <span>No email sent · Code valid for 10 minutes</span>
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="field-error auth-error">
            {error}
          </p>
        )}
        {identityService.mode === "live" && (
          <EmailBotProof key={botGeneration} onToken={setBotToken} />
        )}
        <div className="actions">
          <button type="submit" className="button" disabled={busy}>
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
                onClick={() => {
                  cancel();
                  setView("email");
                }}
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
            cancel();
            setView("choice");
            setError("");
          }}
        >
          Back to booking options
        </button>
        {view === "email" && identityService.mode === "demo" && (
          <p className="auth-demo">
            Email sign-in preview · No email will be sent.
          </p>
        )}
      </form>
    </>
  );
}
