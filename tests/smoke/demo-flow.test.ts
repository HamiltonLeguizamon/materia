import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root = "";

describe("demo API smoke", () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "materia-api-"));
    process.env.MATERIA_DATA_DIR = root;
    delete process.env.OPENAI_API_KEY;
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

  it("creates and retrieves a lesson through HTTP handlers without credentials", async () => {
    const [{ NETWORKING_FIXTURE, NETWORKING_FIXTURE_NAME }, routes] = await Promise.all([
      import("@/fixtures/networking"), import("@/app/api/lessons/route"),
    ]);
    const form = new FormData();
    form.set("sourceName", NETWORKING_FIXTURE_NAME); form.set("sourceText", NETWORKING_FIXTURE);
    form.set("durationMinutes", "15"); form.set("level", "intermediate");
    form.set("objective", "Comprender el recorrido de un paquete y explicarlo con claridad."); form.set("provider", "demo");
    const created = await routes.POST(new Request("http://localhost/api/lessons", { method: "POST", body: form }));
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload.lesson.plan.chapters).toHaveLength(4);
    const listed = await routes.GET();
    expect((await listed.json()).lessons).toHaveLength(1);
  });

  it("reuses an identical request without duplicating the library", async () => {
    const [{ NETWORKING_FIXTURE, NETWORKING_FIXTURE_NAME }, routes] = await Promise.all([
      import("@/fixtures/networking"), import("@/app/api/lessons/route"),
    ]);
    const form = new FormData();
    form.set("sourceName", NETWORKING_FIXTURE_NAME); form.set("sourceText", NETWORKING_FIXTURE);
    form.set("durationMinutes", "15"); form.set("level", "intermediate");
    form.set("objective", "Comprender el recorrido de un paquete y explicarlo con claridad."); form.set("provider", "demo");
    const response = await routes.POST(new Request("http://localhost/api/lessons", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect((await response.json()).reused).toBe(true);
    expect((await (await routes.GET()).json()).lessons).toHaveLength(1);
  });

  it("returns 400 for an invalid source", async () => {
    const routes = await import("@/app/api/lessons/route");
    const response = await routes.POST(new Request("http://localhost/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceName: "x.txt", sourceText: "corta", durationMinutes: 15, level: "intermediate", objective: "Objetivo válido de aprendizaje", provider: "demo" }) }));
    expect(response.status).toBe(400);
  });

  it("persistently deletes the lesson and returns 404 when reopening it", async () => {
    const listRoutes = await import("@/app/api/lessons/route");
    const lessonRoutes = await import("@/app/api/lessons/[id]/route");
    const listed = await listRoutes.GET();
    const id = (await listed.json()).lessons[0].id as string;
    const context = { params: Promise.resolve({ id }) };
    const deleted = await lessonRoutes.DELETE(new Request(`http://localhost/api/lessons/${id}`, { method: "DELETE" }), context);
    expect(deleted.status).toBe(204);
    const reopened = await lessonRoutes.GET(new Request(`http://localhost/api/lessons/${id}`), context);
    expect(reopened.status).toBe(404);
    expect((await (await listRoutes.GET()).json()).lessons).toHaveLength(0);
  });
});
