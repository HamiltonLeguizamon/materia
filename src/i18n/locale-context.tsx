"use client";

import { createContext, useContext } from "react";

import type { UiLocale } from "@/i18n/locale";

const LocaleContext = createContext<UiLocale>("en");

export function LocaleProvider({ locale, children }: { locale: UiLocale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): UiLocale {
  return useContext(LocaleContext);
}
