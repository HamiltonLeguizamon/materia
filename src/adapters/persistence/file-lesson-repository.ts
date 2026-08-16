import { mkdir, open, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { materiaDataRoot } from "@/config/environment";
import { randomUUID } from "node:crypto";

import { withFileLease, writeDurableJson } from "@/adapters/persistence/file-system-utils";
import type { LessonRepository } from "@/application/ports";
import { getMp3DurationSeconds } from "@/domain/audio";
import { audioMatchesCurrentNarration, chapterIdSchema, lessonSchema, migrateLesson, type Lesson } from "@/domain/teaching";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertLessonId(id: string): void {
  if (!uuidPattern.test(id)) throw new Error("Invalid lesson ID.");
}

export class FileLessonRepository implements LessonRepository {
  constructor(private readonly root = materiaDataRoot()) {}

  private lessonsDir() { return path.join(this.root, "lessons"); }
  private lessonPath(id: string) { assertLessonId(id); return path.join(this.lessonsDir(), `${id}.json`); }

  private async ensure(): Promise<void> {
    await mkdir(this.lessonsDir(), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, "audio"), { recursive: true, mode: 0o700 });
  }

  async list(): Promise<Lesson[]> {
    await this.ensure();
    const names = (await readdir(this.lessonsDir())).filter((name) => name.endsWith(".json"));
    const lessons = (await Promise.all(names.map((name) => this.get(name.slice(0, -5))))).filter((lesson): lesson is Lesson => lesson !== null);
    return lessons.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async findReusable(input: Parameters<LessonRepository["findReusable"]>[0]): Promise<Lesson | null> {
    const lessons = await this.list();
    return lessons.find((lesson) => {
      const sameInput = lesson.planProvider === input.provider
        && lesson.source.kind === "local-text"
        && lesson.source.name === input.sourceName
        && lesson.source.text === input.sourceText
        && lesson.preferences.durationMinutes === input.durationMinutes
        && lesson.preferences.level === input.level
        && lesson.preferences.objective === input.objective;
      const audioComplete = lesson.plan.chapters.every((chapter) => audioMatchesCurrentNarration(lesson.audioByChapter[chapter.id]));
      return sameInput && lesson.status === "ready" && audioComplete;
    }) || null;
  }

  async get(id: string): Promise<Lesson | null> {
    await this.ensure();
    const lesson = await this.readStored(id);
    return lesson ? this.reconcileAudioFiles(lesson) : null;
  }

  async save(lesson: Lesson, expectedRevision?: number, options?: { pruneAudio?: boolean }): Promise<void> {
    const validated = lessonSchema.parse(lesson);
    await this.ensure();
    const action = async () => {
      if (expectedRevision !== undefined) {
        const current = await this.readStored(validated.id);
        if (!current) throw new Error("The lesson does not exist.");
        if (current.revision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, but the lesson is at ${current.revision}.`);
        if (validated.revision !== expectedRevision + 1) throw new Error("The new revision must advance by exactly one.");
      }
      await writeDurableJson(this.lessonPath(validated.id), validated);
      if (options?.pruneAudio !== false) await this.pruneUnreferencedAudio(validated);
    };
    if (expectedRevision === undefined) return action();
    await withFileLease(this.root, `lesson-${validated.id}`, action);
  }

  async restore(lessonId: string, lesson: Lesson | null): Promise<void> {
    assertLessonId(lessonId);
    await this.ensure();
    await withFileLease(this.root, `lesson-${lessonId}`, async () => {
      if (lesson === null) {
        await rm(this.lessonPath(lessonId), { force: true });
        await rm(path.join(this.root, "audio", lessonId), { recursive: true, force: true });
        return;
      }
      const validated = lessonSchema.parse(lesson);
      if (validated.id !== lessonId) throw new Error("The recovery snapshot belongs to a different lesson.");
      await writeDurableJson(this.lessonPath(lessonId), validated);
      await this.pruneUnreferencedAudio(validated);
    });
  }

  async pruneAudio(lesson: Lesson): Promise<void> {
    await this.pruneUnreferencedAudio(lessonSchema.parse(lesson));
  }

  async delete(id: string): Promise<boolean> {
    await this.ensure();
    const lessonPath = this.lessonPath(id);
    try {
      await rm(lessonPath);
      await rm(path.join(this.root, "audio", id), { recursive: true, force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async saveAudio(lessonId: string, chapterId: string, bytes: Uint8Array): Promise<string> {
    assertLessonId(lessonId);
    if (!chapterIdSchema.safeParse(chapterId).success) throw new Error("Invalid chapter ID.");
    const directory = path.join(this.root, "audio", lessonId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, `${chapterId}.mp3`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, destination);
    return `/api/lessons/${lessonId}/audio/${chapterId}`;
  }

  private async pruneUnreferencedAudio(lesson: Lesson): Promise<void> {
    const directory = path.join(this.root, "audio", lesson.id);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    const chapterIds = new Set(lesson.plan.chapters.map((chapter) => chapter.id));
    const retainedFiles = new Set(Object.entries(lesson.audioByChapter)
      .filter(([chapterId, artifact]) => chapterIds.has(chapterId) && artifact.status === "ready" && artifact.kind === "file")
      .map(([chapterId]) => `${chapterId}.mp3`));

    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mp3") && !retainedFiles.has(entry.name))
      .map((entry) => rm(path.join(directory, entry.name))));
  }

  async deleteAudio(lessonId: string, chapterId: string): Promise<void> {
    assertLessonId(lessonId);
    if (!chapterIdSchema.safeParse(chapterId).success) throw new Error("Invalid chapter ID.");
    const directory = path.join(this.root, "audio", lessonId);
    await rm(path.join(directory, `${chapterId}.mp3`), { force: true });
    try { await rmdir(directory); } catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
    }
  }

  private async readStored(id: string): Promise<Lesson | null> {
    try { return migrateLesson(JSON.parse(await readFile(this.lessonPath(id), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  private async reconcileAudioFiles(lesson: Lesson): Promise<Lesson> {
    const repaired: string[] = [];
    await Promise.all(Object.entries(lesson.audioByChapter).map(async ([chapterId, artifact]) => {
      if (artifact.kind !== "file" || artifact.status !== "ready") return;
      const filePath = path.join(this.root, "audio", lesson.id, `${chapterId}.mp3`);
      try {
        const handle = await open(filePath, "r");
        let bytes: Uint8Array;
        try {
          const details = await handle.stat();
          const length = artifact.durationSeconds ? Math.min(details.size, 1024 * 1024) : details.size;
          bytes = new Uint8Array(length);
          await handle.read(bytes, 0, length, 0);
        } finally { await handle.close(); }
        const duration = getMp3DurationSeconds(bytes);
        if (!duration) throw new Error("MP3_INVALID");
        if (!artifact.durationSeconds) {
          artifact.durationSeconds = duration;
          repaired.push(chapterId);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && !(error instanceof Error && error.message === "MP3_INVALID")) throw error;
        lesson.audioByChapter[chapterId] = {
          ...artifact,
          status: "failed",
          kind: null,
          url: null,
          mimeType: null,
          durationSeconds: null,
          error: code === "ENOENT" ? "The local audio file no longer exists. Generate it again." : "The local audio file is not a valid MP3. Generate it again.",
        };
        repaired.push(chapterId);
        if (code !== "ENOENT") await rm(filePath, { force: true });
      }
    }));
    if (repaired.length > 0) {
      await withFileLease(this.root, `lesson-${lesson.id}`, async () => {
        const current = await this.readStored(lesson.id);
        if (!current || current.revision !== lesson.revision) return;
        for (const chapterId of repaired) {
          if (current.audioByChapter[chapterId]?.status === "ready" && current.audioByChapter[chapterId]?.kind === "file") {
            current.audioByChapter[chapterId] = lesson.audioByChapter[chapterId];
          }
        }
        await writeDurableJson(this.lessonPath(current.id), lessonSchema.parse(current));
      });
    }
    return lesson;
  }
}

export function resolveAudioPath(lessonId: string, chapterId: string): string {
  assertLessonId(lessonId);
  if (!chapterIdSchema.safeParse(chapterId).success) throw new Error("Invalid chapter ID.");
  const root = materiaDataRoot();
  return path.join(root, "audio", lessonId, `${chapterId}.mp3`);
}
