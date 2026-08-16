import type { Metadata, Viewport } from "next";
import "./materia.css";

import { LocaleProvider } from "@/i18n/locale-context";
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return locale === "es"
    ? { title: "Materia — Aprende a otro ritmo", description: "Convierte material formativo en lecciones estructuradas, narradas y conectadas con sus fuentes." }
    : { title: "Materia — Learn at your own pace", description: "Turn learning material into structured, narrated lessons connected to their sources." };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return <html lang={locale} data-scroll-behavior="smooth"><body><LocaleProvider locale={locale}>{children}</LocaleProvider></body></html>;
}
