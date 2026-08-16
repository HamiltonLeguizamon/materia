export const UI_LOCALE_COOKIE = "materia-locale";

export const UI_LOCALES = ["en", "es"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "en";

export const CONTENT_LANGUAGES = ["en-US", "en-GB", "es-ES"] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

export function asUiLocale(value: string | null | undefined): UiLocale {
  return value === "es" ? "es" : DEFAULT_UI_LOCALE;
}

export function asContentLanguage(value: string | null | undefined): ContentLanguage {
  const normalized = value?.toLowerCase();
  if (normalized === "es" || normalized === "es-es") return "es-ES";
  if (normalized === "en-gb") return "en-GB";
  return "en-US";
}

export function contentLanguageToSpeech(value: string | null | undefined): "es" | "en-us" | "en-gb" {
  const language = asContentLanguage(value);
  return language === "es-ES" ? "es" : language === "en-GB" ? "en-gb" : "en-us";
}

export function contentLanguageName(language: ContentLanguage, locale: UiLocale): string {
  if (language === "es-ES") return locale === "es" ? "Español" : "Spanish";
  if (language === "en-GB") return locale === "es" ? "Inglés · Reino Unido" : "English · UK";
  return locale === "es" ? "Inglés · Estados Unidos" : "English · US";
}
