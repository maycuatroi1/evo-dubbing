import { vi, type StringKey, type StringTable } from "./vi.ts";
import { en } from "./en.ts";

export type Locale = "vi" | "en";
export type { StringKey, StringTable };

const TABLES: Record<Locale, StringTable> = { vi, en };
export const DEFAULT_LOCALE: Locale = "vi";
export const FALLBACK_LOCALE: Locale = "en";

let current: Locale = DEFAULT_LOCALE;

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale in TABLES ? locale : DEFAULT_LOCALE;
}

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const template = TABLES[current][key] ?? TABLES[FALLBACK_LOCALE][key] ?? key;
  return format(template, params);
}

export function hydrate(root: ParentNode): void {
  const bind = (attribute: string, apply: (el: Element, value: string) => void): void => {
    for (const el of Array.from(root.querySelectorAll(`[${attribute}]`))) {
      const key = el.getAttribute(attribute) as StringKey | null;
      if (key) apply(el, t(key));
    }
  };
  bind("data-i18n", (el, value) => {
    el.textContent = value;
  });
  bind("data-i18n-placeholder", (el, value) => {
    el.setAttribute("placeholder", value);
  });
  bind("data-i18n-aria", (el, value) => {
    el.setAttribute("aria-label", value);
  });
  bind("data-i18n-title", (el, value) => {
    el.setAttribute("title", value);
  });
}
