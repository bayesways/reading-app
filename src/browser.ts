import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { cleanText } from "./article.ts";
import { browserPage } from "./browser-page.ts";
import { ReaderState, type Answer } from "./reader.ts";

const MAX_API_BYTES = 64 * 1024;
const MAX_QUESTION_CHARS = 10_000;
const MAX_SELECTION_CHARS = 20_000;

/** The page's wire contract. Spelled out, not derived from Reading, so nothing internal is served by accident. */
export interface BrowserSnapshot {
  model: string;
  assistant?: AssistantSnapshot;
  status: string;
  error: boolean;
  busy: boolean;
  showingSummary: boolean;
  pages: Array<{ url: string; title: string }>;
  current?: {
    article: { url: string; title: string; markdown: string; warning?: string };
    exchanges: Array<{ question: string; answer: string; selection?: string }>;
    summary: string;
    selection?: string;
  };
}

export interface AssistantSnapshot {
  selected?: { value: string; provider: string; id: string; label: string; thinkingLevel: string };
  models: Array<{ value: string; provider: string; providerName: string; id: string; name: string; label: string }>;
  providers: Array<{
    id: string; name: string; configured: boolean;
    methods: Array<{ type: "api_key" | "oauth"; label: string }>;
  }>;
  auth?: {
    providerId: string;
    providerName: string;
    method: "api_key" | "oauth";
    methodLabel: string;
    status: "running" | "success" | "error";
    message: string;
    authUrl?: string;
    deviceCode?: string;
    links?: Array<{ url: string; label?: string }>;
    prompt?: {
      id: number;
      type: "text" | "secret" | "select" | "manual_code";
      message: string;
      placeholder?: string;
      options?: Array<{ id: string; label: string; description?: string }>;
    };
  };
  error?: string;
}

export interface BrowserAssistant {
  answer: Answer;
  snapshot(): AssistantSnapshot;
  selectModel(value: string): Promise<void>;
  startLogin(providerId: string, type: "api_key" | "oauth"): void;
  respondToLogin(promptId: number, value: string): void;
  cancelLogin(): void;
  dismissLogin(): void;
  dispose?(): void;
}

export interface BrowserOpenResult { url: string; launched: boolean; error?: string }
export interface BrowserReaderOptions {
  launch?: (url: string) => Promise<void> | void;
  assistant?: BrowserAssistant;
}

function browserStatus(status: string): string {
  return status
    .replace("Tab to the question box to ask about this page.", "Type below to ask about this page.")
    .replace("F3 switches back to the article.", "Type /article to return to the page.")
    .replace("F2 summarizes your learnings so far.", "Type /recap to summarize your learnings.")
    .replace("click/drag in fullscreen, or press v in the article.", "select text in the article first.");
}

