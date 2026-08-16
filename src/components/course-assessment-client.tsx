"use client";

import { useState, useTransition } from "react";

import type { Course, CourseStudyProgress } from "@/domain/course";
import { useLocale } from "@/i18n/locale-context";

export function CourseAssessmentClient({ course, initialProgress }: { course: Course; initialProgress: CourseStudyProgress }) {
  const spanish = useLocale() === "es";
  const [progress, setProgress] = useState(initialProgress);
  const [selected, setSelected] = useState<Record<string, number>>(() => Object.fromEntries(Object.entries(initialProgress.answers).map(([id, answer]) => [id, answer.option])));
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  if (course.assessments.length === 0) return null;

  function answer(assessmentId: string, questionId: string) {
    const option = selected[questionId];
    if (!Number.isInteger(option)) return;
    startTransition(async () => {
      const response = await fetch(`/api/courses/${course.id}/progress`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assessmentId, questionId, option, expectedRevision: progress.revision }) });
      const payload = await response.json();
      if (!response.ok) {
        setMessages((current) => ({ ...current, [questionId]: payload.error || (spanish ? "No se pudo guardar la respuesta." : "The answer could not be saved.") }));
        if (response.status === 409) {
          const refreshed = await fetch(`/api/courses/${course.id}/progress`, { cache: "no-store" });
          if (refreshed.ok) setProgress((await refreshed.json()).progress);
        }
        return;
      }
      setProgress(payload.progress);
      setMessages((current) => ({ ...current, [questionId]: `${spanish ? payload.result.correct ? "Correcto." : "Revisa esta respuesta." : payload.result.correct ? "Correct." : "Review this answer."} ${payload.result.explanation}` }));
    });
  }

  return <section className="course-assessments" aria-labelledby="course-assessments-title">
    <h2 id="course-assessments-title">{spanish ? "Evaluaciones" : "Assessments"}</h2><p>{spanish ? "Las respuestas se corrigen y guardan localmente, sin llamadas a modelos." : "Answers are checked and saved locally, without model calls."}</p>
    {course.assessments.map((assessment) => <article className="course-assessment" key={assessment.id}><h3>{assessment.title}</h3>
      {assessment.questions.map((question, questionIndex) => { const stored = progress.answers[question.id]; return <fieldset key={question.id}><legend>{questionIndex + 1}. {question.prompt}</legend>
        <div className="course-answer-options">{question.options.map((option, optionIndex) => <label key={option}><input type="radio" name={question.id} checked={selected[question.id] === optionIndex} onChange={() => { setSelected((current) => ({ ...current, [question.id]: optionIndex })); setMessages((current) => ({ ...current, [question.id]: "" })); }}/><span>{option}</span></label>)}</div>
        <button onClick={() => answer(assessment.id, question.id)} disabled={pending || !Number.isInteger(selected[question.id])}>{spanish ? "Comprobar y guardar" : "Check and save"}</button>
        {messages[question.id] ? <p className={progress.answers[question.id]?.correct ? "assessment-feedback is-correct" : "assessment-feedback"} role="status">{messages[question.id]}</p> : stored ? <p className={stored.correct ? "assessment-feedback is-correct" : "assessment-feedback"}>{spanish ? `Respuesta guardada: ${stored.correct ? "correcta" : "pendiente de revisión"}.` : `Saved answer: ${stored.correct ? "correct" : "needs review"}.`}</p> : null}
      </fieldset>; })}
    </article>)}
  </section>;
}
