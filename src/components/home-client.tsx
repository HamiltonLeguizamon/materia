"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { ArrowIcon, BookIcon, PlayIcon, PlusIcon, TrashIcon, UploadIcon, WaveMark } from "@/components/icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Waveform } from "@/components/waveform";
import { abortableDelay, isAbortError, useAbortableTasks } from "@/components/use-abortable-tasks";
import { CONTENT_LANGUAGES, contentLanguageName, type ContentLanguage } from "@/i18n/locale";
import { useLocale } from "@/i18n/locale-context";

type LessonSummary = { id: string; title: string; summary: string; durationMinutes: number; chapterCount: number; status: string; origin: "demo" | "generated" | "agent-imported"; completedCount: number; updatedAt: string };
type CourseSummary = { id: string; title: string; summary: string; status: "draft" | "validated" | "published"; moduleCount: number; lessonCount: number; contentUpdatedAt: string; totalChapterCount: number; completedChapterCount: number; hasStudyActivity: boolean; lastStudiedAt: string | null };
type ProviderStatus = { defaultProvider: "demo" | "openai"; openai: { configured: boolean; textModel: string; speechModel: string; message: string } };
type GenerationStatus = { state: "idle" | "running" | "completed" | "failed"; phase: "idle" | "checking-cache" | "planning" | "synthesizing" | "saving" | "completed" | "failed"; sourceName: string | null; startedAt: string | null; lessonId: string | null; reused: boolean; error: string | null };
type CreationMode = "agent" | "openai";
type CourseFilter = "published" | "validated" | "draft" | "active" | "completed" | "all";

const COURSES_PER_PAGE = 10;