function snapshot(state: ReaderState, model: string, assistant?: BrowserAssistant): BrowserSnapshot {
  const current = state.current;
  const assistantSnapshot = assistant?.snapshot();
  const modelLabel = assistantSnapshot?.selected
    ? `${assistantSnapshot.selected.value} · thinking:${assistantSnapshot.selected.thinkingLevel}`
    : assistant ? "No model selected" : model;
  return {
    model: cleanText(modelLabel),
    ...(assistantSnapshot ? { assistant: assistantSnapshot } : {}),
    status: browserStatus(state.status), error: state.error, busy: state.busy,
    showingSummary: state.showingSummary,
    pages: [...state.readings.values()].map(({ article }) => ({ url: article.url, title: article.title })),
    ...(current ? { current: {
      // Copied field by field on purpose: the reading model is internal, this payload is the page's API.
      article: {
        url: current.article.url, title: current.article.title, markdown: current.article.markdown,
        ...(current.article.warning ? { warning: current.article.warning } : {}),
      },
      exchanges: current.exchanges.map(({ question, answer, selection }) => ({
        question, answer, ...(selection ? { selection } : {}),
      })),
      summary: current.summary,
      ...(current.selection ? { selection: current.selection } : {}),
    } } : {}),
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end();
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_API_BYTES) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  if (!length) return {};
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

function requiredText(body: Record<string, unknown>, key: string, maximum: number, allowEmpty = false): string {
  if (typeof body[key] !== "string") throw new Error(`${key} must be text.`);
  const value = cleanText(body[key]).trim();
  if (!allowEmpty && !value) throw new Error(`${key} cannot be empty.`);
  if (value.length > maximum) throw new Error(`${key} is too long.`);
  return value;
}

async function systemOpen(url: string): Promise<void> {
  if (process.env.PI_READER_BROWSER_OPEN === "0") return;
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/** Loopback-only web frontend. The capability is rotated whenever the server restarts. */
export class BrowserReader {
  private server?: Server;
  private capability = "";
  private origin = "";

  constructor(
    readonly state: ReaderState,
    readonly modelLabel: string,
    private options: BrowserReaderOptions = {},
  ) {}

  get running(): boolean { return !!this.server?.listening; }
  get url(): string | undefined { return this.origin ? `${this.origin}/${this.capability}/` : undefined; }

  async start(): Promise<string> {
    if (this.running) return this.url!;
    this.capability = randomBytes(32).toString("base64url");
    const server = createServer((request, response) => { void this.handle(request, response); });
    server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { server.off("listening", ready); reject(error); };
      const ready = () => { server.off("error", failed); resolve(); };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen(0, "127.0.0.1");
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not determine the browser reader address.");
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.url!;
  }

  async open(articleUrl?: string): Promise<BrowserOpenResult> {
    const url = await this.start();
    if (articleUrl?.trim()) await this.state.load(articleUrl);
    try {
      await (this.options.launch ?? systemOpen)(url);
      return { url, launched: true };
    } catch (error) {
      return { url, launched: false, error: (error as Error).message };
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.origin = "";
    this.capability = "";
    this.state.cancel();
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async dispose(): Promise<void> {
    this.state.clear();
    this.options.assistant?.dispose?.();
    await this.stop();
  }

  private authorized(pathname: string): boolean {
    const supplied = pathname.split("/")[1] ?? "";
    const expected = this.capability;
    if (!supplied || supplied.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }

  private sameOrigin(request: IncomingMessage): boolean {
    const host = request.headers.host;
    if (!host || this.origin !== `http://${host}`) return false;
    const origin = request.headers.origin;
    return !origin || origin === this.origin;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const parsed = new URL(request.url ?? "/", this.origin || "http://127.0.0.1");
      if (!this.authorized(parsed.pathname) || !this.sameOrigin(request)) { sendEmpty(response, 404); return; }
      const root = `/${this.capability}/`;
      if (request.method === "GET" && parsed.pathname === root) {
        const nonce = randomBytes(18).toString("base64url");
        const body = browserPage(nonce);
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Cross-Origin-Resource-Policy": "same-origin",
        });
        response.end(body);
        return;
      }
      const apiPrefix = `${root}api/`;
      if (!parsed.pathname.startsWith(apiPrefix)) { sendEmpty(response, 404); return; }
      const action = parsed.pathname.slice(apiPrefix.length);
      if (request.method === "GET" && action === "state") {
        sendJson(response, 200, snapshot(this.state, this.modelLabel, this.options.assistant));
        return;
      }
      if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed." }); return; }
      if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        sendJson(response, 415, { error: "Content-Type must be application/json." }); return;
      }
      const body = await readBody(request);
      if (action === "load") {
        await this.state.load(requiredText(body, "url", 8192));
      } else if (action === "select") {
        this.state.selectText(requiredText(body, "selection", MAX_SELECTION_CHARS, true));
      } else if (action === "ask") {
        this.state.selectText(requiredText(body, "selection", MAX_SELECTION_CHARS, true));
        await this.state.ask(requiredText(body, "question", MAX_QUESTION_CHARS));
      } else if (action === "explain") {
        this.state.selectText(requiredText(body, "selection", MAX_SELECTION_CHARS));
        await this.state.explainSelection();
      } else if (action === "summary") {
        await this.state.ask("", "summary");
      } else if (action === "cancel") {
        this.state.cancel();
      } else if (action === "model") {
        if (!this.options.assistant) throw new Error("Model selection is not available in this reader session.");
        if (this.state.busy) throw new Error("Wait for the current answer or cancel it before changing models.");
        await this.options.assistant.selectModel(requiredText(body, "model", 1024));
      } else if (action === "auth/start") {
        if (!this.options.assistant) throw new Error("Provider setup is not available in this reader session.");
        const type = requiredText(body, "type", 16);
        if (type !== "api_key" && type !== "oauth") throw new Error("Unknown sign-in method.");
        this.options.assistant.startLogin(requiredText(body, "provider", 256), type);
      } else if (action === "auth/respond") {
        if (!this.options.assistant) throw new Error("Provider setup is not available in this reader session.");
        if (!Number.isSafeInteger(body.promptId) || (body.promptId as number) < 1) throw new Error("promptId must be a positive integer.");
        this.options.assistant.respondToLogin(body.promptId as number, requiredText(body, "value", 32_768));
      } else if (action === "auth/cancel") {
        if (!this.options.assistant) throw new Error("Provider setup is not available in this reader session.");
        this.options.assistant.cancelLogin();
      } else if (action === "auth/dismiss") {
        if (!this.options.assistant) throw new Error("Provider setup is not available in this reader session.");
        this.options.assistant.dismissLogin();
      } else {
        sendJson(response, 404, { error: "Unknown API action." }); return;
      }
      sendJson(response, 200, snapshot(this.state, this.modelLabel, this.options.assistant));
    } catch (error) {
      sendJson(response, 400, { error: cleanText((error as Error).message || "Invalid request.") });
    }
  }
}

export interface ReaderCommand { browser: boolean; stopBrowser: boolean; url: string }

export function parseReaderCommand(input: string): ReaderCommand {
  const value = input.trim();
  if (/^--browser-stop(?:\s|$)/.test(value)) {
    const remainder = value.replace(/^--browser-stop\s*/, "");
    if (remainder) throw new Error("--browser-stop does not accept a URL.");
    return { browser: true, stopBrowser: true, url: "" };
  }
  const match = value.match(/^(?:--browser|-b)(?:\s+([\s\S]*))?$/);
  if (match) return { browser: true, stopBrowser: false, url: match[1]?.trim() ?? "" };
  return { browser: false, stopBrowser: false, url: value.replace(/^--tui(?:\s+|$)/, "").trim() };
}
