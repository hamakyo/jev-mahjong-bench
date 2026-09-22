import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createModelRegistry } from "../providers/registry.js";
import { webDashboardCss, webDashboardHtml, webDashboardJs } from "./dashboard.js";
import { RunManager, type CreateRunInput } from "./run-manager.js";
import { buildRunComparison } from "./research.js";

export interface WebServerOptions {
  manager: RunManager;
  host?: string;
  port?: number;
  projectRoot?: string;
}

export interface WebServer {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  listen(): Promise<number>;
  close(): Promise<void>;
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

function commonHeaders(contentType: string, length: number): Record<string, string | number> {
  return {
    "Content-Type": contentType,
    "Content-Length": length,
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
  };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, commonHeaders("application/json; charset=utf-8", Buffer.byteLength(body)));
  response.end(body);
}

function text(response: ServerResponse, contentType: string, body: string): void {
  response.writeHead(200, commonHeaders(contentType, Buffer.byteLength(body)));
  response.end(body);
}

function binary(response: ServerResponse, contentType: string, body: Buffer): void {
  response.writeHead(200, commonHeaders(contentType, body.byteLength));
  response.end(body);
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 1_048_576) {
      const error = new Error("request body is too large") as Error & { statusCode?: number };
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

function contentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".json" || extension === ".jsonl") return "application/json; charset=utf-8";
  if (extension === ".md" || extension === ".log" || extension === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function datasets(projectRoot: string): Promise<Array<{ path: string; bytes: number }>> {
  const root = join(projectRoot, "datasets");
  try {
    const result: Array<{ path: string; bytes: number }> = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(root, entry.name);
      result.push({ path: `datasets/${entry.name}`, bytes: (await stat(path)).size });
    }
    return result.sort((left, right) => left.path.localeCompare(right.path));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function proxyLive(request: IncomingMessage, response: ServerResponse, liveUrl: string, path: string, search: string): Promise<void> {
  const target = new URL(path + search, liveUrl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("close", abort);
  try {
    const lastEventId = request.headers["last-event-id"];
    const upstream = await fetch(target, {
      method: request.method ?? "GET",
      signal: controller.signal,
      ...(typeof lastEventId === "string" ? { headers: { "Last-Event-ID": lastEventId } } : {}),
    });
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      ...(upstream.headers.get("x-accel-buffering") ? { "X-Accel-Buffering": upstream.headers.get("x-accel-buffering")! } : {}),
    });
    if (!upstream.body) {
      response.end();
      return;
    }
    const reader = upstream.body.getReader();
    while (!response.writableEnded) {
      const chunk = await reader.read();
      if (chunk.done) break;
      response.write(Buffer.from(chunk.value));
    }
    if (!response.writableEnded) response.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    throw error;
  } finally {
    request.off("close", abort);
  }
}

export function createWebServer(options: WebServerOptions): WebServer {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3_001;
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("web server port must be an integer from 0 to 65535");
  const server = createServer((request, response) => {
    void handle(request, response, options.manager, projectRoot).catch((error: unknown) => {
      if (response.headersSent) return response.destroy(error instanceof Error ? error : undefined);
      const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? 404 : 400;
      json(response, status, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  let actualPort = port;
  return {
    server,
    host,
    get port() { return actualPort; },
    listen: () => new Promise<number>((resolvePromise, reject) => {
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("web server did not expose a TCP address"));
        actualPort = address.port;
        resolvePromise(actualPort);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    }),
    close: async () => {
      await options.manager.close();
      if (!server.listening) return;
      server.closeAllConnections?.();
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    },
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, manager: RunManager, projectRoot: string): Promise<void> {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "POST") return json(response, 405, { error: "method not allowed" });
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/new" || url.pathname === "/compare" || /^\/runs\/[^/]+$/.test(url.pathname)) {
    return text(response, "text/html; charset=utf-8", webDashboardHtml);
  }
  if (url.pathname === "/assets/web.js") return text(response, "text/javascript; charset=utf-8", webDashboardJs);
  if (url.pathname === "/assets/web.css") return text(response, "text/css; charset=utf-8", webDashboardCss);
  if (url.pathname === "/api/health") return json(response, 200, { ok: true });
  if (url.pathname === "/api/models") {
    const registry = createModelRegistry();
    const models = [...registry.models.values()].map((model) => ({
      id: model.id,
      provider: model.provider,
      model: model.model,
      configured: Boolean(process.env[model.apiKeyEnv]),
      apiKeyEnv: model.apiKeyEnv,
      fingerprint: model.fingerprint,
    }));
    return json(response, 200, { registryHash: registry.hash, models });
  }
  if (url.pathname === "/api/datasets") return json(response, 200, await datasets(projectRoot));
  if (url.pathname === "/api/runs/compare") {
    if (method !== "GET") return json(response, 405, { error: "method not allowed" });
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error("compare run IDs must be unique");
    const inputs = await Promise.all(ids.map(async (id) => ({ run: await manager.store.get(id), result: await manager.store.result(id) })));
    return json(response, 200, buildRunComparison(inputs));
  }
  if (url.pathname === "/api/runs") {
    if (method === "GET") return json(response, 200, await manager.store.list());
    const input = await body(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("run input must be an object");
    return json(response, 202, await manager.start(input as CreateRunInput));
  }
  const liveMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/(snapshot|events|control(?:\/(?:pause|resume|step))?)$/);
  if (liveMatch) {
    const id = decodeURIComponent(liveMatch[1]!);
    const resource = liveMatch[2]!;
    const isMutation = resource !== "snapshot" && resource !== "events" && resource !== "control";
    if ((isMutation && method !== "POST") || (!isMutation && method !== "GET")) return json(response, 405, { error: "method not allowed" });
    const run = await manager.store.get(id);
    if (!run.liveUrl || run.status !== "running") return json(response, 409, { error: "live view is not available for this run" });
    const upstreamPath = resource === "snapshot" ? "/api/snapshot" : resource === "events" ? "/api/events" : `/api/${resource}`;
    await proxyLive(request, response, run.liveUrl, upstreamPath, url.search);
    return;
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(cancel|replay|report|artifacts|artifact|games))?$/);
  if (!runMatch) return json(response, 404, { error: "not found" });
  const id = decodeURIComponent(runMatch[1]!);
  const action = runMatch[2];
  if (!action && method === "GET") {
    const [run, artifacts, result] = await Promise.all([manager.store.get(id), manager.store.artifacts(id), manager.store.result(id)]);
    return json(response, 200, { run, artifacts, ...(result === undefined ? {} : { result }) });
  }
  if (action === "cancel" && method === "POST") return json(response, 200, await manager.cancel(id));
  if (action === "replay" && method === "POST") return json(response, 200, { url: await manager.startReplay(id) });
  if (action === "report" && method === "GET") {
    const result = await manager.store.result(id);
    return result === undefined ? json(response, 404, { error: "result is not available" }) : json(response, 200, result);
  }
  if (action === "artifacts" && method === "GET") return json(response, 200, await manager.store.artifacts(id));
  if (action === "artifact" && method === "GET") {
    const path = url.searchParams.get("path");
    if (!path) throw new Error("artifact path is required");
    return binary(response, contentType(path), await manager.store.readArtifact(id, path));
  }
  if (action === "games" && method === "GET") {
    try {
      const raw = (await manager.store.readArtifact(id, "games.jsonl")).toString("utf8");
      return json(response, 200, raw.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return json(response, 200, []);
      throw error;
    }
  }
  return json(response, 405, { error: "method not allowed" });
}
