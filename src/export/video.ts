import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../live/dashboard/i18n.js";
import { createReplayServer } from "../replay/server.js";
import { loadReplay } from "../replay/loader.js";
import { ReplayTimeline } from "../replay/timeline.js";

export interface VideoExportOptions {
  input: string;
  gameId: string;
  from?: number;
  to?: number;
  format: "mp4" | "webm";
  fps: number;
  speed: number;
  out: string;
  locale: Locale;
  debug?: boolean;
  viewport?: { width: number; height: number };
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(command + " exited with code " + (code ?? "unknown") + ": " + stderr.trim()));
    });
  });
}

async function sourceSha256(input: string): Promise<string> {
  const directory = resolve(input, "replay");
  const hash = createHash("sha256");
  for (const name of ["manifest.json", "index.json", "events.jsonl", "checkpoints.jsonl"]) {
    hash.update(await readFile(join(directory, name)));
  }
  return hash.digest("hex");
}

function durationMs(type: string, speed: number): number {
  const base = type === "game:start" ? 500
    : type === "game:end" || type === "tournament:end" ? 1_000
      : type === "start_kyoku" || type === "end_kyoku" ? 350
        : type === "decision:end" ? 100
          : 150;
  return base / speed;
}

function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.round(duration * fps / 1_000));
}

async function loadPlaywright(): Promise<any> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  try {
    return await dynamicImport("playwright");
  } catch {
    throw new Error("video export requires the Playwright package and an installed Chromium browser");
  }
}

function toolError(command: string, error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT") return new Error(`video export requires ${command} on PATH`);
  return error instanceof Error ? error : new Error(String(error));
}

export function gameRange(timeline: ReplayTimeline, gameId: string, from: number | undefined, to: number | undefined): { from: number; to: number } {
  const game = timeline.data.index.games.find((entry) => entry.gameId === gameId);
  if (!game) throw new Error("unknown replay game ID: " + gameId);
  const start = from ?? game.startSequence;
  const nextGame = timeline.data.index.games
    .filter((entry) => entry.startSequence > game.startSequence)
    .sort((left, right) => left.startSequence - right.startSequence)[0];
  const gameEnd = game.endSequence ?? (nextGame ? nextGame.startSequence - 1 : timeline.eventCount);
  const end = to ?? gameEnd;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < game.startSequence || end < start || end > gameEnd) {
    throw new Error("video event range is outside the selected game");
  }
  return { from: start, to: end };
}

export async function exportReplayVideo(options: VideoExportOptions): Promise<void> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  if (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > 120) throw new Error("fps must be from 1 to 120");
  if (!Number.isFinite(options.speed) || options.speed <= 0) throw new Error("speed must be positive");
  if (!options.out) throw new Error("video output is required");
  if (options.format !== "mp4" && options.format !== "webm") throw new Error("format must be mp4 or webm");
  if (!isLocale(locale)) throw new Error("locale must be en or ja");

  let ffmpegVersion: CommandResult;
  try {
    ffmpegVersion = await runCommand("ffmpeg", ["-version"]);
  } catch (error) {
    throw toolError("ffmpeg", error);
  }
  try {
    await runCommand("ffprobe", ["-version"]);
  } catch (error) {
    throw toolError("ffprobe", error);
  }
  const playwright = await loadPlaywright();
  const data = await loadReplay(options.input);
  const timeline = new ReplayTimeline(data);
  const range = gameRange(timeline, options.gameId, options.from, options.to);
  const viewport = options.viewport ?? { width: 1280, height: 900 };
  const temporary = await mkdtemp(join(tmpdir(), "jev-mahjong-video-"));
  const server = createReplayServer({ timeline, port: 0 });
  let browser: any;
  try {
    const port = await server.listen();
    try {
      browser = await playwright.chromium.launch({ headless: true });
    } catch (error) {
      throw new Error("video export requires an installed Chromium browser; run `pnpm exec playwright install chromium`", { cause: error });
    }
    const page = await browser.newPage({ viewport });
    const events = timeline.events(range.from, range.to, options.debug ? "debug" : "spectator");
    let frame = 0;
    for (const event of events) {
      const type = event.event.type === "mjai" && event.event.event && typeof event.event.event === "object"
        ? String((event.event.event as Record<string, unknown>).type ?? "mjai")
        : event.event.type;
      const frames = frameCount(durationMs(type, options.speed), options.fps);
      await page.goto("http://127.0.0.1:" + port + "/?mode=" + (options.debug ? "debug" : "spectator") + "&locale=" + encodeURIComponent(locale) + "&cursor=" + event.id, { waitUntil: "networkidle" });
      await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
      await page.evaluate(async () => {
        await Promise.all(Array.from(document.images).map((image) => typeof image.decode === "function" ? image.decode().catch(() => undefined) : Promise.resolve()));
      });
      for (let index = 0; index < frames; index += 1) {
        frame += 1;
        await page.screenshot({ path: join(temporary, String(frame).padStart(8, "0") + ".png") });
      }
    }
    const output = resolve(options.out);
    await mkdir(dirname(output), { recursive: true });
    const inputPattern = join(temporary, "%08d.png");
    const ffmpegArgs = options.format === "mp4"
      ? ["-y", "-framerate", String(options.fps), "-i", inputPattern, "-c:v", "libx264", "-pix_fmt", "yuv420p", output]
      : ["-y", "-framerate", String(options.fps), "-i", inputPattern, "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", output];
    try {
      await runCommand("ffmpeg", ffmpegArgs);
    } catch (error) {
      throw toolError("ffmpeg", error);
    }
    try {
      await runCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output]);
    } catch (error) {
      throw toolError("ffprobe", error);
    }
    const videoHash = createHash("sha256").update(await readFile(output)).digest("hex");
    const metadata = {
      schemaVersion: 2,
      sourceArtifactSha256: await sourceSha256(options.input),
      gameId: options.gameId,
      seed: data.manifest.games.find((game) => game.gameId === options.gameId)?.seed,
      from: range.from,
      to: range.to,
      mode: options.debug ? "debug" : "spectator",
      locale,
      fps: options.fps,
      speed: options.speed,
      viewport,
      format: options.format,
      codec: options.format === "mp4" ? "libx264" : "libvpx-vp9",
      frameCount: frame,
      ffmpegVersion: ffmpegVersion.stdout.split("\n")[0],
      chromiumVersion: typeof browser.version === "function" ? browser.version() : undefined,
      videoSha256: videoHash,
      output: basename(output),
    };
    await writeFile(output + ".json", JSON.stringify(metadata, null, 2) + "\n", "utf8");
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
  }
}
