import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GET, HEAD } from "@/app/api/lessons/[id]/audio/[chapterId]/route";

const roots: string[] = [];
const id = "123e4567-e89b-42d3-a456-426614174000";
const context = { params: Promise.resolve({ id, chapterId: "chapter-1" }) };

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "materia-audio-"));
  roots.push(root);
  const directory = path.join(root, "audio", id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "chapter-1.mp3"), Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  process.env.MATERIA_DATA_DIR = root;
  return root;
}

afterEach(async () => {
  delete process.env.MATERIA_DATA_DIR;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe("audio route", () => {
  it("exposes size and range support", async () => {
    await fixture();
    const response = await HEAD(new Request("http://localhost/audio", { method: "HEAD" }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("10");
  });

  it("returns a playable partial range", async () => {
    await fixture();
    const response = await GET(new Request("http://localhost/audio", { headers: { Range: "bytes=2-5" } }), context);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([2, 3, 4, 5]);
  });

  it("returns a Safari-compatible suffix range", async () => {
    await fixture();
    const response = await GET(new Request("http://localhost/audio", { headers: { Range: "bytes=-3" } }), context);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it("rejects ranges outside the file", async () => {
    await fixture();
    const response = await GET(new Request("http://localhost/audio", { headers: { Range: "bytes=20-30" } }), context);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });
});
