// Owner-supplied token-free historical native destination shape, 9 October 2026.
// Validating this initial URL does not attest downstream redirects or sandbox mode.
export function isNativeCheckoutUrl(value: string): boolean {
  return /^https:\/\/soccerbotstudiosg\.simplybook\.asia\/v2\/client\/pay-later\/id\/[A-Za-z0-9_-]+\/hash\/[A-Za-z0-9_-]+$/.test(
    value,
  );
}
