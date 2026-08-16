import { describe, expect, it } from "vitest";

import { errorResponse } from "@/server/http";

describe("HTTP error mapping", () => {
  it("maps deletion of a course-owned lesson to a conflict", async () => {
    const response = errorResponse(new Error("This lesson belongs to a course. Remove it through course editing."));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/belongs to a course/) });
  });

  it("maps missing explicit confirmation to a bad request", () => {
    expect(errorResponse(new Error("Deleting the course requires explicit confirmation.")).status).toBe(400);
  });
});
