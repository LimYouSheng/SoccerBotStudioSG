// Experimental provider session initialization, not an authorization signal.
// The frame is stable across booking steps. Never preload a checkout capability
// or inspect/copy provider cookies; embedding/partitioning may prevent this from
// initializing the top-level checkout session. Only a real browser can prove it.
export function NativeSessionInit({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <iframe
      title="Secure checkout initialization"
      src="https://soccerbotstudiosg.simplybook.asia/v2/"
      hidden
      aria-hidden="true"
      tabIndex={-1}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
