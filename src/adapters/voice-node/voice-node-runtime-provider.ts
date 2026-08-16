import { createHash } from "node:crypto";

import type { SpeechProfile, SpeechProvider } from "@/application/ports";
import { getVoiceNodeDefinition, voiceNodeHeaders } from "@/config/voice-nodes";
import { getMp3DurationSeconds } from "@/domain/audio";
import { addSpeechTailGuard } from "@/domain/speech";
import { prepareSpeechText, resolveSpeechProfile } from "@/domain/speech-profile";

type VoiceNodeJobState = "queued" | "running" | "completed" | "failed";

type VoiceNodeJob = {
  id: string;
  state: VoiceNodeJobState;
  error?: string | null;
};

const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 3;
// Persisted in existing profile hashes. Changing this value would invalidate
// otherwise reusable MP3 artifacts; it is data format history, not an alias.
const TRANSPORT_CACHE_ID = "materia-voice-node-v1";

export class VoiceNodeSpeechRuntimeProvider implements SpeechProvider {
  readonly profile: SpeechProfile;
  readonly profileKey: string;

  constructor(profile?: Partial<SpeechProfile>) {
    if (!profile?.nodeId) throw new Error("Select the node that will run the local engine.");
    if (!profile.provider || !["kokoro", "qwen", "chatterbox"].includes(profile.provider)) throw new Error("The node only supports local engines.");
    this.profile = resolveSpeechProfile(profile.provider, profile);
    this.profileKey = createHash("sha256").update(JSON.stringify({
      ...this.profile,
      transport: TRANSPORT_CACHE_ID,
      ending: "chapter-close-v1",
      chatterboxCadence: this.profile.provider === "chatterbox" ? "block-520-pause-200ms-v1" : null,
    })).digest("hex");
  }

  async synthesize(
    input: { lessonTitle: string; chapterTitle: string; narration: string },
    recovery?: {
      remoteJobId?: string;
      onRemoteSubmissionStarted?: () => Promise<void>;
      onRemoteAccepted?: (remoteJobId: string) => Promise<void>;
      onRemoteRejected?: () => Promise<void>;
    },
  ) {
    const definition = getVoiceNodeDefinition(this.profile.nodeId!);
    const headers = { "Content-Type": "application/json", ...voiceNodeHeaders(definition) };
    const jobTimeoutMs = positiveInteger(process.env.VOICE_NODE_TIMEOUT_MS, DEFAULT_JOB_TIMEOUT_MS);
    const requestTimeoutMs = positiveInteger(process.env.VOICE_NODE_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
    const pollIntervalMs = positiveInteger(process.env.VOICE_NODE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS);
    const deadline = Date.now() + jobTimeoutMs;
    const body = JSON.stringify({
      engine: this.profile.provider,
      input: addSpeechTailGuard(prepareSpeechText(input.narration, this.profile), true, this.profile.language),
      voice: this.profile.voice,
      language: this.profile.language,
      speed: this.profile.speed,
      response_format: "mp3",
      options: engineOptions(this.profile),
    });

    let job: VoiceNodeJob;
    if (recovery?.remoteJobId) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(recovery.remoteJobId)) throw new Error("The persisted remote job ID is invalid.");
      job = { id: recovery.remoteJobId, state: "running", error: null };
      console.info(`[speech:voice-node] resuming node=${this.profile.nodeId} engine=${this.profile.provider} voice=${this.profile.voice} job=${job.id}`);
    } else {
      await recovery?.onRemoteSubmissionStarted?.();
      let creationResponse: Response;
      try {
        creationResponse = await fetch(`${definition.baseUrl}/v1/audio/jobs`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(Math.min(requestTimeoutMs, jobTimeoutMs)),
        });
      } catch (error) {
        throw new Error(
          `Could not confirm whether ${definition.label} accepted the speech job: ${networkErrorDetail(error)}. ` +
          "Materia did not resubmit it to avoid duplicate synthesis.",
        );
      }
      if (!creationResponse.ok) {
        await recovery?.onRemoteRejected?.();
        throw await responseError(definition.label, "rejected job creation", creationResponse);
      }
      job = await readJob(creationResponse, definition.label);
      await recovery?.onRemoteAccepted?.(job.id);
      console.info(`[speech:voice-node] accepted node=${this.profile.nodeId} engine=${this.profile.provider} voice=${this.profile.voice} job=${job.id}`);
    }
    let consecutivePollErrors = 0;

    while (job.state === "queued" || job.state === "running") {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`${definition.label} is still processing audio after ${Math.round(jobTimeoutMs / 1000)} seconds (job ${job.id}). No second synthesis was created.`);
      }
      await delay(Math.min(pollIntervalMs, remainingMs));
      let statusResponse: Response;
      try {
        statusResponse = await fetch(`${definition.baseUrl}/v1/audio/jobs/${encodeURIComponent(job.id)}`, {
          headers,
          signal: AbortSignal.timeout(Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now()))),
        });
        consecutivePollErrors = 0;
      } catch (error) {
        consecutivePollErrors += 1;
        if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          throw new Error(
            `Connection to ${definition.label} was lost while processing job ${job.id}: ${networkErrorDetail(error)}. ` +
            "The remote job may still be active, and Materia did not create another one.",
          );
        }
        continue;
      }
      if (!statusResponse.ok) throw await responseError(definition.label, `could not query job ${job.id}`, statusResponse);
      job = await readJob(statusResponse, definition.label, job.id);
    }

    if (job.state === "failed") {
      throw new Error(`${definition.label} could not synthesize the audio${job.error ? `: ${job.error}` : "."}`);
    }

    const response = await fetchCompletedAudio({
      url: `${definition.baseUrl}/v1/audio/jobs/${encodeURIComponent(job.id)}/content`,
      headers,
      definitionLabel: definition.label,
      jobId: job.id,
      requestTimeoutMs,
      deadline,
    });
    if (!response.ok) {
      throw await responseError(definition.label, `could not download job ${job.id}`, response);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const durationSeconds = getMp3DurationSeconds(bytes);
    if (!durationSeconds) throw new Error(`${definition.label} returned invalid MP3 audio.`);
    const chunkCount = Number(materiaHeader(response.headers, "chunk-count") || "1");
    const timing = {
      queue: materiaHeader(response.headers, "queue-seconds"),
      worker: materiaHeader(response.headers, "worker-seconds"),
      startup: materiaHeader(response.headers, "worker-startup-seconds"),
      conversion: materiaHeader(response.headers, "conversion-seconds"),
      total: materiaHeader(response.headers, "total-seconds"),
      cold: materiaHeader(response.headers, "worker-cold"),
    };
    console.info(`[speech:voice-node] completed node=${this.profile.nodeId} engine=${this.profile.provider} voice=${this.profile.voice} job=${job.id} chunks=${chunkCount} audioSeconds=${durationSeconds?.toFixed(3) || "unknown"} queueSeconds=${timing.queue || "unknown"} workerSeconds=${timing.worker || "unknown"} startupSeconds=${timing.startup || "unknown"} conversionSeconds=${timing.conversion || "unknown"} totalSeconds=${timing.total || "unknown"} cold=${timing.cold || "unknown"}`);
    return { kind: "bytes" as const, mimeType: "audio/mpeg" as const, bytes, durationSeconds, chunkCount: Number.isInteger(chunkCount) && chunkCount > 0 ? chunkCount : 1 };
  }
}

