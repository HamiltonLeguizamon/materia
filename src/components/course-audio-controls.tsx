"use client";

import { useEffect, useState } from "react";

import { abortableDelay, isAbortError, useAbortableTasks } from "@/components/use-abortable-tasks";
import { audioEstimateMessage } from "@/components/audio-estimate-message";
import type { SpeechProfile, SpeechProviderId } from "@/application/ports";
import type { PublicVoiceNode } from "@/domain/voice-node";
import { contentLanguageToSpeech } from "@/i18n/locale";
import { useLocale } from "@/i18n/locale-context";

type BatchEstimate = {
  lessons: number;
  chapters: number;
  estimatedMinutes: number;
  characters: number;
  costMessage: string;
};

type BatchJob = {
  id: string;
  state: "queued" | "running" | "completed" | "failed" | "interrupted";
  completedChapters: number;
  totalChapters: number;
  error: string | null;
};

export function CourseAudioControls({ courseId, revision, openAiAvailable, contentLanguage }: { courseId: string; revision: number; openAiAvailable: boolean; contentLanguage: string }) {
  const locale = useLocale();
  const spanish = locale === "es";
  const [nodes, setNodes] = useState<PublicVoiceNode[]>([]);
  const [origin, setOrigin] = useState("openai");
  const [provider, setProvider] = useState<SpeechProviderId>("openai");
  const [voice, setVoice] = useState("coral");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<BatchEstimate | null>(null);
  const { beginTask, endTask } = useAbortableTasks();

  const node = nodes.find((item) => item.node.id === origin && item.online) || null;
  const engine = node?.engines.find((item) => item.id === provider) || null;
  const voiceName = engine?.voices.find((item) => item.id === voice)?.label || voice;
  const providerName = node ? `${node.node.label} · ${engine?.label || provider}` : "OpenAI TTS";
  const profile: SpeechProfile = {
    provider,
    nodeId: node?.node.id || null,
    voice,
    language: contentLanguageToSpeech(contentLanguage),
    speed: provider === "chatterbox" ? 0.9 : 1,
    style: provider === "qwen" || provider === "openai" ? "serious" : "neutral",
    pronunciation: "literal",
  };

  useEffect(() => {
    const controller = beginTask();
    void fetch("/api/voice-nodes", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.json() as Promise<{ nodes: PublicVoiceNode[] }>)
      .then(({ nodes: discovered }) => {
        setNodes(discovered);
        const preferred = discovered.find((item) => item.online && item.engines.some((candidate) => candidate.id === "qwen"))
          || discovered.find((item) => item.online);
        const selected = preferred?.engines.find((item) => item.id === "qwen") || preferred?.engines[0];
        if (preferred && selected) {
          setOrigin(preferred.node.id);
          setProvider(selected.id);
          setVoice(selected.voices[0].id);
        }
      })
      .catch((error) => { if (!isAbortError(error)) setNodes([]); })
      .finally(() => endTask(controller));
    return () => { controller.abort(); endTask(controller); };
  }, [beginTask, endTask]);

  function resetEstimate() {
    setEstimate(null);
    setMessage(null);
  }

  function chooseOrigin(next: string) {
    resetEstimate();
    setOrigin(next);
    if (next === "openai") {
      setProvider("openai");
      setVoice("coral");
      return;
    }
    const selectedNode = nodes.find((item) => item.node.id === next);
    const selected = selectedNode?.engines.find((item) => item.id === "qwen") || selectedNode?.engines[0];
    if (selected) {
      setProvider(selected.id);
      setVoice(selected.voices[0].id);
    }
  }

  function chooseEngine(next: SpeechProviderId) {
    resetEstimate();
    setProvider(next);
    const selected = node?.engines.find((item) => item.id === next);
    if (selected) setVoice(selected.voices[0].id);
  }

  async function getJobAfterDelay(id: string, signal: AbortSignal): Promise<BatchJob> {
    await abortableDelay(2000, signal);
    const response = await fetch(`/api/audio-batch-jobs/${id}`, { cache: "no-store", signal });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || (spanish ? "No se pudo consultar la cola." : "The queue could not be checked."));
    return value.job as BatchJob;
  }

  async function prepare() {
    const controller = beginTask();
    setBusy(true);
    setEstimate(null);
    setMessage(spanish ? "Calculando únicamente el audio pendiente…" : "Calculating pending audio only…");
    try {
      const response = await fetch(`/api/courses/${courseId}/audio/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "estimate", provider, profile }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (spanish ? "No se pudo estimar el curso." : "The course could not be estimated."));
      const nextEstimate = payload.estimate as BatchEstimate;
      if (!nextEstimate.chapters) {
        setMessage(spanish ? "Todo el curso ya dispone de audio." : "The entire course already has audio.");
        return;
      }
      setEstimate(nextEstimate);
      setMessage(spanish ? "Estimación preparada. Confirma abajo para iniciar la cola." : "Estimate ready. Confirm below to start the queue.");
    } catch (error) {
      if (!isAbortError(error)) setMessage(error instanceof Error ? error.message : spanish ? "No se pudo estimar el curso." : "The course could not be estimated.");
    } finally {
      endTask(controller);
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function startConfirmed() {
    if (!estimate) return;
    const controller = beginTask();
    setBusy(true);
    setMessage(spanish ? "Iniciando la cola secuencial…" : "Starting the sequential queue…");
    try {
      const response = await fetch(`/api/courses/${courseId}/audio/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", expectedRevision: revision, confirmed: true, provider, profile }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (spanish ? "No se pudo iniciar la cola." : "The queue could not be started."));
      setEstimate(null);
      const firstJob = payload.job as BatchJob;
      for (let attempt = 0; attempt < 1800; attempt += 1) {
        const current = attempt === 0 ? firstJob : await getJobAfterDelay(firstJob.id, controller.signal);
        setMessage(spanish ? `Generando en orden: ${current.completedChapters}/${current.totalChapters} capítulos preparados. Puedes comenzar la primera lección.` : `Generating in order: ${current.completedChapters}/${current.totalChapters} chapters ready. You can start the first lesson.`);
        if (current.state === "failed") throw new Error(current.error || (spanish ? "La cola ha fallado." : "The queue failed."));
        if (current.state === "interrupted") throw new Error(current.error || (spanish ? "La cola se interrumpió al reiniciar Materia." : "The queue was interrupted when Materia restarted."));
        if (current.state === "completed") {
          setMessage(spanish ? `Curso preparado: ${current.completedChapters} capítulos con audio.` : `Course ready: ${current.completedChapters} chapters have audio.`);
          return;
        }
      }
      setMessage(spanish ? "La cola continúa en segundo plano." : "The queue continues in the background.");
    } catch (error) {
      if (!isAbortError(error)) setMessage(error instanceof Error ? error.message : spanish ? "No se pudo generar el curso." : "The course could not be generated.");
    } finally {
      endTask(controller);
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="course-audio-controls">
    <div>
      <strong>{spanish ? "Preparar el curso en audio" : "Prepare course audio"}</strong>
      <small>{spanish ? "Genera únicamente capítulos pendientes, uno detrás de otro. Puedes comenzar a estudiar mientras continúa." : "Generate only pending chapters, one at a time. You can begin studying while the queue continues."}</small>
    </div>
    <div className="course-audio-selectors">
      <label>{spanish ? "Origen" : "Source"}<select value={origin} onChange={(event) => chooseOrigin(event.target.value)} disabled={busy || Boolean(estimate)}>
        {nodes.map((item) => <option key={item.node.id} value={item.node.id} disabled={!item.online}>{item.node.label}{item.online ? "" : spanish ? " · sin conexión" : " · offline"}</option>)}
        {openAiAvailable ? <option value="openai">OpenAI · {spanish ? "nube y coste" : "cloud and paid"}</option> : null}
      </select></label>
      <label>{spanish ? "Motor" : "Engine"}<select value={provider} onChange={(event) => chooseEngine(event.target.value as SpeechProviderId)} disabled={busy || Boolean(estimate) || !node}>
        {node ? node.engines.map((item) => <option key={item.id} value={item.id}>{item.label}</option>) : <option value="openai">OpenAI TTS</option>}
      </select></label>
      <label>{spanish ? "Voz" : "Voice"}<select value={voice} onChange={(event) => { resetEstimate(); setVoice(event.target.value); }} disabled={busy || Boolean(estimate)}>
        {engine ? engine.voices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>) : <option value="coral">Coral</option>}
      </select></label>
    </div>
    {!estimate ? <button type="button" onClick={prepare} disabled={busy}>{spanish ? busy ? "Calculando…" : "Generar todo el audio pendiente" : busy ? "Calculating…" : "Generate all pending audio"}</button> : <div className="audio-batch-confirmation" role="group" aria-label={spanish ? "Confirmar generación del curso" : "Confirm course generation"}>
      <strong>{providerName}</strong>
      <span>{spanish ? "Voz" : "Voice"}: {voiceName}</span>
      <span>{estimate.lessons} {spanish ? "lecciones" : "lessons"} · {estimate.chapters} {spanish ? "capítulos" : "chapters"} · ≈ {estimate.estimatedMinutes} min</span>
      <span>{estimate.characters.toLocaleString(locale)} {spanish ? "caracteres" : "characters"}</span>
      <small>{audioEstimateMessage({ provider, providerName, locale, batch: true })}</small>
      <div>
        <button type="button" onClick={startConfirmed} disabled={busy}>{spanish ? busy ? "Iniciando…" : "Confirmar e iniciar" : busy ? "Starting…" : "Confirm and start"}</button>
        <button type="button" className="button-secondary" onClick={() => { setEstimate(null); setMessage(spanish ? "Generación cancelada; no se creó ninguna cola." : "Generation cancelled; no queue was created."); }} disabled={busy}>{spanish ? "Cancelar" : "Cancel"}</button>
      </div>
    </div>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
