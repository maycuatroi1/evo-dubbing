/**
 * The server we deploy, run and support. Baked in so a fresh install can read the shared
 * library and buy a managed plan with nothing to configure.
 *
 * Any other value is an escape hatch for someone running their own build of `server/`, not a
 * normal setting: the options page hides it behind a disclosure, gates it behind an explicit
 * acknowledgement, and offers a one-click way back. See ../../options/options.ts.
 */
export const DEFAULT_SERVER_URL = "https://nghe.omelet.tech";

/**
 * Bumped when a stored settings blob needs rewriting on read. Version 1 introduced
 * DEFAULT_SERVER_URL; blobs written before it stored "" for both server fields, and an
 * explicit "" wins over a default in a spread. See ./storage.ts migrateSettings.
 */
export const SETTINGS_VERSION = 1;

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isDefaultServer(url: string): boolean {
  return normalizeBaseUrl(url) === DEFAULT_SERVER_URL;
}

/** For display only: "https://nghe.omelet.tech/" -> "nghe.omelet.tech". */
export function serverHost(url: string): string {
  const base = normalizeBaseUrl(url);
  if (!base) return "";
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}
