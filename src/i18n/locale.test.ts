import { describe, expect, it } from "vitest";

import { asContentLanguage, asUiLocale, contentLanguageName, contentLanguageToSpeech } from "@/i18n/locale";

describe("locale model", () => {
  it("defaults the interface and new content to English", () => {
    expect(asUiLocale(undefined)).toBe("en");
    expect(asContentLanguage(undefined)).toBe("en-US");
  });

  it("keeps UI labels independent from content speech language", () => {
    expect(contentLanguageName("es-ES", "en")).toBe("Spanish");
    expect(contentLanguageName("en-GB", "es")).toBe("Inglés · Reino Unido");
    expect(contentLanguageToSpeech("en-GB")).toBe("en-gb");
    expect(contentLanguageToSpeech("es-ES")).toBe("es");
  });
});
