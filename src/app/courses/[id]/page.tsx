import Link from "next/link";
import { notFound } from "next/navigation";
import { BackIcon, CheckIcon, WaveMark } from "@/components/icons";
import { CourseAssessmentClient } from "@/components/course-assessment-client";
import { CourseAudioControls } from "@/components/course-audio-controls";
import { CourseEditorialControls } from "@/components/course-editorial-controls";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getProviderStatus } from "@/config/server";
import { audioMatchesCurrentNarration } from "@/domain/teaching";
import { getRequestLocale } from "@/i18n/server";
import { courseRepository, courseStudyService, lessonRepository } from "@/server/container";

export const dynamic = "force-dynamic";
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const spanish = locale === "es";
  const course = await courseRepository.get((await params).id); if (!course) notFound();
  const lessonEntries = await Promise.all(course.modules.flatMap((module) => module.lessonIds.map(async (lessonId) => [lessonId, await lessonRepository.get(lessonId)] as const)));
  const studyProgress = await courseStudyService.getProgress(course.id), lessons = new Map(lessonEntries);
  const covered = course.coverage.filter((entry) => entry.status === "covered").length, partial = course.coverage.filter((entry) => entry.status === "partial").length, missing = course.coverage.filter((entry) => entry.status === "missing").length;
  return <main className="course-shell">
    <header className="course-header"><div className="course-brand-row"><Link className="brand" href="/"><WaveMark size={31}/>Materia</Link><LocaleSwitcher /></div><Link className="back-link" href="/"><BackIcon />{spanish ? "Biblioteca" : "Library"}</Link><span className={`course-status status-${course.status}`}>{spanish ? course.status === "draft" ? "Borrador del agente" : course.status === "validated" ? "Curso validado" : "Curso publicado" : course.status === "draft" ? "Agent draft" : course.status === "validated" ? "Validated course" : "Published course"}</span><h1>{course.title}</h1><p>{course.summary}</p><div className="course-facts"><span>{course.modules.length} {spanish ? course.modules.length === 1 ? "módulo" : "módulos" : course.modules.length === 1 ? "module" : "modules"}</span><span>{lessonEntries.length} {spanish ? lessonEntries.length === 1 ? "lección" : "lecciones" : lessonEntries.length === 1 ? "lesson" : "lessons"}</span><span>{spanish ? `${covered > 0 ? `${covered} cubiertos · ` : ""}${partial} parciales · ${missing} pendientes` : `${covered > 0 ? `${covered} covered · ` : ""}${partial} partial · ${missing} pending`}</span><span>{spanish ? "Revisión" : "Revision"} {course.revision}</span></div><CourseEditorialControls courseId={course.id} revision={course.revision} status={course.status}/></header>
    <section className="course-content"><div className="course-modules"><CourseAudioControls courseId={course.id} revision={course.revision} openAiAvailable={getProviderStatus().openai.configured} contentLanguage={course.language}/><h2>{spanish ? "Temario" : "Curriculum"}</h2>{[...course.modules].sort((a, b) => a.position - b.position).map((module) => <article className="module-card" key={module.id}><span>{spanish ? "Módulo" : "Module"} {module.position}</span><h3>{module.title}</h3><p>{module.summary}</p><ol>{module.lessonIds.map((lessonId) => { const lesson = lessons.get(lessonId); return lesson ? <li key={lessonId}><Link href={`/lessons/${lessonId}`}><WaveMark size={24}/><span><strong>{lesson.plan.title}</strong><small>{lesson.plan.chapters.length} {spanish ? "capítulos" : lesson.plan.chapters.length === 1 ? "chapter" : "chapters"} · audio {Object.values(lesson.audioByChapter).filter(audioMatchesCurrentNarration).length}/{lesson.plan.chapters.length}</small></span></Link></li> : <li key={lessonId}>{spanish ? "Lección no disponible" : "Lesson unavailable"}</li>; })}</ol></article>)}<CourseAssessmentClient course={course} initialProgress={studyProgress}/></div>
      <aside className="course-context"><section><h2>{spanish ? "Cobertura" : "Coverage"}</h2>{course.coverage.map((entry) => { const objective = course.objectives.find((item) => item.id === entry.objectiveId); return <div className="coverage-row" key={entry.objectiveId}><span className={`coverage-dot is-${entry.status}`}>{entry.status === "covered" ? <CheckIcon/> : null}</span><div><strong>{objective?.title || entry.objectiveId}</strong><small>{spanish ? entry.status === "covered" ? "Cubierto" : entry.status === "partial" ? "Cobertura parcial" : "Pendiente" : entry.status === "covered" ? "Covered" : entry.status === "partial" ? "Partial coverage" : "Pending"}</small></div></div>; })}</section><section><h2>{spanish ? "Fuentes" : "Sources"}</h2>{course.sources.map((source) => <a className="course-source" href={source.url} target="_blank" rel="noreferrer" key={source.id}><strong>{source.title}</strong><small>{source.publisher}</small></a>)}</section></aside>
    </section>
  </main>;
}
