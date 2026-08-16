import "server-only";

import { cookies } from "next/headers";

import { asUiLocale, UI_LOCALE_COOKIE, type UiLocale } from "@/i18n/locale";

export async function getRequestLocale(): Promise<UiLocale> {
  return asUiLocale((await cookies()).get(UI_LOCALE_COOKIE)?.value);
}
