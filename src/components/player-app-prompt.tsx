"use client";
import { useState, useSyncExternalStore } from "react";
import { PLAYER_APP_URL } from "@/domain/catalog";
import { safeRead, safeWrite } from "@/services/storage";
import { Dialog } from "./dialog";
import { Icon } from "./icon";
const KEY = "soccerbot-player-app-prompt";
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}
const firstVisit = () => safeRead(KEY, true) !== true;
const serverVisit = () => false;
export function PlayerAppPrompt() {
  const unseen = useSyncExternalStore(subscribe, firstVisit, serverVisit);
  const [dismissed, setDismissed] = useState(false);
  function close() {
    safeWrite(KEY, true, true);
    setDismissed(true);
  }
  if (!unseen || dismissed) return null;
  return (
    <Dialog title="Get the SoccerBot Player App" onClose={close}>
      <p className="app-prompt-copy">
        Create your player profile and have your QR card ready before your
        session.
      </p>
      <div className="dialog-actions">
        <button className="button secondary" onClick={close}>
          Not now
        </button>
        <a
          className="button"
          href={PLAYER_APP_URL}
          target="_blank"
          rel="noreferrer"
          onClick={close}
        >
          <Icon name="download" />
          Download app
        </a>
      </div>
    </Dialog>
  );
}
