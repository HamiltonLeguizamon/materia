"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useLocale } from "@/i18n/locale-context";

export function CourseEditorialControls({ courseId, revision, status }: { courseId: string; revision: number; status: "draft" | "validated" | "published" }) {
  const spanish = useLocale() === "es";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  if (status === "published") return <p className="editorial-state">{spanish ? "Este curso ya está publicado en tu biblioteca local." : "This course is published in your local library."}</p>;

  function mutate(action: "validate" | "publish") {
    if (action === "publish" && !window.confirm(spanish ? "¿Publicar esta revisión del curso? La publicación no genera audio ni realiza llamadas a OpenAI." : "Publish this course revision? Publishing does not generate audio or call OpenAI.")) return;
    startTransition(async () => {
      setMessage(null);
      const response = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, operationId: `${action}:${courseId}:${revision}`, expectedRevision: revision, confirmed: action === "publish" }),
      });
      const payload = await response.json();
      if (!response.ok) { setMessage(payload.error || (spanish ? "No se pudo actualizar el curso." : "The course could not be updated.")); return; }
      setMessage(spanish ? action === "validate" ? "Curso validado." : "Curso publicado. La generación de audio sigue siendo independiente." : action === "validate" ? "Course validated." : "Course published. Audio generation remains a separate action.");
      router.refresh();
    });
  }

  return <div className="course-editorial-controls">
    <div><strong>{spanish ? status === "draft" ? "Revisión editorial pendiente" : "Revisión validada" : status === "draft" ? "Editorial review pending" : "Revision validated"}</strong><small>{spanish ? status === "draft" ? "Valida estructura y procedencia antes de publicar." : "Publicar no genera audio ni consume OpenAI." : status === "draft" ? "Validate structure and provenance before publishing." : "Publishing does not generate audio or use OpenAI."}</small></div>
    <button type="button" onClick={() => mutate(status === "draft" ? "validate" : "publish")} disabled={pending}>{spanish ? pending ? "Procesando…" : status === "draft" ? "Validar curso" : "Publicar curso" : pending ? "Processing…" : status === "draft" ? "Validate course" : "Publish course"}</button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
