import path from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export function materiaDataRoot(environment: Environment = process.env): string {
  return environment.MATERIA_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
}
