"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { services } from "@/services";
import { useBooking } from "@/features/booking/provider";
export function Assistant() {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [messages, setMessages] = useState<
      Array<{ role: "bot" | "user"; text: string }>
    >([
      {
        role: "bot",
        text: "Welcome to SOCCERBOTSTUDIO. How can I help with your session?",
      },
    ]);
  const { attempt } = useBooking(),
    input = useRef<HTMLInputElement>(null),
    log = useRef<HTMLDivElement>(null),
    launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);
  function send(value: string) {
    const content = value.trim().slice(0, 500);
    if (!content) return;
    setMessages((current) => [
      ...current.slice(-28),
      { role: "user", text: content },
      {
        role: "bot",
        text: services.assistant.reply(content, attempt?.booking || null),
      },
    ]);
    setText("");
  }
  function close() {
    setOpen(false);
    launcher.current?.focus();
  }
  return (
    <div className="fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
      {open && (
        <section
          className="mb-3 flex max-h-[min(620px,80dvh)] w-[calc(100vw-32px)] max-w-sm flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl"
          aria-labelledby="assistant-title"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <header className="flex items-center justify-between bg-navy px-5 py-4 text-white">
            <div>
              <h2 id="assistant-title" className="text-lg">
                Studio assistant
              </h2>
              <span className="text-xs text-slate-300">Booking preview</span>
            </div>
            <button
              className="grid h-10 w-10 place-items-center"
              aria-label="Close assistant"
              onClick={close}
            >
              <Icon name="close" />
            </button>
          </header>
          <div
            ref={log}
            className="min-h-36 flex-1 space-y-3 overflow-auto p-4"
            role="log"
            aria-live="polite"
          >
            {messages.map((message, index) => (
              <p
                key={index}
                className={`max-w-[92%] rounded-xl px-4 py-3 text-sm ${message.role === "user" ? "ml-auto bg-action text-white" : "bg-slate-100 text-ink"}`}
              >
                {message.text}
              </p>
            ))}
          </div>
          <div className="flex gap-2 overflow-auto px-4 pb-3">
            {["Sessions & prices", "Location", "My booking"].map((label) => (
              <button
                key={label}
                className="shrink-0 rounded-full border border-line px-3 py-2 text-xs"
                onClick={() => send(label)}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <label htmlFor="assistant-input" className="sr-only">
              Ask the studio assistant
            </label>
            <input
              ref={input}
              id="assistant-input"
              className="field-control flex-1"
              maxLength={500}
              placeholder="Ask a question…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="grid w-12 shrink-0 place-items-center rounded-lg bg-action text-white"
              aria-label="Send message"
            >
              <Icon name="arrow" />
            </button>
          </form>
          <Link
            href="/enquiry/"
            onClick={close}
            className="pb-3 text-center text-xs text-action underline"
          >
            Contact the studio
          </Link>
        </section>
      )}
      <button
        ref={launcher}
        className="ml-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-navy text-white shadow-lg"
        aria-label={open ? "Hide studio assistant" : "Open studio assistant"}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={open ? "close" : "chat"} className="h-7 w-7" />
      </button>
    </div>
  );
}
