const allowedExtensions = new Set([".txt", ".md"]);

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function validateSourceFile(name: string, size: number): void {
  const normalized = name.toLowerCase();
  const extension = normalized.slice(normalized.lastIndexOf("."));
  if (!allowedExtensions.has(extension)) {
    throw new Error("Solo se admiten archivos .txt y .md.");
  }
  if (size > MAX_FILE_BYTES) {
    throw new Error("The file exceeds the 2 MB limit.");
  }
}

export function safeDisplayName(name: string): string {
  return name.replace(/[\\/\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "Untitled source";
}
