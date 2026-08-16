import { notFound } from "next/navigation";

import { StudyClient } from "@/components/study-client";
import { getProviderStatus } from "@/config/server";
import { courseRepository, lessonRepository } from "@/server/container";

export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lesson = await lessonRepository.get(id);
  if (!lesson) notFound();
  const course = lesson.source.kind === "course-sources" ? await courseRepository.get(lesson.source.courseId) : null;
  const sources = course?.sources.filter((source) => lesson.source.kind === "course-sources" && lesson.source.sourceIds.includes(source.id)) || [];
  const providers = getProviderStatus();
  return <StudyClient initialLesson={lesson} courseSources={sources} speechAvailability={{ openai: providers.openai.configured, kokoro: providers.kokoro.configured, qwen: providers.qwen.configured }} />;
}