function materiaHeader(headers: Headers, suffix: string): string | null {
  return headers.get(`x-materia-${suffix}`);
}

async function fetchCompletedAudio(input: {
  url: string;
  headers: HeadersInit;
  definitionLabel: string;
  jobId: string;
  requestTimeoutMs: number;
  deadline: number;
}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CONSECUTIVE_POLL_ERRORS; attempt += 1) {
    try {
      return await fetch(input.url, {
        headers: input.headers,
        signal: AbortSignal.timeout(Math.min(input.requestTimeoutMs, Math.max(1, input.deadline - Date.now()))),
      });
    } catch (error) {
      lastError = error;
      if (attempt < MAX_CONSECUTIVE_POLL_ERRORS) await delay(100);
    }
  }
  throw new Error(`Could not download completed audio from ${input.definitionLabel} (job ${input.jobId}): ${networkErrorDetail(lastError)}.`);
}

async function readJob(response: Response, definitionLabel: string, expectedId?: string): Promise<VoiceNodeJob> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${definitionLabel} returned an invalid job status payload.`);
  }
  const candidate = typeof payload === "object" && payload !== null && "job" in payload
    ? (payload as { job?: unknown }).job
    : null;
  if (typeof candidate !== "object" || candidate === null) throw new Error(`${definitionLabel} returned an invalid job.`);
  const job = candidate as Record<string, unknown>;
  if (typeof job.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(job.id)) throw new Error(`${definitionLabel} returned an invalid job ID.`);
  if (expectedId && job.id !== expectedId) throw new Error(`${definitionLabel} returned the status of a different job.`);
  if (!isJobState(job.state)) throw new Error(`${definitionLabel} returned an unknown job state.`);
  return { id: job.id, state: job.state, error: typeof job.error === "string" ? job.error.slice(0, 300) : null };
}

function isJobState(value: unknown): value is VoiceNodeJobState {
  return value === "queued" || value === "running" || value === "completed" || value === "failed";
}

async function responseError(label: string, action: string, response: Response): Promise<Error> {
  const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
  return new Error(`${label} ${action} (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
}

function networkErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return "network error";
  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  const code = typeof cause === "object" && cause !== null && "code" in cause && typeof (cause as { code?: unknown }).code === "string"
    ? (cause as { code: string }).code
    : null;
  return code ? `${error.message} (${code})` : error.message;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function engineOptions(profile: SpeechProfile): Record<string, number> {
  if (profile.provider === "qwen") return { temperature: 0.7, topP: 0.95, topK: 50, repetitionPenalty: 1.05, maxNewTokens: 2400, maxChars: 2400, seed: 20260813 };
  if (profile.provider === "chatterbox") return { exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.8, repetitionPenalty: 1.2, minP: 0.05, topP: 1, maxChars: 520 };
  return {};
}
