import type { CreateLessonInput, Lesson, TeachingPlan } from "@/domain/teaching";
import type { Course, CourseStudyProgress } from "@/domain/course";

export interface TeachingPlanProvider {
  createPlan(input: CreateLessonInput): Promise<TeachingPlan>;
}

export type GeneratedAudio =
  | { kind: "browser-speech"; mimeType: "application/x-browser-speech" }
  | { kind: "bytes"; mimeType: "audio/mpeg"; bytes: Uint8Array; durationSeconds: number | null; chunkCount: number };

export interface SpeechProvider {
  readonly profileKey: string;
  readonly profile: SpeechProfile;
  synthesize(
    input: { lessonTitle: string; chapterTitle: string; narration: string },
    recovery?: {
      remoteJobId?: string;
      onRemoteSubmissionStarted?: () => Promise<void>;
      onRemoteAccepted?: (remoteJobId: string) => Promise<void>;
      onRemoteRejected?: () => Promise<void>;
    },
  ): Promise<GeneratedAudio>;
}

export type SpeechProviderId = "demo" | "openai" | "kokoro" | "qwen" | "chatterbox";
export type SpeechLanguage = "es" | "en-us" | "en-gb";
export type SpeechStyle = "neutral" | "serious" | "warm";
export type SpeechPronunciation = "literal" | "technical-es";
export type SpeechProfile = {
  provider: SpeechProviderId;
  nodeId: string | null;
  voice: string;
  speed: number;
  language: SpeechLanguage;
  style: SpeechStyle;
  pronunciation: SpeechPronunciation;
};

export interface LessonRepository {
  list(): Promise<Lesson[]>;
  findReusable(input: CreateLessonInput): Promise<Lesson | null>;
  get(id: string): Promise<Lesson | null>;
  save(lesson: Lesson, expectedRevision?: number, options?: { pruneAudio?: boolean }): Promise<void>;
  delete(id: string): Promise<boolean>;
  saveAudio(lessonId: string, chapterId: string, bytes: Uint8Array): Promise<string>;
  deleteAudio(lessonId: string, chapterId: string): Promise<void>;
  restore(lessonId: string, lesson: Lesson | null): Promise<void>;
  pruneAudio(lesson: Lesson): Promise<void>;
}

export interface CourseRepository {
  list(): Promise<Course[]>;
  get(id: string): Promise<Course | null>;
  create(course: Course): Promise<void>;
  save(course: Course, expectedRevision: number): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface CourseProgressRepository {
  get(courseId: string): Promise<CourseStudyProgress | null>;
  save(progress: CourseStudyProgress, expectedRevision: number): Promise<void>;
}

export type OperationClaim =
  | { state: "claimed" }
  | { state: "completed"; result: unknown }
  | { state: "running" };

export interface OperationRepository {
  claim(input: { operationId: string; kind: string; fingerprint: string }): Promise<OperationClaim>;
  complete(operationId: string, result: unknown): Promise<void>;
  release(operationId: string): Promise<void>;
}

export interface AudioJobRepository {
  get(id: string): Promise<AudioJob | null>;
  findByOperationId(operationId: string): Promise<AudioJob | null>;
  save(job: AudioJob): Promise<void>;
}

export interface AudioBatchJobRepository {
  get(id: string): Promise<AudioBatchJob | null>;
  save(job: AudioBatchJob): Promise<void>;
}

export interface AudioAdmissionLease {
  readonly lessonIds: ReadonlySet<string>;
  release(): Promise<void>;
}

export interface AudioAdmissionCoordinator {
  acquire(lessonIds: string[]): Promise<AudioAdmissionLease>;
}

export interface CourseCleanupRepository {
  deleteRelated(courseId: string, lessonIds: string[]): Promise<void>;
}

export interface CoursePersistenceUnitOfWork {
  recover(): Promise<void>;
  saveCourseAndLesson(input: {
    operationId: string;
    beforeCourse: Course;
    afterCourse: Course;
    beforeLesson: Lesson | null;
    afterLesson: Lesson;
  }): Promise<void>;
  deleteCourse(input: {
    course: Course;
    lessons: Lesson[];
    cleanup?: CourseCleanupRepository;
  }): Promise<void>;
}

export type AudioJob = {
  schemaVersion: 1;
  id: string;
  operationId: string;
  lessonId: string;
  expectedLessonRevision: number;
  chapterIds: string[];
  provider: SpeechProviderId;
  profileKey: string;
  profile: SpeechProfile;
  state: "queued" | "running" | "completed" | "failed" | "interrupted" | "unknown";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  lessonRevision: number | null;
  runtimeId?: string;
  ownerPid?: number;
  remoteSubmissionState?: "not-started" | "submitting" | "accepted";
  remoteJobId?: string | null;
  remoteChapterId?: string | null;
};

export type AudioBatchJob = {
  schemaVersion: 1;
  id: string;
  scope: "lesson" | "course";
  courseId: string | null;
  lessonIds: string[];
  provider: SpeechProviderId;
  profile: SpeechProfile;
  profileKey: string;
  state: "queued" | "running" | "completed" | "failed" | "interrupted";
  totalChapters: number;
  completedChapters: number;
  currentLessonId: string | null;
  currentChapterId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  runtimeId?: string;
  ownerPid?: number;
};
