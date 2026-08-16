import { describe, expect, it } from "vitest";
import path from "node:path";

import { materiaDataRoot } from "@/config/environment";

describe("Materia environment", () => {
  it("reads the configured data directory", () => {
    expect(materiaDataRoot({ MATERIA_DATA_DIR: "materia-data" })).toBe("materia-data");
  });

  it("keeps the neutral data directory default", () => {
    expect(materiaDataRoot({})).toBe(path.join(process.cwd(), ".data"));
  });
});
