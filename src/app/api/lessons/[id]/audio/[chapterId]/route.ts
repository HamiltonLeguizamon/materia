import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { resolveAudioPath } from "@/adapters/persistence/file-lesson-repository";
import { selectiveAudioService } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

type AudioContext = { params: Promise<{ id: string; chapterId: string }> };

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function audioHeaders(contentLength: number): HeadersInit {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Length": String(contentLength),
    "Content-Type": "audio/mpeg",
  };
}

function audioStream(filePath: string, start?: number, end?: number): BodyInit {
  const stream = createReadStream(filePath, start === undefined ? undefined : { start, end });
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, context: AudioContext) {
  try {
    const { id, chapterId } = await context.params;
    const filePath = resolveAudioPath(id, chapterId);
    const file = await stat(filePath);
    const rangeHeader = request.headers.get("range");
    if (!rangeHeader) {
      return new Response(audioStream(filePath), { headers: audioHeaders(file.size) });
    }
    const range = parseRange(rangeHeader, file.size);
    if (!range) {
      return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${file.size}` } });
    }
    return new Response(audioStream(filePath, range.start, range.end), {
      status: 206,
      headers: { ...audioHeaders(range.end - range.start + 1), "Content-Range": `bytes ${range.start}-${range.end}/${file.size}` },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "The audio does not exist." }, { status: 404 });
    return errorResponse(error);
  }
}

export async function HEAD(_request: Request, context: AudioContext) {
  try {
    const { id, chapterId } = await context.params;
    const file = await stat(resolveAudioPath(id, chapterId));
    return new Response(null, { headers: audioHeaders(file.size) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "The audio does not exist." }, { status: 404 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: AudioContext) {
  try {
    const { id, chapterId } = await context.params;
    const body = await request.json() as { expectedLessonRevision?: number; confirmed?: boolean };
    const lesson = await selectiveAudioService.deleteChapterAudio({
      lessonId: id,
      chapterId,
      expectedLessonRevision: Number(body.expectedLessonRevision),
      confirmed: body.confirmed === true,
    });
    return Response.json({ lesson });
  } catch (error) { return errorResponse(error); }
}
