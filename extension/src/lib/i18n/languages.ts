export interface TargetLanguage {
  code: string;
  label: string;
}

export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "vi", label: "Tiếng Việt" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
  { code: "th", label: "ไทย" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "hi", label: "हिन्दी" },
  { code: "ar", label: "العربية" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" }
];

export function languageLabel(code: string): string {
  return TARGET_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function targetLanguageOptions(selected: string): TargetLanguage[] {
  const known = TARGET_LANGUAGES.some((l) => l.code === selected);
  if (known || !selected) return TARGET_LANGUAGES;
  return [{ code: selected, label: selected }, ...TARGET_LANGUAGES];
}
