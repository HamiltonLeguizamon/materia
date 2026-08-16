"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { BackIcon, CheckIcon, PauseIcon, PlayIcon, WaveMark } from "@/components/icons";
import { audioEstimateMessage } from "@/components/audio-estimate-message";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Waveform } from "@/components/waveform";
import { abortableDelay, isAbortError, useAbortableTasks } from "@/components/use-abortable-tasks";
import type { SpeechLanguage, SpeechProfile, SpeechProviderId, SpeechPronunciation, SpeechStyle } from "@/application/ports";
import type { CourseSource } from "@/domain/course";
import { KOKORO_SPEECH_VOICES, OPENAI_SPEECH_VOICES, QWEN_SPEECH_VOICES, SPEECH_VOICE_LABELS } from "@/domain/speech-options";
import { audioMatchesCurrentNarration, blockListeningTransition, chapterListeningIntroduction, chapterNarration, chapterReferenceIds, lessonAudioMinutes, TEACHING_BLOCK_LABELS, type LearningArtifact, type Lesson } from "@/domain/teaching";
import type { PublicVoiceNode, VoiceNodeEngine } from "@/domain/voice-node";
import { contentLanguageToSpeech } from "@/i18n/locale";
import { useLocale } from "@/i18n/locale-context";

const SPANISH_TEACHING_BLOCK_LABELS: Record<keyof typeof TEACHING_BLOCK_LABELS, string> = {
  explanation: "Explicación",
  example: "Ejemplo",
  scenario: "Escenario",
  procedure: "Procedimiento",
  comparison: "Comparación",
  pitfall: "Error frecuente",
  reflection: "Para pensar",
  summary: "Síntesis",
};

type StudyTab = "transcript" | "references" | "check";
const PLAYBACK_RATES = [0.9, 1, 1.25, 1.5, 2] as const;
type AudioProgress = { phase: "preparing" | "queued" | "synthesizing" | "finalizing"; scope: "chapter" | "lesson" | "course"; completed: number; total: number; chapterId: string | null; provider: SpeechProviderId; nodeId: string | null };
type OperationalAudioActivity = { id: string; scope: "chapter" | "lesson" | "course"; state: "running" | "completed" | "failed"; phase: "queued" | "synthesizing" | "finalizing" | "completed" | "failed"; provider: SpeechProviderId; nodeId: string | null; lessonId: string | null; chapterId: string | null; completedChapters: number; totalChapters: number };

