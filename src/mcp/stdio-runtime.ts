import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { FileAudioJobRepository, FileCourseCleanupRepository, FileCourseRepository, FileOperationRepository } from "@/adapters/persistence/file-course-repository";
import { FileCoursePersistenceUnitOfWork } from "@/adapters/persistence/file-course-unit-of-work";
import { FileAudioAdmissionCoordinator } from "@/adapters/persistence/file-audio-admission-coordinator";
import { FileLessonRepository } from "@/adapters/persistence/file-lesson-repository";
import { assertSpeechProviderAvailable, createSpeechProvider } from "@/adapters/speech/speech-provider-factory";
import { CourseService } from "@/application/course-service";
import { SelectiveAudioService } from "@/application/selective-audio-service";
import { createMateriaMcpServer } from "@/mcp/server";

const lessons = new FileLessonRepository();
const operations = new FileOperationRepository();
const courses = new FileCourseRepository();
const cleanup = new FileCourseCleanupRepository();
const courseService = new CourseService(courses, lessons, operations, cleanup, new FileCoursePersistenceUnitOfWork(courses, lessons, undefined, cleanup));
const audioService = new SelectiveAudioService(lessons, new FileAudioJobRepository(), operations, createSpeechProvider, undefined, new FileAudioAdmissionCoordinator(), assertSpeechProviderAvailable);
const handle = serveStdio(() => createMateriaMcpServer(courseService, audioService));
process.on("SIGINT", () => { void handle.close(); });
