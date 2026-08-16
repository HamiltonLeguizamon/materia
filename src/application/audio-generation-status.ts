import type { SpeechProviderId } from "@/application/ports";

export type AudioActivityPhase = "queued" | "synthesizing" | "finalizing" | "completed" | "failed";

export type AudioActivity = {
  id: string;
  scope: "chapter" | "lesson" | "course";
  state: "running" | "completed" | "failed";
  phase: AudioActivityPhase;
  provider: SpeechProviderId;
  nodeId: string | null;
  lessonId: string | null;
  chapterId: string | null;
  completedChapters: number;
  totalChapters: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
};

export type AudioActivitySnapshot = {
  state: "idle" | "running" | "completed" | "failed";
  active: AudioActivity[];
  latest: AudioActivity | null;
};

export class AudioActivityRegistry {
  private readonly activities = new Map<string, AudioActivity>();

  begin(activity: Omit<AudioActivity, "state" | "startedAt" | "updatedAt" | "completedAt" | "error">): AudioActivity {
    const now = new Date().toISOString();
    const value: AudioActivity = { ...activity, state: "running", startedAt: now, updatedAt: now, completedAt: null, error: null };
    this.activities.set(value.id, value);
    this.prune();
    return { ...value };
  }

  update(id: string, update: Partial<Omit<AudioActivity, "id" | "startedAt">>): AudioActivity | null {
    const current = this.activities.get(id);
    if (!current) return null;
    const value = { ...current, ...update, updatedAt: new Date().toISOString() };
    this.activities.set(id, value);
    return { ...value };
  }

  complete(id: string, completedChapters: number): AudioActivity | null {
    const now = new Date().toISOString();
    return this.update(id, { state: "completed", phase: "completed", completedChapters, completedAt: now, error: null });
  }

  fail(id: string, error: string): AudioActivity | null {
    const now = new Date().toISOString();
    return this.update(id, { state: "failed", phase: "failed", completedAt: now, error: error.slice(0, 300) });
  }

  snapshot(): AudioActivitySnapshot {
    const ordered = [...this.activities.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const active = ordered.filter((item) => item.state === "running").map((item) => ({ ...item }));
    const latest = ordered[0] ? { ...ordered[0] } : null;
    return { state: active.length ? "running" : latest?.state || "idle", active, latest };
  }

  private prune(): void {
    const ordered = [...this.activities.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const activity of ordered.slice(20)) this.activities.delete(activity.id);
  }
}

export function operationalActivity(text: {
  requestId: string | null;
  state: "idle" | "running" | "completed" | "failed";
  phase: string;
  provider: "demo" | "openai" | null;
  lessonId: string | null;
  updatedAt: string;
  error: string | null;
}, audio: AudioActivitySnapshot) {
  const audioCurrent = audio.active[0];
  if (audioCurrent) {
    return { kind: "audio" as const, ...audioCurrent };
  }
  if (text.state !== "running") return null;
  return {
    kind: "text" as const,
    id: text.requestId,
    scope: "lesson" as const,
    state: text.state,
    phase: text.phase,
    provider: text.provider,
    nodeId: null,
    lessonId: text.lessonId,
    chapterId: null,
    completedChapters: null,
    totalChapters: null,
    updatedAt: text.updatedAt,
    error: text.error,
  };
}