function shortDate(value: string, locale: "en" | "es") {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function CourseCard({ course, spanish }: { course: CourseSummary; spanish: boolean }) {
  const complete = course.totalChapterCount > 0 && course.completedChapterCount === course.totalChapterCount;
  const progress = course.totalChapterCount > 0 ? Math.round(course.completedChapterCount / course.totalChapterCount * 100) : 0;
  const status = spanish ? course.status === "draft" ? "Borrador" : course.status === "validated" ? "En revisión" : "Publicado" : course.status === "draft" ? "Draft" : course.status === "validated" ? "In review" : "Published";
  const activity = complete
    ? spanish ? "Completado" : "Completed"
    : course.hasStudyActivity && course.lastStudiedAt
      ? `${spanish ? "Continuado" : "Continued"} ${shortDate(course.lastStudiedAt, spanish ? "es" : "en")}`
      : `${spanish ? "Contenido actualizado" : "Content updated"} ${shortDate(course.contentUpdatedAt, spanish ? "es" : "en")}`;
  return <Link className="course-card" href={`/courses/${course.id}`}>
    <div className="course-card-top"><span className={`course-status status-${course.status}`}>{status}</span><span className="course-activity">{activity}</span></div>
    <h3>{course.title}</h3><p>{course.summary}</p>
    <div className="course-progress" aria-label={spanish ? `${progress}% del curso completado` : `${progress}% of the course completed`}>
      <span><b>{course.completedChapterCount}/{course.totalChapterCount}</b> {spanish ? "capítulos" : "chapters"}</span>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
    </div>
    <small>{course.moduleCount} {spanish ? course.moduleCount === 1 ? "módulo" : "módulos" : course.moduleCount === 1 ? "module" : "modules"} · {course.lessonCount} {spanish ? course.lessonCount === 1 ? "lección" : "lecciones" : course.lessonCount === 1 ? "lesson" : "lessons"}</small>
  </Link>;
}

const PHASE_LABELS: Record<"en" | "es", Record<GenerationStatus["phase"], string>> = {
  en: { idle: "No active generation", "checking-cache": "Checking for a reusable lesson", planning: "Building the teaching plan", synthesizing: "Generating audio with TTS", saving: "Saving the lesson", completed: "Generation completed", failed: "Generation failed" },
  es: { idle: "Sin generaciones activas", "checking-cache": "Comprobando si ya existe", planning: "Generando el plan docente", synthesizing: "Generando el audio con TTS", saving: "Guardando la lección", completed: "Generación terminada", failed: "La generación ha fallado" },
};

function copyTextFallback(value: string) {
  const field = document.createElement("textarea");
  field.value = value; field.style.position = "fixed"; field.style.opacity = "0";
  document.body.appendChild(field); field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("The browser did not allow copying the text.");
}

export function HomeClient({ initialLessons, initialCourses, providerStatus }: { initialLessons: LessonSummary[]; initialCourses: CourseSummary[]; providerStatus: ProviderStatus }) {
  const locale = useLocale();
  const spanish = locale === "es";
  const copy = spanish ? {
    library: "Biblioteca", newLesson: "Nueva lección", demoMode: "Modo demo · sin coste", openaiReady: "OpenAI · configurado",
    hero: "Aprende a otro ritmo", heroBody: "Convierte una lección en una explicación clara, por capítulos y conectada con tus fuentes.", create: "Crear una lección", tryDemo: "Probar la lección de ejemplo",
    yourCourses: "Tus cursos", continueLearning: "Continuar aprendiendo", looseLessons: "Lecciones sueltas", yourLibrary: "Tu biblioteca", noLessons: "Aún no hay lecciones guardadas.", lastFailed: "La última generación falló",
    emptyTitle: "Empieza con una fuente que quieras entender", emptyBody: "Pega tus apuntes o prueba la lección de redes. Todo queda en este dispositivo.", loadExample: "Cargar el ejemplo",
    lesson: "Lección", duration: "Duración", chapters: "Capítulos", state: "Estado", updated: "Actividad", complete: "Completada", ready: "Lista para estudiar", delete: "Borrar", searchCourses: "Buscar cursos", searchPlaceholder: "Título, tema o descripción…", filterCourses: "Filtrar cursos", all: "Todos", published: "Publicados", validated: "En revisión", drafts: "Borradores", active: "En curso", completed: "Completados", noCourses: "No hay cursos que coincidan con esta búsqueda.", previous: "Anterior", next: "Siguiente", preparationHint: "Se muestran todos los cursos. Usa el filtro para consultar solo los publicados, en revisión, borradores, en curso o completados.", showAllLessons: "Mostrar todas", showFewerLessons: "Mostrar menos",
    panelIntro: "Elige entre un curso investigado o una conversión directa.", close: "Cerrar", creationMode: "Modalidad de creación", agentMode: "Con agente y MCP", agentModeHint: "Recomendado para cursos y certificaciones", directMode: "Directa con OpenAI", directModeHint: "Rápida para una fuente aislada",
    traceable: "Autoría trazable", agentTitle: "Deja que tu agente construya el curso", agentBody: "Codex, Claude u otro cliente compatible con MCP puede investigar varias fuentes, redactar el contenido y guardarlo directamente en Materia. La aplicación valida el resultado y no genera audio automáticamente.",
    step1: "Abre este repositorio con tu agente.", step1Body: "En Codex, la conexión ya está declarada en .codex/config.toml.", step2: "Comprueba Materia MCP.", step2Body: "En otros clientes registra el servidor STDIO del script mcp. Las herramientas usan el prefijo materia_.", step3: "Describe tu objetivo una sola vez.", step3Body: "El agente investigará, importará un borrador y pedirá permiso antes de publicar o generar audio.",
    topic: "Certificación o tema", preparedPrompt: "Prompt preparado", copied: "Prompt copiado", copyPrompt: "Copiar prompt para mi agente", noBrowserModels: "Esta modalidad no llama a modelos ni a TTS desde el navegador.", contentLanguage: "Idioma del contenido",
    maxDuration: "Duración máxima", level: "Nivel", beginner: "Inicial", intermediate: "Intermedio", advanced: "Avanzado", recommended: "recomendado", objective: "Objetivo de aprendizaje", source: "Fuente", sourceHint: "pega tu texto o apuntes", sourcePlaceholder: "Pega aquí una lección de al menos 300 caracteres…", chooseFile: "Arrastra un archivo aquí o elige uno", formats: "Formatos: .txt, .md · Hasta 2 MB", provider: "Proveedor", configured: "configurado", missingConfig: "falta configuración", providerHint: "OpenAI permite crear una lección desde tu texto y generar su narración. La demo sigue disponible sin clave.", openAiSetupTitle: "Activar OpenAI", openAiSetupBody: "La clave se configura una sola vez en el servidor; nunca se pega ni se guarda en el navegador.", openAiSetupCopy: "Copia .env.example como .env.local.", openAiSetupKey: "Añade tu clave en OPENAI_API_KEY.", openAiSetupRestart: "Reinicia Materia para detectar la configuración.", openAiSetupScope: "Habilita generación directa de texto y narración TTS. La transcripción de micrófono todavía no está incluida.", openAiConfiguredBody: "La creación directa y la narración OpenAI están disponibles. Cada generación requiere una acción explícita.", generating: "Generación en curso…", generate: "Generar lección", privacy: "Solo este botón puede usar OpenAI. Las solicitudes idénticas reutilizan la lección guardada.", processing: "Estamos dando forma a tu lección", sending: "Enviando la solicitud al servidor…", statusHint: "Puedes comprobar el mismo estado en /api/generation.",
  } : {
    library: "Library", newLesson: "New lesson", demoMode: "Demo mode · no cost", openaiReady: "OpenAI · configured",
    hero: "Learn at your own pace", heroBody: "Turn a source into a clear, chapter-based lesson connected to its evidence.", create: "Create a lesson", tryDemo: "Try the sample lesson",
    yourCourses: "Your courses", continueLearning: "Continue learning", looseLessons: "Standalone lessons", yourLibrary: "Your library", noLessons: "No saved lessons yet.", lastFailed: "The last generation failed",
    emptyTitle: "Start with a source you want to understand", emptyBody: "Paste your notes or try the networking lesson. Everything stays on this device.", loadExample: "Load the example",
    lesson: "Lesson", duration: "Duration", chapters: "Chapters", state: "Status", updated: "Activity", complete: "Completed", ready: "Ready to study", delete: "Delete", searchCourses: "Search courses", searchPlaceholder: "Title, topic, or description…", filterCourses: "Filter courses", all: "All", published: "Published", validated: "In review", drafts: "Drafts", active: "In progress", completed: "Completed", noCourses: "No courses match this search.", previous: "Previous", next: "Next", preparationHint: "All courses are shown. Use the filter to view only published, in-review, draft, in-progress, or completed courses.", showAllLessons: "Show all", showFewerLessons: "Show fewer",
    panelIntro: "Choose between researched course authoring and direct conversion.", close: "Close", creationMode: "Creation method", agentMode: "Agent and MCP", agentModeHint: "Recommended for courses and certifications", directMode: "Direct with OpenAI", directModeHint: "Fast for a single source",
    traceable: "Traceable authoring", agentTitle: "Let your agent build the course", agentBody: "Codex, Claude, or another MCP-compatible client can research several sources, write the content, and save it directly in Materia. The app validates the result and never generates audio automatically.",
    step1: "Open this repository with your agent.", step1Body: "In Codex, the connection is already declared in .codex/config.toml.", step2: "Check Materia MCP.", step2Body: "In other clients, register the mcp script as an STDIO server. Tools use the materia_ prefix.", step3: "Describe your goal once.", step3Body: "The agent will research, import a draft, and ask before publishing or generating audio.",
    topic: "Certification or topic", preparedPrompt: "Prepared prompt", copied: "Prompt copied", copyPrompt: "Copy prompt for my agent", noBrowserModels: "This method does not call models or TTS from the browser.", contentLanguage: "Content language",
    maxDuration: "Maximum duration", level: "Level", beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", recommended: "recommended", objective: "Learning objective", source: "Source", sourceHint: "paste text or notes", sourcePlaceholder: "Paste a lesson of at least 300 characters…", chooseFile: "Drop a file here or choose one", formats: "Formats: .txt, .md · Up to 2 MB", provider: "Provider", configured: "configured", missingConfig: "not configured", providerHint: "OpenAI can turn your text into a lesson and generate its narration. The demo remains available without a key.", openAiSetupTitle: "Enable OpenAI", openAiSetupBody: "Configure the key once on the server; it is never pasted into or stored by the browser.", openAiSetupCopy: "Copy .env.example to .env.local.", openAiSetupKey: "Add your key as OPENAI_API_KEY.", openAiSetupRestart: "Restart Materia so it detects the configuration.", openAiSetupScope: "Enables direct text generation and TTS narration. Microphone transcription is not included yet.", openAiConfiguredBody: "Direct lesson creation and OpenAI narration are available. Every generation still requires an explicit action.", generating: "Generation in progress…", generate: "Generate lesson", privacy: "Only this button can call OpenAI. Identical requests reuse the saved lesson.", processing: "Shaping your lesson", sending: "Sending the request to the server…", statusHint: "You can inspect the same state at /api/generation.",
  };
  const router = useRouter();
  const [lessons, setLessons] = useState(initialLessons);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode>("agent");
  const [agentTopic, setAgentTopic] = useState("");
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage>("en-US");
  const [promptCopied, setPromptCopied] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("notas.txt");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [courseQuery, setCourseQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("all");
  const [coursePage, setCoursePage] = useState(1);
  const [showAllLessons, setShowAllLessons] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const generationPendingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { beginTask, endTask } = useAbortableTasks();
  const generationBusy = isGenerating || generationStatus?.state === "running";
  const normalizedCourseQuery = courseQuery.trim().toLocaleLowerCase(locale);
  const courseMatchesFilter = (course: CourseSummary) => {
    const complete = course.totalChapterCount > 0 && course.completedChapterCount === course.totalChapterCount;
    if (courseFilter === "active") return course.status === "published" && course.hasStudyActivity && !complete;
    if (courseFilter === "completed") return course.status === "published" && complete;
    if (courseFilter !== "all" && course.status !== courseFilter) return false;
    return true;
  };
  const filteredCourses = initialCourses.filter((course) => courseMatchesFilter(course) && (!normalizedCourseQuery || `${course.title} ${course.summary}`.toLocaleLowerCase(locale).includes(normalizedCourseQuery)));
  const coursePageCount = Math.max(1, Math.ceil(filteredCourses.length / COURSES_PER_PAGE));
  const visibleCourses = filteredCourses.slice((coursePage - 1) * COURSES_PER_PAGE, coursePage * COURSES_PER_PAGE);
  const continuingCourses = initialCourses.filter((course) => course.status === "published" && course.hasStudyActivity && course.completedChapterCount < course.totalChapterCount).sort((a, b) => (b.lastStudiedAt || "").localeCompare(a.lastStudiedAt || "")).slice(0, 3);
  const visibleLessons = showAllLessons ? lessons : lessons.slice(0, 10);
  const agentPrompt = spanish
    ? `Quiero preparar ${agentTopic.trim() ? `«${agentTopic.trim()}»` : "una certificación o tema técnico"}. Usa la skill build-materia-course (en Codex: $build-materia-course) y redacta todo el contenido en ${contentLanguageName(contentLanguage, "es")}. Investiga fuentes públicas y primarias, acuerda conmigo la profundidad y diseña la cobertura según la complejidad real del temario. Usa Materia MCP (herramientas con prefijo materia_) para crear un curso trazable en borrador. Tras guardar cada lección, vuelve a leerla desde Materia y revisa su suficiencia didáctica, evidencia, variedad estructural y fluidez oral; corrígela antes de continuar si resulta superficial o repetitiva. No fuerces una cantidad fija de módulos, capítulos o bloques. Valida el curso antes de publicarlo y no generes audio sin mi autorización explícita.`
    : `I want to prepare ${agentTopic.trim() ? `“${agentTopic.trim()}”` : "a certification or technical topic"}. Use the build-materia-course skill (in Codex: $build-materia-course) and write all course content in ${contentLanguageName(contentLanguage, "en")}. Research public primary sources, agree the learning depth with me, and design coverage around the actual complexity of the subject. Use Materia MCP (tools use the materia_ prefix) to create a traceable draft course. After saving each lesson, read it back from Materia and audit its teaching sufficiency, evidence, structural variety, and oral flow; revise it before continuing if it is thin or repetitive. Do not force a fixed number of modules, chapters, or blocks. Validate the course before publishing it, and do not generate audio without my explicit authorization.`;

  useEffect(() => {
    const controller = beginTask();
    async function refreshGenerationStatus() {
      try {
        const response = await fetch("/api/generation", { cache: "no-store", signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;
        const payload = await response.json() as { text: GenerationStatus };
        if (!controller.signal.aborted) setGenerationStatus(payload.text);
      } catch (error) { if (!isAbortError(error)) setGenerationStatus(null); }
    }
    void (async () => {
      while (!controller.signal.aborted) {
        await refreshGenerationStatus();
        await abortableDelay(2000, controller.signal).catch(() => {});
      }
    })().finally(() => endTask(controller));
    return () => { controller.abort(); endTask(controller); };
  }, [beginTask, endTask]);

  useEffect(() => {
    if (!panelOpen) return;
    panelRef.current?.querySelector<HTMLElement>("[data-panel-autofocus]")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelOpen(false);
        window.requestAnimationFrame(() => previousFocusRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [panelOpen]);

  function openPanel() {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  async function createLesson(payload: FormData) {
    if (generationPendingRef.current) return;
    generationPendingRef.current = true;
    setIsGenerating(true);
    try {
      setError(null);
      const response = await fetch("/api/lessons", { method: "POST", body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.issues?.join(" ") || data.error || (spanish ? "No se pudo crear la lección." : "The lesson could not be created."));
      router.push(`/lessons/${data.lesson.id}`);
    } finally {
      generationPendingRef.current = false;
      setIsGenerating(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("sourceText", sourceText);
    form.set("sourceName", sourceName);
    if (file) form.set("file", file);
    void createLesson(form).catch((reason) => setError(reason.message));
  }

  function createDemo() {
    const existingDemo = lessons.find((lesson) => lesson.origin === "demo");
    if (existingDemo) {
      router.push(`/lessons/${existingDemo.id}`);
      return;
    }
    void (async () => {
    const source = await fetch(`/api/demo-source?locale=${locale}`).then((response) => response.json());
      const form = new FormData();
      form.set("sourceName", source.name); form.set("sourceText", source.text); form.set("durationMinutes", "15");
      form.set("level", "intermediate"); form.set("objective", spanish ? "Comprender cómo viaja un paquete y diagnosticar fallos básicos de red." : "Understand how a packet travels and diagnose basic network failures."); form.set("provider", "demo"); form.set("contentLanguage", spanish ? "es-ES" : "en-US");
      await createLesson(form);
    })().catch((reason) => setError(reason.message));
  }

  function chooseFile(selected: File | null) {
    if (!selected) return;
    setFile(selected); setSourceName(selected.name); setError(null);
    selected.text().then(setSourceText).catch(() => setError(spanish ? "No se pudo leer el archivo." : "The file could not be read."));
  }

  async function copyAgentPrompt() {
    try {
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(agentPrompt); }
        catch { copyTextFallback(agentPrompt); }
      } else {
        copyTextFallback(agentPrompt);
      }
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1800);
    } catch {
      setPromptCopied(false);
    }
  }

  async function removeLesson(id: string) {
    if (!window.confirm(spanish ? "¿Borrar esta lección y su progreso local?" : "Delete this lesson and its local progress?")) return;
    setRemovingId(id); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/lessons/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || (spanish ? "No se pudo borrar la lección." : "The lesson could not be deleted."));
      }
      setLessons((current) => current.filter((lesson) => lesson.id !== id));
      setNotice(spanish ? "Lección eliminada del almacenamiento local." : "Lesson deleted from local storage.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : spanish ? "No se pudo borrar la lección." : "The lesson could not be deleted.");
    } finally {
      setRemovingId(null);
    }
  }

  return <main className="home-shell">
    <header className="topbar">
      <Link className="brand" href="/"><WaveMark size={31}/>Materia</Link>
      <nav aria-label={spanish ? "Navegación principal" : "Primary navigation"}>
        <a className="nav-link is-active" href="#library"><BookIcon />{copy.library}</a>
        <button className="nav-link" onClick={openPanel}><PlusIcon />{copy.newLesson}</button>
      </nav>
      <LocaleSwitcher />
      <div className="provider-state"><span />{providerStatus.defaultProvider === "demo" ? copy.demoMode : copy.openaiReady}</div>
    </header>

    <section className="hero-section">
      <div className="hero-copy">
        <h1>{copy.hero}</h1>
        <p>{copy.heroBody}</p>
        <div className="hero-actions">
          <button className="button button-primary" onClick={openPanel}><PlusIcon />{copy.create}</button>
          <button className="button button-secondary" onClick={createDemo} disabled={generationBusy}><PlayIcon />{copy.tryDemo}</button>
        </div>
      </div>
      <div className="chapter-motif" aria-label={spanish ? "Una lección organizada en capítulos de extensión variable" : "A lesson organized into chapters of varying length"}>
        <div className="chapter-nodes">{[1, 2, 3, 4, 5].map((n) => <span className={n === 2 ? "is-current" : ""} key={n}>{n}</span>)}</div>
        <Waveform active={21} bars={48} />
      </div>
    </section>

    <section className="library-section" id="library">
      {notice ? <p className="library-notice" role="status">{notice}</p> : null}
      {generationStatus?.state === "running" ? <p className="generation-notice" role="status"><span className="generation-pulse" />{PHASE_LABELS[locale][generationStatus.phase]}{generationStatus.sourceName ? ` · ${generationStatus.sourceName}` : ""}</p> : null}
      {generationStatus?.state === "failed" && generationStatus.error ? <p className="library-error" role="alert">{copy.lastFailed}: {generationStatus.error}</p> : null}
      {error && !panelOpen ? <p className="library-error" role="alert">{error}</p> : null}
      {continuingCourses.length > 0 ? <div className="continue-library"><div className="section-heading"><h2>{copy.continueLearning}</h2><p>{continuingCourses.length} {spanish ? continuingCourses.length === 1 ? "curso reciente" : "cursos recientes" : continuingCourses.length === 1 ? "recent course" : "recent courses"}</p></div><div className="course-grid course-grid-featured">{continuingCourses.map((course) => <CourseCard course={course} spanish={spanish} key={course.id}/>)}</div></div> : null}
      {initialCourses.length > 0 ? <div className="course-library"><div className="section-heading"><h2>{copy.yourCourses}</h2><p>{initialCourses.length} {spanish ? initialCourses.length === 1 ? "curso local" : "cursos locales" : initialCourses.length === 1 ? "local course" : "local courses"}</p></div>
        <div className="library-toolbar"><label><span className="visually-hidden">{copy.searchCourses}</span><input type="search" value={courseQuery} onChange={(event) => { setCourseQuery(event.target.value); setCoursePage(1); }} placeholder={copy.searchPlaceholder}/></label><label><span className="visually-hidden">{copy.filterCourses}</span><select value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value as CourseFilter); setCoursePage(1); }}><option value="all">{copy.all}</option><option value="published">{copy.published}</option><option value="active">{copy.active}</option><option value="completed">{copy.completed}</option><option value="validated">{copy.validated}</option><option value="draft">{copy.drafts}</option></select></label></div>
        <p className="library-explanation">{copy.preparationHint}</p>
        {visibleCourses.length > 0 ? <div className="course-grid">{visibleCourses.map((course) => <CourseCard course={course} spanish={spanish} key={course.id}/>)}</div> : <div className="library-empty-filter" role="status">{copy.noCourses}</div>}
        {coursePageCount > 1 ? <nav className="library-pagination" aria-label={spanish ? "Paginación de cursos" : "Course pagination"}><button type="button" onClick={() => setCoursePage((page) => Math.max(1, page - 1))} disabled={coursePage === 1}>{copy.previous}</button><span>{coursePage} / {coursePageCount}</span><button type="button" onClick={() => setCoursePage((page) => Math.min(coursePageCount, page + 1))} disabled={coursePage === coursePageCount}>{copy.next}</button></nav> : null}
      </div> : null}
      {lessons.length > 0 ? <div className="standalone-library"><div className="section-heading"><h2>{copy.looseLessons}</h2><p>{lessons.length} {spanish ? lessons.length === 1 ? "lección independiente" : "lecciones independientes" : lessons.length === 1 ? "standalone lesson" : "standalone lessons"}</p></div><div className="lesson-table" role="table" aria-label={spanish ? "Lecciones independientes" : "Standalone lessons"}>
        <div className="lesson-table-head" role="row"><span>{copy.lesson}</span><span>{copy.duration}</span><span>{copy.chapters}</span><span>{copy.state}</span><span>{copy.updated}</span><span /></div>
        {visibleLessons.map((lesson) => <div className="lesson-row" role="row" key={lesson.id}>
          <Link href={`/lessons/${lesson.id}`} className="lesson-title-cell"><span className="lesson-emblem"><WaveMark size={30}/></span><span><strong>{lesson.title}</strong><small>{lesson.summary}</small></span></Link>
          <span>{lesson.durationMinutes} min</span><span>{lesson.chapterCount} {spanish ? "capítulos" : lesson.chapterCount === 1 ? "chapter" : "chapters"}</span>
          <span className="ready-state"><i />{lesson.completedCount === lesson.chapterCount ? copy.complete : copy.ready}</span>
          <span>{shortDate(lesson.updatedAt, locale)}</span>
          <button className="delete-action" onClick={() => removeLesson(lesson.id)} disabled={removingId === lesson.id} aria-label={`${copy.delete} ${lesson.title}`}>{removingId === lesson.id ? <span className="deleting-indicator" aria-hidden="true" /> : <TrashIcon />}</button>
        </div>)}
        {lessons.length > 10 ? <button type="button" className="show-lessons" onClick={() => setShowAllLessons((value) => !value)}>{showAllLessons ? copy.showFewerLessons : copy.showAllLessons}</button> : null}
      </div></div> : null}
      {initialCourses.length === 0 && lessons.length === 0 ? <div className="empty-library"><WaveMark size={46}/><h3>{copy.emptyTitle}</h3><p>{copy.emptyBody}</p><button className="text-action" onClick={createDemo}>{copy.loadExample} <ArrowIcon /></button></div> : null}
    </section>

    <div className={`panel-backdrop ${panelOpen ? "is-open" : ""}`} onClick={closePanel} />
    <aside ref={panelRef} className={`create-panel ${panelOpen ? "is-open" : ""}`} inert={!panelOpen} aria-hidden={!panelOpen} role="dialog" aria-modal="true" aria-labelledby="create-panel-title">
      <div className="panel-header"><div><h2 id="create-panel-title">{copy.newLesson}</h2><p>{copy.panelIntro}</p></div><button data-panel-autofocus className="panel-close" onClick={closePanel} aria-label={copy.close}>×</button></div>
      <div className="creation-mode-switch" aria-label={copy.creationMode}>
        <button type="button" className={creationMode === "agent" ? "is-active" : ""} aria-pressed={creationMode === "agent"} onClick={() => setCreationMode("agent")}><strong>{copy.agentMode}</strong><small>{copy.agentModeHint}</small></button>
        <button type="button" className={creationMode === "openai" ? "is-active" : ""} aria-pressed={creationMode === "openai"} onClick={() => setCreationMode("openai")}><strong>{copy.directMode}</strong><small>{copy.directModeHint}</small></button>
      </div>
      {creationMode === "agent" ? <section className="agent-create-guide">
        <span className="mode-kicker">{copy.traceable}</span>
        <h3>{copy.agentTitle}</h3>
        <p>{copy.agentBody}</p>
        <ol>
          <li><span>1</span><p><strong>{copy.step1}</strong> {copy.step1Body}</p></li>
          <li><span>2</span><p><strong>{copy.step2}</strong> {copy.step2Body}</p></li>
          <li><span>3</span><p><strong>{copy.step3}</strong> {copy.step3Body}</p></li>
        </ol>
        <label>{copy.topic}<input value={agentTopic} onChange={(event) => { setAgentTopic(event.target.value); setPromptCopied(false); }} placeholder="GitHub Certified: Agentic AI Developer" /></label>
        <label>{copy.contentLanguage}<select value={contentLanguage} onChange={(event) => { setContentLanguage(event.target.value as ContentLanguage); setPromptCopied(false); }}>{CONTENT_LANGUAGES.map((language) => <option key={language} value={language}>{contentLanguageName(language, locale)}</option>)}</select></label>
        <label>{copy.preparedPrompt}<textarea className="agent-prompt" value={agentPrompt} readOnly /></label>
        <button type="button" className="button button-primary copy-prompt" onClick={copyAgentPrompt}>{promptCopied ? copy.copied : copy.copyPrompt}<ArrowIcon /></button>
        <small className="agent-boundary">{copy.noBrowserModels}</small>
      </section> : <form onSubmit={submit}>
        <div className="form-grid">
          <label>{copy.maxDuration}<select name="durationMinutes" defaultValue="8"><option value="5">5 min</option><option value="8">8 min · {copy.recommended}</option><option value="10">10 min</option><option value="15">15 min</option></select></label>
          <label>{copy.level}<select name="level" defaultValue="intermediate"><option value="beginner">{copy.beginner}</option><option value="intermediate">{copy.intermediate}</option><option value="advanced">{copy.advanced}</option></select></label>
        </div>
        <label>{copy.contentLanguage}<select name="contentLanguage" value={contentLanguage} onChange={(event) => setContentLanguage(event.target.value as ContentLanguage)}>{CONTENT_LANGUAGES.map((language) => <option key={language} value={language}>{contentLanguageName(language, locale)}</option>)}</select></label>
        <label>{copy.objective}<input name="objective" defaultValue={spanish ? "Comprender las ideas clave y poder explicarlas con mis propias palabras." : "Understand the key ideas and explain them in my own words."} minLength={10} maxLength={500} required /></label>
        <label>{copy.source} <span>({copy.sourceHint})</span><textarea value={sourceText} onChange={(event) => { setSourceText(event.target.value); setFile(null); }} placeholder={copy.sourcePlaceholder} minLength={300} maxLength={80000} required /></label>
        <button type="button" className="dropzone" onClick={() => fileRef.current?.click()}><UploadIcon /><span>{file ? file.name : copy.chooseFile}<small>{copy.formats}</small></span></button>
        <input ref={fileRef} className="visually-hidden" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
        <input type="hidden" name="provider" value="openai" />
        <div className="provider-choice"><strong>{copy.provider}</strong><span>OpenAI · {providerStatus.openai.configured ? copy.configured : copy.missingConfig}</span><small>{copy.providerHint}</small></div>
        {providerStatus.openai.configured ? <section className="provider-ready" aria-label={copy.openAiSetupTitle}><strong>OpenAI</strong><p>{copy.openAiConfiguredBody}</p></section> : <section className="provider-setup" aria-label={copy.openAiSetupTitle}>
          <strong>{copy.openAiSetupTitle}</strong><p>{copy.openAiSetupBody}</p>
          <ol><li>{copy.openAiSetupCopy}</li><li>{copy.openAiSetupKey}</li><li>{copy.openAiSetupRestart}</li></ol>
          <small>{copy.openAiSetupScope}</small>
        </section>}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-primary generate-button" disabled={generationBusy || !providerStatus.openai.configured}>{generationBusy ? copy.generating : <>{copy.generate} <ArrowIcon /></>}</button>
        <p className="privacy-note">{copy.privacy}</p>
      </form>}
    </aside>
    {isGenerating ? <div className="processing" role="status"><WaveMark size={54}/><h2>{copy.processing}</h2><p>{generationStatus?.state === "running" ? PHASE_LABELS[locale][generationStatus.phase] : copy.sending}</p><small>{copy.statusHint}</small><Waveform active={28} bars={44}/></div> : null}
  </main>;
}
