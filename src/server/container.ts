import "server-only";

import { DemoSpeechProvider, DemoTeachingPlanProvider } from "@/adapters/demo/demo-providers";
import { OpenAISpeechRuntimeProvider, OpenAITeachingPlanRuntimeProvider } from "@/adapters/openai/openai-runtime-providers";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { FileAudioBatchJobRepository, FileAudioJobRepository, FileCourseCleanupRepository, FileCourseProgressRepository, FileCourseRepository, FileOperationRepository } from "@/adapters/persistence/file-course-repository";
import { FileCoursePersistenceUnitOfWork } from "@/adapters/persistence/file-course-unit-of-work";
import { FileAudioAdmissionCoordinator } from "@/adapters/persistence/file-audio-admission-coordinator";
import { assertSpeechProviderAvailable, createSpeechProvider } from "@/adapters/speech/speech-provider-factory";
import { CourseService } from "@/application/course-service";
import { CourseStudyService } from "@/application/course-study-service";
import { SelectiveAudioService } from "@/application/selective-audio-service";
import { AudioBatchService } from "@/application/audio-batch-service";
import { AudioActivityRegistry } from "@/application/audio-generation-status";
import { createGenerationRegistry, type GenerationRegistry } from "@/application/generation-status";
import { LessonGenerationCoordinator } from "@/application/lesson-generation-coordinator";
import { LessonService } from "@/application/lesson-service";
import { LessonStudyService } from "@/application/lesson-study-service";

export const lessonRepository = new FileLessonRepository();
export const lessonStudyService = new LessonStudyService(lessonRepository);
export const courseRepository = new FileCourseRepository();
export const operationRepository = new FileOperationRepository();
const courseCleanupRepository = new FileCourseCleanupRepository();
export const courseService = new CourseService(courseRepository, lessonRepository, operationRepository, courseCleanupRepository, new FileCoursePersistenceUnitOfWork(courseRepository, lessonRepository, undefined, courseCleanupRepository));
export const courseStudyService = new CourseStudyService(courseRepository, new FileCourseProgressRepository());
export const audioJobRepository = new FileAudioJobRepository();

const audioActivityRegistryKey = Symbol.for("materia.audio-activity-registry");
const audioRuntimeGlobal = globalThis as typeof globalThis & { [audioActivityRegistryKey]?: AudioActivityRegistry };
export const audioActivityRegistry = audioRuntimeGlobal[audioActivityRegistryKey] ||= new AudioActivityRegistry();

const audioAdmissionCoordinator = new FileAudioAdmissionCoordinator();
export const selectiveAudioService = new SelectiveAudioService(lessonRepository, audioJobRepository, operationRepository, createSpeechProvider, audioActivityRegistry, audioAdmissionCoordinator, assertSpeechProviderAvailable);
export const audioBatchService = new AudioBatchService(courseRepository, lessonRepository, new FileAudioBatchJobRepository(), selectiveAudioService, audioActivityRegistry);

const generationRegistryKey = Symbol.for("materia.generation-registry");
const runtimeGlobal = globalThis as typeof globalThis & { [generationRegistryKey]?: GenerationRegistry };
const generationRegistry = runtimeGlobal[generationRegistryKey] ||= createGenerationRegistry();

export function lessonService(provider: "demo" | "openai") {
  return provider === "openai"
    ? new LessonService(lessonRepository, new OpenAITeachingPlanRuntimeProvider(), new OpenAISpeechRuntimeProvider(), "openai")
    : new LessonService(lessonRepository, new DemoTeachingPlanProvider(), new DemoSpeechProvider(), "demo");
}

export const lessonGeneration = new LessonGenerationCoordinator(lessonRepository, lessonService, generationRegistry);
