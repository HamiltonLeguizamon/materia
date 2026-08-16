import { getProviderStatus } from "@/config/server";
import { courseRepository, lessonRepository } from "@/server/container";
import { HomeClient } from "@/components/home-client";
import { lessonAudioMinutes } from "@/domain/teaching";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const lessons = await lessonRepository.list();
  const courses = await courseRepository.list();
  const summaries = lessons.filter((lesson) => lesson.source.kind === "local-text").map((lesson) => ({
    id: lesson.id, title: lesson.plan.title, summary: lesson.plan.summary, durationMinutes: lessonAudioMinutes(lesson) || lesson.preferences.durationMinutes,
    chapterCount: lesson.plan.chapters.length, status: lesson.status, origin: lesson.origin,
    completedCount: lesson.progress.completedChapterIds.length, updatedAt: lesson.updatedAt,
  }));
  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const courseSummaries = courses.map((course) => {
    const courseLessons = course.modules.flatMap((module) => module.lessonIds).map((id) => lessonsById.get(id)).filter((lesson) => lesson !== undefined);
    const totalChapterCount = courseLessons.reduce((total, lesson) => total + lesson.plan.chapters.length, 0);
    const completedChapterCount = courseLessons.reduce((total, lesson) => total + lesson.progress.completedChapterIds.length, 0);
    const hasStudyActivity = courseLessons.some((lesson) => lesson.progress.completedChapterIds.length > 0 || lesson.progress.updatedAt !== lesson.createdAt);
    const lastStudiedAt = hasStudyActivity ? courseLessons.reduce((latest, lesson) => lesson.progress.updatedAt > latest ? lesson.progress.updatedAt : latest, course.createdAt) : null;
    return {
      id: course.id, title: course.title, summary: course.summary, status: course.status, moduleCount: course.modules.length,
      lessonCount: course.modules.reduce((total, item) => total + item.lessonIds.length, 0), contentUpdatedAt: course.updatedAt,
      totalChapterCount, completedChapterCount, hasStudyActivity, lastStudiedAt,
    };
  });
  return <HomeClient initialLessons={summaries} initialCourses={courseSummaries} providerStatus={getProviderStatus()} />;
}
