import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export type RunType = "tournament" | "benchmark" | "hybrid-sweep";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface RunRecord {
  schemaVersion: 1;
  id: string;
  type: RunType;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  config: Record<string, unknown>;
  configHash: string;
  benchmarkCommit?: string;
  artifactDir: string;
  liveUrl?: string;
  replayUrl?: string;
  pid?: number;
  exitCode?: number;
  error?: string;
}

export interface RunArtifact {
  path: string;
  bytes: number;
  modifiedAt: string;
}

type ClearableRunKey = "startedAt" | "finishedAt" | "liveUrl" | "replayUrl" | "pid" | "exitCode" | "error";
type RunPatch = { status?: RunStatus } & { [Key in ClearableRunKey]?: RunRecord[Key] | undefined };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function runId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `run_${stamp}_${randomUUID().slice(0, 8)}`;
}

function assertRunId(id: string): void {
  if (!/^run_[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid run ID");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function listFiles(root: string, directory: string): Promise<RunArtifact[]> {
  if (!await exists(directory)) return [];
  const artifacts: RunArtifact[] = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...await listFiles(root, path));
      continue;
    }
    if (!entry.isFile()) continue;
    let details;
    try { details = await stat(path); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    artifacts.push({
      path: relative(root, path).split("\\").join("/"),
      bytes: details.size,
      modifiedAt: details.mtime.toISOString(),
    });
  }
  return artifacts;
}

export class RunStore {
  readonly root: string;
  private readonly now: () => Date;

  constructor(root = "results/runs", now: () => Date = () => new Date()) {
    this.root = resolve(root);
    this.now = now;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  directory(id: string): string {
    assertRunId(id);
    return join(this.root, id);
  }

  artifactDirectory(id: string): string {
    return join(this.directory(id), "artifacts");
  }

  logPath(id: string, stream: "stdout" | "stderr"): string {
    return join(this.directory(id), `${stream}.log`);
  }

  async create(type: RunType, config: Record<string, unknown>, benchmarkCommit?: string): Promise<RunRecord> {
    await this.init();
    const id = runId(this.now());
    const directory = this.directory(id);
    const artifactDir = this.artifactDirectory(id);
    await mkdir(artifactDir, { recursive: true });
    const record: RunRecord = {
      schemaVersion: 1,
      id,
      type,
      status: "queued",
      createdAt: this.now().toISOString(),
      config: structuredClone(config),
      configHash: createHash("sha256").update(canonical(config)).digest("hex"),
      ...(benchmarkCommit ? { benchmarkCommit } : {}),
      artifactDir,
    };
    await this.write(record);
    return record;
  }

  async get(id: string): Promise<RunRecord> {
    const path = join(this.directory(id), "run.json");
    const value = JSON.parse(await readFile(path, "utf8")) as RunRecord;
    if (value.id !== id || value.schemaVersion !== 1) throw new Error(`invalid run metadata for ${id}`);
    return value;
  }

  async list(): Promise<RunRecord[]> {
    await this.init();
    const records: RunRecord[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("run_")) continue;
      try {
        records.push(await this.get(entry.name));
      } catch {
        // A partially written or user-managed directory is not a run.
      }
    }
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async update(id: string, patch: RunPatch): Promise<RunRecord> {
    const current = await this.get(id);
    const next = { ...current } as RunRecord & Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    await this.write(next);
    return next;
  }

  async recoverInterrupted(): Promise<void> {
    for (const run of await this.list()) {
      if (run.status !== "queued" && run.status !== "running") continue;
      await this.update(run.id, {
        status: "failed",
        finishedAt: this.now().toISOString(),
        error: "The Web UI process stopped before this run reached a terminal state.",
        pid: undefined,
        liveUrl: undefined,
      });
    }
  }

  async artifacts(id: string): Promise<RunArtifact[]> {
    return (await listFiles(this.artifactDirectory(id), this.artifactDirectory(id)))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async readArtifact(id: string, requestedPath: string): Promise<Buffer> {
    const root = this.artifactDirectory(id);
    const target = resolve(root, requestedPath);
    const pathFromRoot = relative(root, target);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("invalid artifact path");
    return readFile(target);
  }

  async result(id: string): Promise<unknown | undefined> {
    const run = await this.get(id);
    const candidates = run.type === "tournament"
      ? ["tournament.json"]
      : run.type === "benchmark"
        ? ["report.json"]
        : ["hybrid-sweep.json"];
    for (const candidate of candidates) {
      try {
        return JSON.parse(await readFile(join(run.artifactDir, candidate), "utf8"));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
    }
    return undefined;
  }

  private async write(record: RunRecord): Promise<void> {
    const directory = this.directory(record.id);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "run.json");
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }
}
