const viteEnv: Record<string, string | undefined> =
  typeof import.meta !== "undefined" && "env" in import.meta
    ? (import.meta.env as unknown as Record<string, string | undefined>)
    : {};

export const SUPABASE_URL = "https://lrypactuodbguwncoomc.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY = viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const EXTENSION_ITEM_ID = "ligchebgiheiildjcnndjoalkpiamgko";

export const GOOGLE_OAUTH_CLIENT_ID =
  "401458936175-sofsattbm8g3t3qcjjgb1c333eo97k9h.apps.googleusercontent.com";

/** Server addressing is not managed-specific: the share routes use the same base. */
export { DEFAULT_SERVER_URL, normalizeBaseUrl } from "../config.ts";
