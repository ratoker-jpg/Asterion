export const FLEET_ROOT_REQUEST_EVENT = 'asterion:fleet-root-request';

export function FleetRootNavigationController() {
  // Kept as a compatibility mount for existing integrations. Route changes now dispatch
  // FLEET_ROOT_REQUEST_EVENT from the typed navigation owner instead of scraping the DOM.
  return null;
}
