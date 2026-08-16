import type { SpeechProviderId } from "@/application/ports";

type AudioEstimateMessageInput = {
  provider: SpeechProviderId;
  providerName: string;
  locale: "en" | "es";
  batch?: boolean;
};

export function audioEstimateMessage({ provider, providerName, locale, batch = false }: AudioEstimateMessageInput): string {
  const spanish = locale === "es";

  if (provider === "openai") {
    if (batch) return spanish
      ? "OpenAI puede generar coste. La cola procesa un capítulo cada vez y no cambia automáticamente de proveedor."
      : "OpenAI may incur a cost. The queue processes one chapter at a time and does not automatically switch providers.";
    return spanish
      ? "Materia puede estimar la longitud y la duración, pero no muestra un precio sin una tarifa verificada para el modelo configurado."
      : "Materia can estimate length and duration, but does not claim a price without a verified rate for the configured model.";
  }

  if (provider === "demo") return spanish
    ? "El modo demo usa la voz del navegador y no realiza llamadas de pago."
    : "Demo mode uses the browser voice and makes no paid calls.";

  if (batch) return spanish
    ? `La cola usa ${providerName} en tu equipo, sin llamadas a OpenAI, y procesa los capítulos en orden.`
    : `The queue uses ${providerName} on your device without calling OpenAI and processes chapters in order.`;

  return spanish
    ? `${providerName} se ejecuta en tu equipo: no consume la API de OpenAI; solo usa recursos locales y la red privada configurada.`
    : `${providerName} runs on your device: it does not use the OpenAI API; it only uses local resources and your configured private network.`;
}
