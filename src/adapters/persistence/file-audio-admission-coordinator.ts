import { materiaDataRoot } from "@/config/environment";

import { acquireFileLease } from "@/adapters/persistence/file-system-utils";
import type { AudioAdmissionCoordinator, AudioAdmissionLease } from "@/application/ports";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class FileAudioAdmissionCoordinator implements AudioAdmissionCoordinator {
  constructor(private readonly root = materiaDataRoot()) {}

  async acquire(lessonIds: string[]): Promise<AudioAdmissionLease> {
    const ids = [...new Set(lessonIds)].sort();
    if (ids.length === 0 || ids.some((id) => !uuidPattern.test(id))) throw new Error("The audio reservation contains an invalid lesson.");
    const releases: Array<() => Promise<void>> = [];
    try {
      for (const id of ids) releases.push(await acquireFileLease(this.root, `audio-lesson-${id}`, 1));
    } catch {
      await Promise.all(releases.reverse().map((release) => release()));
      throw new Error("An audio operation is already active for one of these lessons.");
    }
    let released = false;
    return {
      lessonIds: new Set(ids),
      release: async () => {
        if (released) return;
        released = true;
        await Promise.all(releases.reverse().map((release) => release()));
      },
    };
  }
}