function LearningArtifactCard({ artifact }: { artifact: LearningArtifact }) {
  const spanish = useLocale() === "es";
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const diagramNodeLabels = artifact.kind === "diagram" ? new Map(artifact.nodes.map((node) => [node.id, node.label])) : null;
  const copyCode = async () => {
    if (artifact.kind !== "code") return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(artifact.code);
      else {
        const field = document.createElement("textarea");
        field.value = artifact.code; field.style.position = "fixed"; field.style.opacity = "0";
        document.body.appendChild(field); field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("The browser did not allow copying the code.");
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    window.setTimeout(() => setCopyStatus("idle"), 1800);
  };
  return <figure className={`learning-artifact learning-artifact-${artifact.kind}`} aria-labelledby={`${artifact.id}-title`}>
    <figcaption><span>{artifact.kind === "code" ? spanish ? "Código" : "Code" : artifact.kind === "diagram" ? spanish ? "Diagrama" : "Diagram" : spanish ? "Recurso visual" : "Visual resource"}</span><strong id={`${artifact.id}-title`}>{artifact.title}</strong><p>{artifact.caption}</p></figcaption>
    {artifact.kind === "code" ? <div className="artifact-code"><div><span>{artifact.filename || artifact.language}</span><button type="button" onClick={copyCode}>{copyStatus === "copied" ? spanish ? "Copiado" : "Copied" : copyStatus === "failed" ? spanish ? "No disponible" : "Unavailable" : spanish ? "Copiar" : "Copy"}</button></div><pre tabIndex={0}><code className={`language-${artifact.language}`}>{artifact.code}</code></pre><span className="sr-only" role="status" aria-live="polite">{copyStatus === "copied" ? spanish ? "Código copiado al portapapeles" : "Code copied to clipboard" : copyStatus === "failed" ? spanish ? "El navegador no permitió copiar el código" : "The browser did not allow copying the code" : ""}</span></div> : null}
    {artifact.kind === "diagram" ? <div className={`artifact-diagram artifact-diagram-${artifact.direction}`}><ol>{artifact.nodes.map((node) => <li key={node.id}><div><strong>{node.label}</strong>{node.detail ? <small>{node.detail}</small> : null}</div></li>)}</ol><div className="artifact-relations"><span>{spanish ? "Relaciones" : "Relationships"}</span><ul>{artifact.edges.map((edge, index) => <li key={`${edge.from}-${edge.to}-${index}`}><strong>{diagramNodeLabels?.get(edge.from)}</strong><span aria-hidden="true">→</span><strong>{diagramNodeLabels?.get(edge.to)}</strong>{edge.label ? <small>{edge.label}</small> : null}</li>)}</ul></div></div> : null}
    {artifact.kind === "image-reference" ? <a className="artifact-image-reference" href={artifact.url} target="_blank" rel="noreferrer"><span aria-hidden="true">↗</span><div><strong>{artifact.alt}</strong><small>{artifact.attribution}</small></div></a> : null}
    <small className="artifact-provenance">{artifact.provenance === "quoted" ? spanish ? "Fuente original" : "Original source" : artifact.provenance === "adapted" ? spanish ? "Adaptado de las fuentes" : "Adapted from sources" : spanish ? "Elaboración didáctica" : "Instructional adaptation"}</small>
  </figure>;
}

function lessonDurationLabel(lesson: Lesson, durations: Record<string, number>, spanish: boolean): string {
  const knownLesson = { ...lesson, audioByChapter: Object.fromEntries(Object.entries(lesson.audioByChapter).map(([chapterId, artifact]) => [chapterId, { ...artifact, durationSeconds: durations[chapterId] || artifact.durationSeconds }])) };
  const minutes = lessonAudioMinutes(knownLesson);
  return minutes ? spanish ? `${minutes} min de audio` : `${minutes} min of audio` : spanish ? `máx. ${lesson.preferences.durationMinutes} min` : `max. ${lesson.preferences.durationMinutes} min`;
}

export function StudyClient({ initialLesson, courseSources = [], speechAvailability = { openai: false, kokoro: false, qwen: false } }: { initialLesson: Lesson; courseSources?: CourseSource[]; speechAvailability?: { openai: boolean; kokoro: boolean; qwen: boolean } }) {
  const locale = useLocale();
  const spanish = locale === "es";
  const copy = spanish ? {
    browser: "navegador", estimateAudio: "No se pudo estimar el audio.", startAudio: "No se pudo iniciar el audio.", checkJob: "No se pudo consultar el trabajo.", failedAudio: "El audio ha fallado.", interruptedAudio: "La generación se interrumpió al reiniciar Materia.", unknownAudio: "No se puede confirmar el estado remoto sin riesgo de duplicar la síntesis.", readyChapter: "Audio disponible para este capítulo.", stillProcessing: "El audio sigue procesándose. Puedes volver a abrir la lección más tarde.", generateAudioError: "No se pudo generar el audio.", estimateLesson: "No se pudo estimar la lección.", lessonReady: "Toda la lección ya dispone de audio.", startQueue: "No se pudo iniciar la cola.", checkQueue: "No se pudo consultar la cola.", queueFailed: "La cola ha fallado.", queueInterrupted: "La cola se interrumpió al reiniciar Materia.", allReady: "Toda la lección está preparada en audio.", generateLessonError: "No se pudo generar la lección.", deleteAudioError: "No se pudo eliminar el audio.", deleted: "Audio eliminado. Ya puedes elegir otro origen, motor o interlocutor.", saveError: "No se pudo guardar el progreso.", voice: "Voz", characters: "caracteres",
  } : {
    browser: "browser", estimateAudio: "Could not estimate audio generation.", startAudio: "Could not start audio generation.", checkJob: "Could not retrieve the audio job.", failedAudio: "Audio generation failed.", interruptedAudio: "Generation was interrupted when Materia restarted.", unknownAudio: "The remote state cannot be confirmed without risking duplicate synthesis.", readyChapter: "Audio is ready for this chapter.", stillProcessing: "Audio is still processing. You can reopen the lesson later.", generateAudioError: "Could not generate audio.", estimateLesson: "Could not estimate the lesson.", lessonReady: "The entire lesson already has audio.", startQueue: "Could not start the queue.", checkQueue: "Could not retrieve the queue.", queueFailed: "The queue failed.", queueInterrupted: "The queue was interrupted when Materia restarted.", allReady: "The entire lesson is ready in audio.", generateLessonError: "Could not generate lesson audio.", deleteAudioError: "Could not delete the audio.", deleted: "Audio deleted. You can now choose another source, engine, or voice.", saveError: "Could not save your progress.", voice: "Voice", characters: "characters",
  };
  const preferredSpeechLanguage = contentLanguageToSpeech(initialLesson.preferences.contentLanguage);
  const [lesson, setLesson] = useState(initialLesson);
  const [activeId, setActiveId] = useState(initialLesson.progress.activeChapterId || initialLesson.plan.chapters[0].id);
  const [tab, setTab] = useState<StudyTab>("transcript");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [durationByChapter, setDurationByChapter] = useState<Record<string, number>>(() => Object.fromEntries(
    Object.entries(initialLesson.audioByChapter).flatMap(([chapterId, artifact]) => audioMatchesCurrentNarration(artifact) && artifact.durationSeconds ? [[chapterId, artifact.durationSeconds]] : []),
  ));
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  const [studyNotice, setStudyNotice] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioProgress, setAudioProgress] = useState<AudioProgress | null>(null);
  const [audioDeleteBusy, setAudioDeleteBusy] = useState(false);
  const legacyLocalAvailable = preferredSpeechLanguage === "es" && (speechAvailability.qwen || speechAvailability.kokoro);
  const [speechOrigin, setSpeechOrigin] = useState(legacyLocalAvailable ? "legacy" : speechAvailability.openai ? "openai" : "demo");
  const [voiceNodes, setVoiceNodes] = useState<PublicVoiceNode[]>([]);
  const federatedLocalAvailable = voiceNodes.some((node) => node.online && node.engines.some((engine) => engine.id === "qwen" || engine.id === "kokoro"));
  const [speechProvider, setSpeechProvider] = useState<SpeechProviderId>(legacyLocalAvailable ? speechAvailability.qwen ? "qwen" : "kokoro" : speechAvailability.openai ? "openai" : "demo");
  const [speechVoice, setSpeechVoice] = useState(legacyLocalAvailable ? speechAvailability.qwen ? "qwen-es-profesor-c" : "em_santa" : "coral");
  const [speechLanguage, setSpeechLanguage] = useState<SpeechLanguage>(preferredSpeechLanguage);
  const [speechStyle, setSpeechStyle] = useState<SpeechStyle>("serious");
  const [speechPronunciation, setSpeechPronunciation] = useState<SpeechPronunciation>("literal");
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [isPending, startTransition] = useTransition();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialSpeechOriginRef = useRef(speechOrigin);
  const localAudioRequestRef = useRef(false);
  const { beginTask, endTask } = useAbortableTasks();
  const activeChapter = lesson.plan.chapters.find((chapter) => chapter.id === activeId) || lesson.plan.chapters[0];
  const activeIndex = lesson.plan.chapters.findIndex((chapter) => chapter.id === activeChapter.id);
  const narration = chapterNarration(activeChapter, lesson.plan.title, lesson.preferences.contentLanguage);
  const references = chapterReferenceIds(activeChapter).map((id) => lesson.plan.references.find((reference) => reference.id === id)).filter(Boolean);
  const question = lesson.plan.questions.find((item) => item.chapterId === activeChapter.id) || lesson.plan.questions[0];
  const audio = lesson.audioByChapter[activeChapter.id];
  const audioCurrent = audioMatchesCurrentNarration(audio);
  const storedAnswer = lesson.progress.answers[question.id];
  const answer = selectedAnswer ?? storedAnswer ?? null;
  const isCorrect = answer === question.expectedOption;
  const selectedNode = voiceNodes.find((node) => node.online && node.node.id === speechOrigin) || null;
  const selectedEngine = selectedNode?.engines.find((engine) => engine.id === speechProvider) || null;
  const speechProfile: SpeechProfile = { provider: speechProvider, nodeId: selectedNode?.node.id || null, voice: speechProvider === "demo" ? "browser-default" : speechVoice, speed: speechSpeed, language: speechLanguage, style: speechStyle, pronunciation: speechPronunciation };
  const voiceOptions = selectedEngine?.voices.map((voice) => voice.id)
    || (speechProvider === "kokoro" ? KOKORO_SPEECH_VOICES[speechLanguage] : speechProvider === "openai" ? OPENAI_SPEECH_VOICES : speechProvider === "qwen" ? QWEN_SPEECH_VOICES : ["browser-default"]);
  const setCurrentAnswer = (value: number) => { setSelectedAnswer(value); setFeedbackVisible(false); };

  function voiceLabel(voice: string) {
    return selectedEngine?.voices.find((item) => item.id === voice)?.label || SPEECH_VOICE_LABELS[voice] || voice;
  }

  function configureSpeechProvider(next: SpeechProviderId, engine?: VoiceNodeEngine) {
    setSpeechProvider(next);
    if (next === "qwen") {
      setSpeechVoice(engine?.voices[0]?.id || "qwen-es-profesor-c"); setSpeechLanguage(engine?.languages.includes(preferredSpeechLanguage) ? preferredSpeechLanguage : engine?.languages[0] || "es"); setSpeechSpeed(1); setSpeechStyle("serious"); setSpeechPronunciation("literal");
      return;
    }
    if (next === "chatterbox") {
      setSpeechVoice(engine?.voices[0]?.id || "default"); setSpeechLanguage(engine?.languages.includes(preferredSpeechLanguage) ? preferredSpeechLanguage : engine?.languages[0] || "es"); setSpeechSpeed(0.9); setSpeechStyle("neutral"); setSpeechPronunciation("literal");
      return;
    }
    setSpeechVoice(next === "kokoro" ? (engine?.voices[0]?.id || (speechLanguage === "es" ? "em_santa" : speechLanguage === "en-gb" ? "bm_daniel" : "af_heart")) : next === "openai" ? "coral" : "browser-default");
  }

  function selectOrigin(next: string) {
    setSpeechOrigin(next);
    const node = voiceNodes.find((item) => item.online && item.node.id === next);
    if (node) {
      const engine = node.engines.find((item) => item.id === "qwen") || node.engines.find((item) => item.id === "chatterbox") || node.engines[0];
      if (engine) configureSpeechProvider(engine.id, engine);
      return;
    }
    if (next === "legacy") configureSpeechProvider(speechAvailability.qwen ? "qwen" : "kokoro");
    else configureSpeechProvider(next === "openai" ? "openai" : "demo");
  }

  useEffect(() => {
    const controller = beginTask();
    void fetch("/api/voice-nodes", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ nodes: PublicVoiceNode[] }> : { nodes: [] })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setVoiceNodes(payload.nodes);
        const preferred = payload.nodes.find((node) => node.online && node.engines.some((engine) => engine.languages.includes(preferredSpeechLanguage))) || null;
        const engine = preferred?.engines.find((item) => item.languages.includes(preferredSpeechLanguage) && item.id === "qwen") || preferred?.engines.find((item) => item.languages.includes(preferredSpeechLanguage));
        if (initialSpeechOriginRef.current === "legacy" && preferred && engine) {
          setSpeechOrigin(preferred.node.id);
          setSpeechProvider(engine.id);
          setSpeechVoice(engine.voices[0]?.id || "default");
          setSpeechLanguage(preferredSpeechLanguage);
          setSpeechSpeed(engine.id === "chatterbox" ? 0.9 : 1);
          setSpeechStyle(engine.id === "qwen" ? "serious" : "neutral");
          setSpeechPronunciation("literal");
        }
      })
      .catch((error) => { if (!controller.signal.aborted && !isAbortError(error)) setVoiceNodes([]); })
      .finally(() => endTask(controller));
    return () => { controller.abort(); endTask(controller); };
  }, [beginTask, endTask, preferredSpeechLanguage]);

  useEffect(() => {
    const controller = beginTask();
    async function refreshAudioActivity() {
      try {
        const response = await fetch("/api/generation", { cache: "no-store", signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;
        const payload = await response.json() as { audio?: { active?: OperationalAudioActivity[] } };
        const matching = (payload.audio?.active || [])
          .filter((item) => item.lessonId === lesson.id)
          .sort((a, b) => Number(b.scope !== "chapter") - Number(a.scope !== "chapter"))[0];
        if (matching) {
          setAudioBusy(true);
          setAudioProgress({ phase: matching.phase === "completed" || matching.phase === "failed" ? "finalizing" : matching.phase, scope: matching.scope, completed: matching.completedChapters, total: matching.totalChapters, chapterId: matching.chapterId, provider: matching.provider, nodeId: matching.nodeId });
        } else if (!localAudioRequestRef.current) {
          setAudioBusy(false);
          setAudioProgress(null);
        }
      } catch (error) {
        if (isAbortError(error)) return;
        // A temporary observability outage does not cancel local work.
      }
    }
    void (async () => {
      while (!controller.signal.aborted) {
        await refreshAudioActivity();
        await abortableDelay(2000, controller.signal).catch(() => {});
      }
    })().finally(() => endTask(controller));
    return () => { controller.abort(); endTask(controller); };
  }, [beginTask, endTask, lesson.id]);

  useEffect(() => () => {
    window.speechSynthesis?.cancel(); audioRef.current?.pause();
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    const probes = lesson.plan.chapters.flatMap((chapter) => {
      const artifact = lesson.audioByChapter[chapter.id];
      if (durationByChapter[chapter.id] || !audioMatchesCurrentNarration(artifact) || artifact.kind !== "file" || !artifact.url) return [];
      const probe = new Audio();
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        if (Number.isFinite(probe.duration) && probe.duration > 0) {
          setDurationByChapter((current) => current[chapter.id] ? current : { ...current, [chapter.id]: probe.duration });
        }
      };
      probe.src = artifact.url;
      probe.load();
      return [probe];
    });
    return () => probes.forEach((probe) => { probe.removeAttribute("src"); probe.load(); });
  }, [durationByChapter, lesson.audioByChapter, lesson.plan.chapters]);

  function clearPlayback() {
    window.speechSynthesis?.cancel(); audioRef.current?.pause(); audioRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null; setPlaying(false);
  }

  function selectChapter(id: string) {
    clearPlayback(); setProgress(0); setActiveId(id); setSelectedAnswer(null); setFeedbackVisible(false);
    void saveProgress({ activeChapterId: id });
  }

  function startProgress(seconds: number, rate = playbackRate) {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setProgress((current) => {
        const next = Math.min(1, current + (0.3 * rate) / seconds);
        if (next >= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setPlaying(false);
        }
        return next;
      });
    }, 300);
  }

  function togglePlayback() {
    if (!audioCurrent || !audio?.kind) return;
    if (playing) { clearPlayback(); return; }
    const startProgressAt = progress >= 0.995 ? 0 : progress;
    if (startProgressAt === 0) setProgress(0);
    setPlaying(true);
    if (audio.kind === "file" && audio.url) {
      const element = new Audio(audio.url); audioRef.current = element;
      element.preload = "auto";
      element.playbackRate = playbackRate;
      element.onloadedmetadata = () => {
        const knownDuration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : durationByChapter[activeChapter.id];
        if (!knownDuration) return;
        setDurationByChapter((current) => ({ ...current, [activeChapter.id]: knownDuration }));
        element.currentTime = startProgressAt * knownDuration;
      };
      element.ontimeupdate = () => {
        const knownDuration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : durationByChapter[activeChapter.id];
        if (knownDuration) setProgress(Math.min(1, element.currentTime / knownDuration));
      };
      element.onended = () => { setProgress(1); setPlaying(false); };
      void element.play().catch(() => setPlaying(false));
    } else {
      const utterance = new SpeechSynthesisUtterance(narration);
      utterance.lang = lesson.preferences.contentLanguage; utterance.rate = 0.96 * playbackRate; utterance.pitch = 1;
      utterance.onend = () => { setProgress(1); setPlaying(false); };
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
      startProgress(Math.max(30, narration.split(/\s+/).length / 2.4), playbackRate);
    }
  }

  async function requestChapterAudio() {
    const controller = beginTask();
    localAudioRequestRef.current = true;
    setAudioBusy(true); setAudioProgress({ phase: "preparing", scope: "chapter", completed: 0, total: 1, chapterId: activeChapter.id, provider: speechProvider, nodeId: speechProfile.nodeId }); setAudioNotice(null);
    try {
      const estimateResponse = await fetch(`/api/lessons/${lesson.id}/audio/estimate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chapterIds: [activeChapter.id], provider: speechProvider, profile: speechProfile }), signal: controller.signal });
      const estimatePayload = await estimateResponse.json();
      if (!estimateResponse.ok) throw new Error(estimatePayload.error || copy.estimateAudio);
      const estimate = estimatePayload.estimate as { characters: number; estimatedMinutes: number; profileKey: string };
      const providerLabel = `${selectedNode ? `${selectedNode.node.label} · ` : ""}${speechProvider === "qwen" ? "Qwen" : speechProvider === "kokoro" ? "Kokoro" : speechProvider === "chatterbox" ? "Chatterbox" : speechProvider === "openai" ? "OpenAI" : copy.browser}`;
      const costMessage = audioEstimateMessage({ provider: speechProvider, providerName: providerLabel, locale });
      const confirmed = window.confirm(spanish ? `Generar audio para «${activeChapter.title}» con ${providerLabel}\n${copy.voice}: ${voiceLabel(speechProfile.voice)} · ${speechProfile.language} · ${speechProfile.speed}×\n\n≈ ${estimate.estimatedMinutes} min · ${estimate.characters} ${copy.characters}\n${costMessage}` : `Generate audio for “${activeChapter.title}” with ${providerLabel}\n${copy.voice}: ${voiceLabel(speechProfile.voice)} · ${speechProfile.language} · ${speechProfile.speed}×\n\n≈ ${estimate.estimatedMinutes} min · ${estimate.characters} ${copy.characters}\n${costMessage}`);
      if (!confirmed) return;
      const operationId = `audio:${speechProvider}:${estimate.profileKey.slice(0, 12)}:${lesson.id}:${lesson.revision}:${activeChapter.id}`;
      const response = await fetch(`/api/lessons/${lesson.id}/audio/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId, expectedLessonRevision: lesson.revision, chapterIds: [activeChapter.id], provider: speechProvider, profile: speechProfile, confirmed: true }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || copy.startAudio);
      setAudioProgress({ phase: "queued", scope: "chapter", completed: 0, total: 1, chapterId: activeChapter.id, provider: speechProvider, nodeId: speechProfile.nodeId });
      setAudioNotice(spanish ? "Audio en proceso. Puedes seguir leyendo; esta página se actualizará al terminar." : "Audio is processing. You can keep reading; this page will update when it finishes.");
      const jobId = payload.job.id as string;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await abortableDelay(2000, controller.signal);
        const statusResponse = await fetch(`/api/audio-jobs/${jobId}`, { cache: "no-store", signal: controller.signal });
        const statusPayload = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusPayload.error || copy.checkJob);
        if (statusPayload.job.state === "failed") throw new Error(statusPayload.job.error || copy.failedAudio);
        if (statusPayload.job.state === "interrupted") throw new Error(statusPayload.job.error || copy.interruptedAudio);
        if (statusPayload.job.state === "unknown") throw new Error(statusPayload.job.error || copy.unknownAudio);
        setAudioProgress((current) => current ? { ...current, phase: "synthesizing" } : current);
        if (statusPayload.job.state === "completed") {
          setAudioProgress((current) => current ? { ...current, phase: "finalizing", completed: 1 } : current);
          const lessonResponse = await fetch(`/api/lessons/${lesson.id}`, { cache: "no-store", signal: controller.signal });
          const lessonPayload = await lessonResponse.json();
          if (lessonResponse.ok) {
            setLesson(lessonPayload.lesson);
          }
          setAudioNotice(copy.readyChapter);
          return;
        }
      }
      throw new Error(copy.stillProcessing);
    } catch (error) { if (!isAbortError(error)) setAudioNotice(error instanceof Error ? error.message : copy.generateAudioError); }
    finally { endTask(controller); if (!controller.signal.aborted) { localAudioRequestRef.current = false; setAudioBusy(false); setAudioProgress(null); } }
  }

  async function requestLessonAudio() {
    const controller = beginTask();
    localAudioRequestRef.current = true;
    setAudioBusy(true); setAudioProgress({ phase: "preparing", scope: "lesson", completed: 0, total: 0, chapterId: null, provider: speechProvider, nodeId: speechProfile.nodeId }); setAudioNotice(null);
    try {
      const estimated = await fetch(`/api/lessons/${lesson.id}/audio/batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "estimate", provider: speechProvider, profile: speechProfile }), signal: controller.signal });
      const estimatePayload = await estimated.json();
      if (!estimated.ok) throw new Error(estimatePayload.error || copy.estimateLesson);
      const estimate = estimatePayload.estimate as { chapters: number; characters: number; estimatedMinutes: number };
      if (!estimate.chapters) { setAudioNotice(copy.lessonReady); return; }
      const providerLabel = `${selectedNode ? `${selectedNode.node.label} · ` : ""}${speechProvider === "qwen" ? "Qwen" : speechProvider === "kokoro" ? "Kokoro" : speechProvider === "chatterbox" ? "Chatterbox" : speechProvider === "openai" ? "OpenAI" : copy.browser}`;
      const costMessage = audioEstimateMessage({ provider: speechProvider, providerName: providerLabel, locale, batch: true });
      if (!window.confirm(spanish ? `Generar los ${estimate.chapters} capítulos pendientes de esta lección con ${providerLabel}\nVoz: ${voiceLabel(speechProfile.voice)}\n\n≈ ${estimate.estimatedMinutes} min · ${estimate.characters} caracteres\n${costMessage}` : `Generate the ${estimate.chapters} pending chapters in this lesson with ${providerLabel}\nVoice: ${voiceLabel(speechProfile.voice)}\n\n≈ ${estimate.estimatedMinutes} min · ${estimate.characters} characters\n${costMessage}`)) return;
      const started = await fetch(`/api/lessons/${lesson.id}/audio/batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", confirmed: true, provider: speechProvider, profile: speechProfile }), signal: controller.signal });
      const payload = await started.json();
      if (!started.ok) throw new Error(payload.error || copy.startQueue);
      setAudioProgress({ phase: "queued", scope: "lesson", completed: 0, total: estimate.chapters, chapterId: null, provider: speechProvider, nodeId: speechProfile.nodeId });
      const id = payload.job.id as string;
      for (let attempt = 0; attempt < 1800; attempt += 1) {
        await abortableDelay(2000, controller.signal);
        const response = await fetch(`/api/audio-batch-jobs/${id}`, { cache: "no-store", signal: controller.signal }); const current = await response.json();
        if (!response.ok) throw new Error(current.error || copy.checkQueue);
        setAudioProgress({ phase: current.job.completedChapters === current.job.totalChapters ? "finalizing" : "synthesizing", scope: "lesson", completed: current.job.completedChapters, total: current.job.totalChapters, chapterId: current.job.currentChapterId || null, provider: speechProvider, nodeId: speechProfile.nodeId });
        setAudioNotice(spanish ? `Generando lección: ${current.job.completedChapters}/${current.job.totalChapters} capítulos preparados.` : `Generating lesson: ${current.job.completedChapters}/${current.job.totalChapters} chapters ready.`);
        if (current.job.state === "failed") throw new Error(current.job.error || copy.queueFailed);
        if (current.job.state === "interrupted") throw new Error(current.job.error || copy.queueInterrupted);
        if (current.job.state === "completed") { const refreshed = await fetch(`/api/lessons/${lesson.id}`, { cache: "no-store", signal: controller.signal }); const value = await refreshed.json(); if (refreshed.ok) setLesson(value.lesson); setAudioNotice(copy.allReady); return; }
      }
    } catch (error) { if (!isAbortError(error)) setAudioNotice(error instanceof Error ? error.message : copy.generateLessonError); }
    finally { endTask(controller); if (!controller.signal.aborted) { localAudioRequestRef.current = false; setAudioBusy(false); setAudioProgress(null); } }
  }

  async function deleteChapterAudio() {
    if (!audio || audio.status !== "ready") return;
    const providerLabel = audio.provider === "qwen" ? "Qwen" : audio.provider === "kokoro" ? "Kokoro" : audio.provider === "chatterbox" ? "Chatterbox" : audio.provider === "openai" ? "OpenAI" : copy.browser;
    const confirmed = window.confirm(spanish ? `Eliminar el audio actual de «${activeChapter.title}» generado con ${providerLabel}?\n\nEl capítulo y tu progreso se conservarán. Después podrás generar otro audio con cualquier origen, motor o interlocutor disponible.` : `Delete the current audio for “${activeChapter.title}”, generated with ${providerLabel}?\n\nThe chapter and your progress will remain. You can then generate new audio with any available source, engine, or voice.`);
    if (!confirmed) return;
    clearPlayback();
    setProgress(0);
    setAudioDeleteBusy(true);
    setAudioNotice(null);
    try {
      const response = await fetch(`/api/lessons/${lesson.id}/audio/${activeChapter.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedLessonRevision: lesson.revision, confirmed: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || copy.deleteAudioError);
      setLesson(payload.lesson);
      setDurationByChapter((current) => {
        const next = { ...current };
        delete next[activeChapter.id];
        return next;
      });
      setAudioNotice(copy.deleted);
    } catch (error) {
      setAudioNotice(error instanceof Error ? error.message : copy.deleteAudioError);
    } finally {
      setAudioDeleteBusy(false);
    }
  }

  function cyclePlaybackRate() {
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  }

  function seekToFraction(nextProgress: number) {
    if (!audioCurrent || audio?.kind !== "file") return;
    const bounded = Math.max(0, Math.min(1, nextProgress));
    setProgress(bounded);
    const duration = audioRef.current?.duration || activeDuration || 0;
    if (audioRef.current && Number.isFinite(duration) && duration > 0) audioRef.current.currentTime = bounded * duration;
  }

  function seekBy(seconds: number) {
    if (!audioCurrent || audio?.kind !== "file") return;
    const duration = audioRef.current?.duration || activeDuration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const current = audioRef.current?.currentTime ?? progress * duration;
    seekToFraction((current + seconds) / duration);
  }

  async function saveProgress(body: Record<string, unknown>) {
    const response = await fetch(`/api/lessons/${lesson.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, expectedRevision: lesson.revision }) });
    const payload = await response.json();
    if (response.ok) { setLesson(payload.lesson); setStudyNotice(null); return; }
    setStudyNotice(payload.error || copy.saveError);
    if (response.status === 409) {
      const refreshed = await fetch(`/api/lessons/${lesson.id}`, { cache: "no-store" });
      if (refreshed.ok) setLesson((await refreshed.json()).lesson);
    }
  }

  function toggleComplete() {
    const set = new Set(lesson.progress.completedChapterIds);
    if (set.has(activeChapter.id)) set.delete(activeChapter.id); else set.add(activeChapter.id);
    startTransition(() => { void saveProgress({ completedChapterIds: [...set] }); });
  }

  function checkAnswer() {
    if (answer === null) return;
    setFeedbackVisible(true);
    startTransition(() => { void saveProgress({ questionId: question.id, answer }); });
  }

  const activeDuration = durationByChapter[activeChapter.id] || null;
  const fallbackDuration = Math.round(activeChapter.estimatedMinutes * 60);
  const currentSeconds = Math.round(progress * (activeDuration || fallbackDuration));
  const format = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const chapterDuration = (chapterId: string, estimatedMinutes: number) => durationByChapter[chapterId]
    ? format(Math.round(durationByChapter[chapterId]))
    : `≈ ${Math.round(estimatedMinutes)} min`;

  return <main className="study-shell">
    <aside className="chapter-rail">
      <div className="study-brand-row"><Link className="brand study-brand" href="/"><WaveMark size={31}/>Materia</Link><LocaleSwitcher /></div>
      <Link className="back-link" href="/"><BackIcon />{spanish ? "Biblioteca" : "Library"}</Link>
      <h1>{lesson.plan.title}</h1><p className="lesson-meta">{lessonDurationLabel(lesson, durationByChapter, spanish)} · {lesson.plan.chapters.length} {spanish ? "capítulos" : "chapters"}</p>
      <p className="demo-disclosure">{audioCurrent && audio?.kind === "file" ? `${spanish ? "Audio generado con" : "Audio generated with"} ${audio.provider === "kokoro" ? "Kokoro local" : audio.provider === "qwen" ? "Qwen local" : audio.provider === "chatterbox" ? "Chatterbox local" : "OpenAI TTS"}` : audioCurrent && audio?.kind === "browser-speech" ? spanish ? "Lectura local del navegador" : "Local browser speech" : audio?.status === "ready" ? spanish ? "Audio anterior · pendiente de narración guiada" : "Previous audio · guided narration pending" : spanish ? "Audio todavía no generado" : "Audio not generated yet"}</p>
      <ol className="chapter-list">{lesson.plan.chapters.map((chapter, index) => {
        const completed = lesson.progress.completedChapterIds.includes(chapter.id); const current = chapter.id === activeChapter.id;
        const generating = audioBusy && audioProgress?.chapterId === chapter.id;
        const stateClass = [current ? "is-current" : "", completed ? "is-complete" : "", generating ? "is-generating" : ""].filter(Boolean).join(" ");
        return <li key={chapter.id} className={stateClass}>
          <button onClick={() => selectChapter(chapter.id)}><span className="chapter-index">{generating ? <span className="chapter-generation-dot" aria-hidden="true" /> : completed ? <CheckIcon /> : index + 1}</span><span><strong>{index + 1}. {chapter.title}</strong><small>{generating ? spanish ? "Generando audio…" : "Generating audio…" : chapterDuration(chapter.id, chapter.estimatedMinutes)}</small></span></button>
        </li>;
      })}</ol>
      <Waveform active={(activeIndex + 1) * 8} bars={36} />
    </aside>

    <section className="study-main">
      <nav className="study-tabs" aria-label={spanish ? "Contenido de estudio" : "Study content"}>
        <button className={tab === "transcript" ? "is-active" : ""} onClick={() => setTab("transcript")}>{spanish ? "Transcripción" : "Transcript"}</button>
        <button className={tab === "references" ? "is-active" : ""} onClick={() => setTab("references")}>{spanish ? "Referencias" : "References"}</button>
        <button className={tab === "check" ? "is-active" : ""} onClick={() => setTab("check")}>{spanish ? "Comprobar" : "Check"}</button>
      </nav>
      {studyNotice ? <p className="study-notice" role="status">{studyNotice}</p> : null}
      <article className="transcript" hidden={tab !== "transcript"}>
        <h2>{activeChapter.title}</h2>
        {audioBusy && audioProgress ? <AudioGenerationProgress progress={audioProgress} chapters={lesson.plan.chapters} activeChapterId={activeChapter.id} activeChapterHasAudio={audioCurrent} /> : null}
        {audioCurrent ? <div className="audio-replace">
          <div><strong>{spanish ? "Audio disponible." : "Audio available."}</strong><p>{spanish ? "Puedes conservarlo o eliminarlo para comparar este capítulo con otra voz. El texto, las respuestas y el progreso no se borran." : "Keep it or delete it to compare this chapter with another voice. Text, answers, and progress are preserved."}</p></div>
          <button onClick={deleteChapterAudio} disabled={audioDeleteBusy || playing}>{audioDeleteBusy ? spanish ? "Eliminando…" : "Deleting…" : spanish ? "Eliminar y generar otro" : "Delete and generate another"}</button>
          {audioNotice ? <small role="status">{audioNotice}</small> : null}
        </div> : <div className="audio-request">
          <div><strong>{spanish ? "Este capítulo está disponible para leer." : "This chapter is ready to read."}</strong><p>{spanish ? "El audio se genera solo cuando tú lo autorizas. Primero eliges el equipo y después uno de sus motores disponibles." : "Audio is generated only when you approve it. Choose a device first, then one of its available engines."}</p></div>
          <div className="audio-profile-grid">
            <label className="audio-provider"><span>{spanish ? "Origen" : "Source"}</span><select value={speechOrigin} onChange={(event) => selectOrigin(event.target.value)} disabled={audioBusy}>
              {voiceNodes.map((node) => <option key={node.node.id} value={node.node.id} disabled={!node.online}>{node.node.label}{node.online ? "" : spanish ? " · sin conexión" : " · offline"}</option>)}
              {legacyLocalAvailable && !federatedLocalAvailable ? <option value="legacy">{spanish ? "Conexión local anterior · compatibilidad" : "Legacy local connection · compatibility"}</option> : null}
              {speechAvailability.openai ? <option value="openai">OpenAI · {spanish ? "nube y coste" : "cloud and usage cost"}</option> : null}
              <option value="demo">{spanish ? "Navegador · demo" : "Browser · demo"}</option>
            </select></label>
            <label className="audio-provider"><span>{spanish ? "Motor" : "Engine"}</span><select value={speechProvider} onChange={(event) => { const next = event.target.value as SpeechProviderId; configureSpeechProvider(next, selectedNode?.engines.find((engine) => engine.id === next)); }} disabled={audioBusy || (!selectedNode && speechOrigin !== "legacy")}>
              {selectedNode ? selectedNode.engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.label} · {engine.quality}</option>) : speechOrigin === "legacy" ? <><option value="qwen" disabled={!speechAvailability.qwen}>Qwen{speechAvailability.qwen ? "" : spanish ? " · no configurado" : " · not configured"}</option><option value="kokoro" disabled={!speechAvailability.kokoro}>Kokoro{speechAvailability.kokoro ? "" : spanish ? " · no configurado" : " · not configured"}</option></> : <option value={speechProvider}>{speechProvider === "openai" ? "OpenAI TTS" : spanish ? "Voz del navegador" : "Browser voice"}</option>}
            </select></label>
            <label className="audio-provider"><span>{spanish ? "Idioma" : "Language"}</span><select value={speechLanguage} onChange={(event) => { const next = event.target.value as SpeechLanguage; setSpeechLanguage(next); if (speechProvider === "kokoro") setSpeechVoice(selectedEngine?.voices[0]?.id || (next === "es" ? "em_santa" : next === "en-gb" ? "bm_daniel" : "af_heart")); }} disabled={audioBusy || speechProvider === "demo" || speechProvider === "qwen" || speechProvider === "chatterbox"}>
              {(selectedEngine?.languages || ["es", "en-us", "en-gb"]).map((language) => <option key={language} value={language}>{language === "es" ? "Español" : language === "en-us" ? "English · US" : "English · UK"}</option>)}
            </select></label>
            <label className="audio-provider"><span>{spanish ? "Interlocutor" : "Voice"}</span><select value={speechVoice} onChange={(event) => setSpeechVoice(event.target.value)} disabled={audioBusy || speechProvider === "demo"}>{voiceOptions.map((voice) => <option key={voice} value={voice}>{voiceLabel(voice)}</option>)}</select></label>
            <label className="audio-provider"><span>{spanish ? "Velocidad de generación" : "Generation speed"}</span><select value={speechSpeed} onChange={(event) => setSpeechSpeed(Number(event.target.value))} disabled={audioBusy || speechProvider === "demo" || speechProvider === "qwen" || speechProvider === "chatterbox"}><option value={0.9}>0.9×</option><option value={1}>1×</option><option value={1.1}>1.1×</option></select></label>
            <label className="audio-provider"><span>{spanish ? "Estilo" : "Style"}</span><select value={speechStyle} onChange={(event) => setSpeechStyle(event.target.value as SpeechStyle)} disabled={audioBusy || speechProvider !== "openai"}><option value="neutral">{spanish ? "Neutro" : "Neutral"}</option><option value="serious">{spanish ? "Serio docente" : "Instructor"}</option><option value="warm">{spanish ? "Cálido" : "Warm"}</option></select></label>
            <label className="audio-provider"><span>{spanish ? "Pronunciación" : "Pronunciation"}</span><select value={speechPronunciation} onChange={(event) => setSpeechPronunciation(event.target.value as SpeechPronunciation)} disabled={audioBusy || speechLanguage !== "es" || speechProvider === "qwen" || speechProvider === "chatterbox"}><option value="literal">Literal</option><option value="technical-es">{spanish ? "Técnica ES" : "Technical Spanish"}</option></select></label>
          </div>
          {!audioBusy ? <div className="audio-request-actions"><button onClick={requestChapterAudio}>{spanish ? "Generar este capítulo" : "Generate this chapter"}</button><button onClick={requestLessonAudio}>{spanish ? "Generar toda la lección" : "Generate entire lesson"}</button></div> : null}
          {speechProvider === "qwen" ? <small>{spanish ? "Qwen prioriza calidad y continuidad vocal. La reproducción comienza a 1× y puedes ajustarla sin regenerar el audio." : "Qwen prioritizes quality and voice continuity. Playback starts at 1× and can be adjusted without regenerating audio."}</small> : speechProvider === "chatterbox" ? <small>{spanish ? "Chatterbox usa una cadencia de síntesis validada y prioriza rapidez." : "Chatterbox uses a validated synthesis cadence and prioritizes speed."}</small> : null}
          {audioNotice ? <small role="status">{audioNotice}</small> : null}
        </div>}
        <div className="listening-introduction"><span>{spanish ? "Guía de escucha" : "Listening guide"}</span><p>{chapterListeningIntroduction(activeChapter, lesson.plan.title, lesson.preferences.contentLanguage)}</p></div>
        <div className="semantic-blocks">{activeChapter.blocks.map((block, blockIndex) => {
          const blockReferences = block.referenceIds.map((id) => lesson.plan.references.find((reference) => reference.id === id)).filter(Boolean);
          return <section className={`teaching-block teaching-block-${block.kind}`} key={block.id}>
            <p className="block-transition">{blockListeningTransition(block, blockIndex, lesson.preferences.contentLanguage)}</p>
            <header><span>{(spanish ? SPANISH_TEACHING_BLOCK_LABELS : TEACHING_BLOCK_LABELS)[block.kind]}</span>{block.title ? <h3>{block.title}</h3> : null}</header>
            {block.content.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={`${block.id}-${index}`}>{paragraph}</p>)}
            {block.artifacts.length ? <div className="learning-artifacts">{block.artifacts.map((artifact) => <LearningArtifactCard key={artifact.id} artifact={artifact} />)}</div> : null}
            {blockReferences.length ? <button className="block-reference-link" onClick={() => setTab("references")}>{blockReferences.length === 1 ? blockReferences[0]!.label : `${blockReferences.length} ${spanish ? "fuentes vinculadas" : "linked sources"}`} ↗</button> : null}
          </section>;
        })}</div>
      </article>

      <div className="tab-detail" hidden={tab === "transcript"}>{tab === "references" ? <ReferencePanel references={references} courseSources={courseSources} /> : <QuestionPanel groupName={`main-${question.id}`} question={question} answer={answer} setAnswer={setCurrentAnswer} feedbackVisible={feedbackVisible} isCorrect={isCorrect} checkAnswer={checkAnswer} isPending={isPending} completed={lesson.progress.completedChapterIds.includes(activeChapter.id)} toggleComplete={toggleComplete} />}</div>
    </section>

    <aside className="context-rail">
      <ReferencePanel references={references} courseSources={courseSources} />
      <QuestionPanel groupName={`rail-${question.id}`} question={question} answer={answer} setAnswer={setCurrentAnswer} feedbackVisible={feedbackVisible} isCorrect={isCorrect} checkAnswer={checkAnswer} isPending={isPending} completed={lesson.progress.completedChapterIds.includes(activeChapter.id)} toggleComplete={toggleComplete} />
      <section className="essential"><h2>{spanish ? "Lo esencial" : "Key takeaways"}</h2><ul>{activeChapter.keyPoints.map((point) => <li key={point}><WaveMark size={22}/><span>{point}</span></li>)}</ul></section>
    </aside>

    <footer className="player-bar">
      <button className="seek-step" disabled={!audioCurrent || audio?.kind !== "file"} onClick={() => seekBy(-10)} aria-label={spanish ? "Retroceder 10 segundos" : "Back 10 seconds"}>−10</button>
      <button aria-label={playing ? spanish ? "Pausar" : "Pause" : spanish ? "Reproducir" : "Play"} className="play-control" onClick={togglePlayback} disabled={!audioCurrent || !audio?.kind}>{playing ? <PauseIcon size={28}/> : <PlayIcon size={28}/>}</button>
      <button className="seek-step" disabled={!audioCurrent || audio?.kind !== "file"} onClick={() => seekBy(10)} aria-label={spanish ? "Avanzar 10 segundos" : "Forward 10 seconds"}>+10</button>
      <span className="player-time">{format(currentSeconds)} / {activeDuration ? format(Math.round(activeDuration)) : `≈ ${format(fallbackDuration)}`}</span>
      <div className="player-wave"><Waveform active={Math.round(progress * 108)} bars={108}/><span style={{ width: `${progress * 100}%` }} /><input className="player-seek" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={(event) => seekToFraction(Number(event.target.value) / 1000)} disabled={!audioCurrent || audio?.kind !== "file"} aria-label={`${spanish ? "Posición del audio" : "Audio position"}: ${format(currentSeconds)}`} /></div>
      <button className="speed-control" onClick={cyclePlaybackRate} aria-label={spanish ? `Velocidad de reproducción ${playbackRate}. Cambiar velocidad` : `Playback speed ${playbackRate}. Change speed`}>{playbackRate}×</button>
    </footer>
  </main>;
}

