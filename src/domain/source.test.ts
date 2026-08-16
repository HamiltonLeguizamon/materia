import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, safeDisplayName, validateSourceFile } from "@/domain/source";

describe("source validation", () => {
  it("accepts only text and Markdown within the limit", () => {
    expect(() => validateSourceFile("leccion.md", 1200)).not.toThrow();
    expect(() => validateSourceFile("leccion.pdf", 1200)).toThrow(/.txt y .md/);
    expect(() => validateSourceFile("leccion.txt", MAX_FILE_BYTES + 1)).toThrow(/2 MB/);
  });

  it("removes path separators from the display name", () => {
    expect(safeDisplayName("../../curso/redes.md")).toBe(".. .. curso redes.md");
  });
});
