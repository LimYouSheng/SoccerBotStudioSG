"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icon";
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      // Close while the dialog is still attached so native modal state and
      // focus are released before React removes it from the document.
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="fixed m-auto max-h-[85dvh] w-[calc(100%-32px)] max-w-xl overflow-auto rounded-2xl border border-line p-6 text-ink shadow-2xl backdrop:bg-navy/65"
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current!.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="dialog-title" id="dialog-title">
          {title}
        </h2>
        <button
          className="grid h-11 w-11 place-items-center rounded-lg border border-line"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
