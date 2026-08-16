"use client";

import { useRouter } from "next/navigation";

import { UI_LOCALE_COOKIE, type UiLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/locale-context";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();

  function select(next: UiLocale) {
    if (next === locale) return;
    document.cookie = `${UI_LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }

  return <div className="locale-switcher" role="group" aria-label={locale === "es" ? "Idioma de la interfaz" : "Interface language"}>
    <button type="button" className={locale === "en" ? "is-active" : ""} aria-pressed={locale === "en"} onClick={() => select("en")}>EN</button>
    <button type="button" className={locale === "es" ? "is-active" : ""} aria-pressed={locale === "es"} onClick={() => select("es")}>ES</button>
  </div>;
}
