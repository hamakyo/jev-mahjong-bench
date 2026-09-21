import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dashboardCss, dashboardHtml, dashboardJs } from "./dashboard/index.js";
import { LiveEventHub, type LiveResetEvent, type LiveSubscriber } from "./hub.js";
import { SnapshotStore } from "./snapshot.js";
import type { DebugLiveEvent, LiveMode, PublicLiveEvent, SequencedLiveEvent } from "./events.js";
import type { TournamentControl } from "./control.js";

export interface LiveServerOptions {
  hub: LiveEventHub;
  snapshots: SnapshotStore;
  control?: TournamentControl;
  host?: string;
  port?: number;
}

export interface LiveServer {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  listen(): Promise<number>;
  close(): Promise<void>;
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

function validMode(value: string | null): LiveMode {
  if (value === "debug") return "debug";
  if (value === "spectator" || value === null || value === "") return "spectator";
  throw new Error("mode must be spectator or debug");
}

function parseAfter(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("after must be a non-negative integer");
  return parsed;
}

function headerAfter(request: IncomingMessage): number | undefined {
  const value = request.headers["last-event-id"];
  if (Array.isArray(value)) return parseAfter(value[0] ?? null);
  return parseAfter(value ?? null);
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
  });
  response.end(body);
}

function textResponse(response: ServerResponse, contentType: string, body: string): void {
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
  });
  response.end(body);
}

function sseWrite(response: ServerResponse, event: SequencedLiveEvent<PublicLiveEvent | DebugLiveEvent>): boolean {
  return response.write(
    `id: ${event.id}\nevent: ${event.event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

function sseReset(response: ServerResponse, event: LiveResetEvent): boolean {
  return response.write(`event: reset\ndata: ${JSON.stringify(event)}\n\n`);
}

export function createLiveServer(options: LiveServerOptions): LiveServer {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3_000;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("live server port must be an integer from 0 to 65535");
  const server = createServer((request, response) => {
    void handleRequest(request, response, options).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const status = error && typeof error === "object" && "statusCode" in error
        && typeof error.statusCode === "number" ? error.statusCode : 400;
      jsonResponse(response, status, { error: error instanceof Error ? error.message : String(error) });
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
        if (!address || typeof address === "string") {
          reject(new Error("live server did not expose a TCP address"));
          return;
        }
        actualPort = address.port;
        resolvePromise(actualPort);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    }),
    close: () => new Promise<void>((resolvePromise, reject) => {
      if (!server.listening) {
        resolvePromise();
        return;
      }
      // SSE connections are intentionally long-lived.  Close them before
      // waiting for the HTTP server's close callback so Ctrl-C and CI do not
      // hang behind an idle browser tab.
      server.closeAllConnections?.();
      server.close((error) => error ? reject(error) : resolvePromise());
    }),
  };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: LiveServerOptions): Promise<void> {
  if (request.method !== "GET" && request.method !== "POST") {
    jsonResponse(response, 405, { error: "method not allowed" });
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/") {
    textResponse(response, "text/html; charset=utf-8", dashboardHtml);
    return;
  }
  if (url.pathname === "/assets/app.js") {
    textResponse(response, "text/javascript; charset=utf-8", dashboardJs);
    return;
  }
  if (url.pathname === "/assets/styles.css") {
    textResponse(response, "text/css; charset=utf-8", dashboardCss);
    return;
  }
  if (url.pathname === "/api/health") {
    jsonResponse(response, 200, {
      ok: true,
      streamId: options.hub.streamId,
      lastEventId: options.hub.lastEventId,
      status: options.snapshots.getSnapshot("spectator").status,
    });
    return;
  }
  if (url.pathname === "/api/control") {
    if (!options.control) {
      jsonResponse(response, 404, { error: "live control is not enabled" });
      return;
    }
    if (request.method !== "GET") {
      jsonResponse(response, 405, { error: "method not allowed" });
      return;
    }
    jsonResponse(response, 200, options.control.getSnapshot());
    return;
  }
  if (url.pathname === "/api/control/pause" || url.pathname === "/api/control/resume" || url.pathname === "/api/control/step") {
    if (!options.control) {
      jsonResponse(response, 404, { error: "live control is not enabled" });
      return;
    }
    if (request.method !== "POST") {
      jsonResponse(response, 405, { error: "method not allowed" });
      return;
    }
    const snapshot = url.pathname.endsWith("/pause")
      ? options.control.pause()
      : url.pathname.endsWith("/resume")
        ? options.control.resume()
        : options.control.step();
    jsonResponse(response, 200, snapshot);
    return;
  }
  if (url.pathname === "/api/snapshot") {
    const mode = validMode(url.searchParams.get("mode"));
    jsonResponse(response, 200, options.snapshots.getSnapshot(mode));
    return;
  }
  if (url.pathname === "/api/events") {
    const mode = validMode(url.searchParams.get("mode"));
    // EventSource reconnects keep the URL but send the authoritative cursor in
    // Last-Event-ID.  Prefer it so a stale `after` query parameter cannot make
    // us replay an older suffix (or trigger an unnecessary reset).
    const after = headerAfter(request) ?? parseAfter(url.searchParams.get("after"));
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      "Content-Security-Policy": CSP,
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders?.();
    let closed = false;
    let unsubscribe: () => void = () => undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      unsubscribe();
      if (!response.writableEnded) response.end();
    };
    const subscriber: LiveSubscriber = {
      send: (event) => {
        if (closed || response.writableEnded) return false;
        const accepted = sseWrite(response, event);
        if (!accepted) close();
        return accepted;
      },
      reset: (event) => {
        if (closed || response.writableEnded) return false;
        const accepted = sseReset(response, event);
        if (!accepted) close();
        return accepted;
      },
      close,
    };
    const keepalive = setInterval(() => {
      if (closed || response.writableEnded) return close();
      if (!response.write(": keepalive\n\n")) close();
    }, 15_000);
    response.on("close", close);
    unsubscribe = options.hub.subscribe(mode, after, subscriber);
    return;
  }
  jsonResponse(response, 404, { error: "not found" });
}
