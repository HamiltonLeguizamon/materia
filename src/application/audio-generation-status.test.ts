import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioActivityRegistry, operationalActivity } from "@/application/audio-generation-status";

afterEach(() => vi.useRealTimers());

describe("audio activity registry", () => {
  it("publishes safe progress and makes active audio the operational activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T20:00:00.000Z"));
    const registry = new AudioActivityRegistry();
    registry.begin({ id: "audio-job", scope: "lesson", phase: "queued", provider: "qwen", nodeId: "test-node", lessonId: "lesson-1", chapterId: null, completedChapters: 0, totalChapters: 3 });
    registry.update("audio-job", { phase: "synthesizing", chapterId: "chapter-2", completedChapters: 1 });

    const audio = registry.snapshot();
    const activity = operationalActivity({ requestId: "old-text", state: "completed", phase: "completed", provider: "openai", lessonId: "lesson-old", updatedAt: "2026-08-12T10:00:00.000Z", error: null }, audio);

    expect(audio).toMatchObject({ state: "running", active: [{ id: "audio-job", provider: "qwen", nodeId: "test-node", chapterId: "chapter-2", completedChapters: 1, totalChapters: 3 }] });
    expect(activity).toMatchObject({ kind: "audio", id: "audio-job", state: "running", provider: "qwen", nodeId: "test-node" });
  });

  it("labels lesson creation as text activity instead of a generic provider state", () => {
    const activity = operationalActivity({ requestId: "text-job", state: "running", phase: "planning", provider: "openai", lessonId: null, updatedAt: "2026-08-14T20:00:00.000Z", error: null }, { state: "idle", active: [], latest: null });

    expect(activity).toMatchObject({ kind: "text", id: "text-job", state: "running", phase: "planning", provider: "openai" });
  });

  it("keeps the latest completed activity without reporting it as active", () => {
    const registry = new AudioActivityRegistry();
    registry.begin({ id: "audio-job", scope: "chapter", phase: "queued", provider: "kokoro", nodeId: "mac", lessonId: "lesson-1", chapterId: "chapter-1", completedChapters: 0, totalChapters: 1 });
    registry.complete("audio-job", 1);

    const snapshot = registry.snapshot();
    expect(snapshot).toMatchObject({ state: "completed", active: [], latest: { id: "audio-job", phase: "completed", completedChapters: 1 } });
    expect(operationalActivity({ requestId: "old-text", state: "completed", phase: "completed", provider: "openai", lessonId: "lesson-old", updatedAt: "2026-08-12T10:00:00.000Z", error: null }, snapshot)).toBeNull();
  });
});