function AudioGenerationProgress({ progress, chapters, activeChapterId, activeChapterHasAudio }: { progress: AudioProgress; chapters: Lesson["plan"]["chapters"]; activeChapterId: string; activeChapterHasAudio: boolean }) {
  const spanish = useLocale() === "es";
  const labels = spanish ? ["Enviado", "Generando", "Finalizando"] : ["Submitted", "Generating", "Finalizing"];
  const index = progress.phase === "preparing" || progress.phase === "queued" ? 0 : progress.phase === "synthesizing" ? 1 : 2;
  const chapter = chapters.find((item) => item.id === progress.chapterId);
  const activeChapter = chapters.find((item) => item.id === activeChapterId);
  const generatingAnotherChapter = progress.scope === "chapter" && Boolean(chapter) && chapter?.id !== activeChapterId;
  const provider = progress.provider === "qwen" ? "Qwen" : progress.provider === "kokoro" ? "Kokoro" : progress.provider === "chatterbox" ? "Chatterbox" : progress.provider === "openai" ? "OpenAI" : spanish ? "navegador" : "browser";
  const ratio = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : index / 3;
  return <div className="audio-generation-progress" role="status" aria-live="polite">
    <div className="audio-progress-heading"><span className="generation-spinner" aria-hidden="true" /><span><strong>{generatingAnotherChapter ? spanish ? "Generando otro capítulo de esta lección" : "Generating another chapter in this lesson" : progress.scope === "chapter" ? spanish ? "Generando este capítulo" : "Generating this chapter" : spanish ? "Preparando la lección en audio" : "Preparing lesson audio"}</strong><small>{provider}{progress.nodeId ? ` · ${progress.nodeId}` : ""}{chapter ? ` · ${chapter.title}` : ""}</small></span>{progress.total > 1 ? <b>{progress.completed}/{progress.total}</b> : null}</div>
    <div className="audio-progress-track"><span style={{ width: `${Math.max(5, ratio * 100)}%` }} /></div>
    <ol>{labels.map((label, step) => <li className={step < index ? "is-complete" : step === index ? "is-active" : ""} key={label}>{label}</li>)}</ol>
    <small>{generatingAnotherChapter ? activeChapterHasAudio ? spanish ? "El capítulo abierto no forma parte de esta generación y conserva su audio. Las acciones de audio de la lección permanecerán bloqueadas hasta que termine el trabajo actual." : "The open chapter is not part of this generation and keeps its audio. Lesson audio actions remain locked until the current job finishes." : spanish ? `«${activeChapter?.title || "El capítulo abierto"}» sigue pendiente. Las acciones de audio de esta lección permanecerán bloqueadas hasta que termine la generación actual.` : `“${activeChapter?.title || "The open chapter"}” is still pending. Lesson audio actions remain locked until the current generation finishes.` : spanish ? "Puedes seguir leyendo. Las acciones de generación permanecen bloqueadas para evitar duplicados." : "You can keep reading. Generation actions remain locked to prevent duplicates."}</small>
  </div>;
}

