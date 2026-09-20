import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { clampThinkingLevel } from "@earendil-works/pi-ai";

export const READER_CONFIG_PATH = fileURLToPath(new URL("../reader.config.json", import.meta.url));
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReaderThinkingLevel = typeof THINKING_LEVELS[number];

export interface ReaderConfig {
  /** A pi provider/model identifier. null means the active/default pi model. */
  defaultModel: string | null;
  /** null means pi's current/per-model/default thinking setting. */
  defaultThinkingLevel: ReaderThinkingLevel | null;
}

export const DEFAULT_READER_CONFIG: ReaderConfig = {
  defaultModel: null,
  defaultThinkingLevel: "medium",
};

export interface ModelLookup {
  find(provider: string, modelId: string): Model<any> | undefined;
}

export function parseModelId(value: string): { provider: string; modelId: string } {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`Invalid defaultModel "${value}". Use a pi provider/model identifier such as "anthropic/claude-sonnet-4-5".`);
  }
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

export function parseReaderConfig(text: string, source = READER_CONFIG_PATH): ReaderConfig {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error(`Could not parse ${source}: ${(error as Error).message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object.`);
  }
  const object = value as Record<string, unknown>;
  const unknown = Object.keys(object).filter((key) => !["defaultModel", "defaultThinkingLevel"].includes(key));
  if (unknown.length) throw new Error(`${source} has unknown setting${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  const model = object.defaultModel ?? null;
  if (model !== null && (typeof model !== "string" || !model.trim())) {
    throw new Error(`${source}: defaultModel must be a non-empty "provider/model" string or null.`);
  }
  if (typeof model === "string") parseModelId(model.trim());
  const thinking = object.defaultThinkingLevel === undefined ? DEFAULT_READER_CONFIG.defaultThinkingLevel : object.defaultThinkingLevel;
  if (thinking !== null && (typeof thinking !== "string" || !(THINKING_LEVELS as readonly string[]).includes(thinking))) {
    throw new Error(`${source}: defaultThinkingLevel must be null or one of ${THINKING_LEVELS.join(", ")}.`);
  }
  return {
    defaultModel: typeof model === "string" ? model.trim() : null,
    defaultThinkingLevel: thinking as ReaderThinkingLevel | null,
  };
}

export async function loadReaderConfig(path = process.env.PI_READER_CONFIG || READER_CONFIG_PATH): Promise<ReaderConfig> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { throw new Error(`Could not read reader config at ${path}: ${(error as Error).message}`); }
  if (Buffer.byteLength(text) > 16 * 1024) throw new Error(`Reader config at ${path} exceeds 16 KiB.`);
  return parseReaderConfig(text, path);
}

export function resolveReaderModel(config: ReaderConfig, lookup: ModelLookup, fallback?: Model<any>): Model<any> | undefined {
  if (!config.defaultModel) return fallback;
  const { provider, modelId } = parseModelId(config.defaultModel);
  const model = lookup.find(provider, modelId);
  if (!model) {
    throw new Error(`Configured reader model ${config.defaultModel} was not found by pi. Check /model and reader.config.json.`);
  }
  return model;
}

export function resolveThinkingLevel(
  config: ReaderConfig,
  model: Model<any> | undefined,
  fallback: ReaderThinkingLevel = "medium",
): ReaderThinkingLevel {
  const requested = config.defaultThinkingLevel ?? fallback;
  if (!model) return requested;
  return clampThinkingLevel(model, requested as ModelThinkingLevel) as ReaderThinkingLevel;
}