function ReferencePanel({ references, courseSources }: { references: Array<Lesson["plan"]["references"][number] | undefined>; courseSources: CourseSource[] }) {
  const spanish = useLocale() === "es";
  return <section className="references-panel"><h2>{spanish ? "Referencias" : "References"}</h2>{references.map((reference) => { if (!reference) return null; const source = courseSources.find((item) => item.id === reference.id); return <div className="source-quote" key={reference.id}><strong>{reference.label}</strong><blockquote>“{reference.excerpt}”</blockquote>{source ? <><small>{source.publisher}{source.locator ? ` · ${source.locator}` : ""}</small><a href={source.url} target="_blank" rel="noreferrer">{spanish ? "Abrir fuente canónica" : "Open canonical source"} ↗</a></> : <small>{spanish ? "Líneas" : "Lines"} {reference.startLine || "—"}–{reference.endLine || reference.startLine || "—"} {spanish ? "de la fuente local" : "in the local source"}</small>}</div>; })}</section>;
}

function QuestionPanel({ groupName, question, answer, setAnswer, feedbackVisible, isCorrect, checkAnswer, isPending, completed, toggleComplete }: { groupName: string; question: Lesson["plan"]["questions"][number]; answer: number | null; setAnswer: (value: number) => void; feedbackVisible: boolean; isCorrect: boolean; checkAnswer: () => void; isPending: boolean; completed: boolean; toggleComplete: () => void }) {
  const spanish = useLocale() === "es";
  return <section className="question-panel"><h2>{spanish ? "Comprobar" : "Check"}</h2><p>{question.prompt}</p><div className="options">{question.options.map((option, index) => <label key={option}><input type="radio" name={groupName} checked={answer === index} onChange={() => setAnswer(index)} /><span>{option}</span></label>)}</div>
    {feedbackVisible ? <div className={`feedback ${isCorrect ? "is-correct" : ""}`}><strong>{isCorrect ? spanish ? "¡Correcto!" : "Correct!" : spanish ? "Todavía no" : "Not yet"}</strong><p>{question.explanation}</p></div> : null}
    <button className="check-button" onClick={checkAnswer} disabled={answer === null || isPending}>{spanish ? "Comprobar respuesta" : "Check answer"}</button>
    <button className={`complete-action ${completed ? "is-complete" : ""}`} onClick={toggleComplete} disabled={isPending || (!completed && !(feedbackVisible && isCorrect))}><span><CheckIcon /></span>{completed ? spanish ? "Capítulo completado" : "Chapter complete" : feedbackVisible && isCorrect ? spanish ? "Marcar capítulo como completado" : "Mark chapter complete" : spanish ? "Responde correctamente para completar" : "Answer correctly to complete"}</button>
  </section>;
}
