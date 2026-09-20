import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { BrowserReader } from "./browser.ts";
import {
  loadReaderConfig,
  parseModelId,
  READER_CONFIG_PATH,
  resolveThinkingLevel,
  type ReaderConfig,
  type ReaderThinkingLevel,
} from "./config.ts";
import { createRuntimeAnswer } from "./model.ts";
import { ReaderState } from "./reader.ts";

export interface CliOptions {
  articleUrl: string;
  configPath: string;
  openBrowser: boolean;
  help: boolean;
}

export function parseCliArgs(args: string[]): CliOptions {
  let configPath = process.env.PI_READER_CONFIG || READER_CONFIG_PATH;
  let openBrowser = process.env.PI_READER_BROWSER_OPEN !== "0";
  let help = false;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--no-open") openBrowser = false;
    else if (argument === "--config") {
      const path = args[++index];
      if (!path) throw new Error("--config requires a file path.");
      configPath = path;
    } else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length > 1) throw new Error("Provide at most one article URL.");
  return { articleUrl: positional[0] ?? "", configPath, openBrowser, help };
}

interface StandaloneModels {
  getModel(provider: string, modelId: string): Model<any> | undefined;
  getAvailable(): Promise<readonly Model<any>[]>;
}

interface StandaloneSettings {
  getDefaultProvider(): string | undefined;
  getDefaultModel(): string | undefined;
  getDefaultThinkingLevel(): ReaderThinkingLevel | undefined;
  getModelThinkingLevel(provider: string, modelId: string): ReaderThinkingLevel | undefined;
}

export async function resolveStandaloneSelection(
  config: ReaderConfig,
  models: StandaloneModels,
  settings: StandaloneSettings,
): Promise<{ model: Model<any>; thinkingLevel: ReaderThinkingLevel }> {
  let model: Model<any> | undefined;
  if (config.defaultModel) {
    const { provider, modelId } = parseModelId(config.defaultModel);
    model = models.getModel(provider, modelId);
    if (!model) throw new Error(`Configured reader model ${config.defaultModel} was not found by pi. Check it with pi --list-models.`);
  } else {
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider && modelId) model = models.getModel(provider, modelId);
    model ??= (await models.getAvailable())[0];
    if (!model) throw new Error("Pi has no available model. Configure reader.config.json and authenticate with pi /login first.");
  }
  const piThinking = settings.getModelThinkingLevel(model.provider, model.id)
    ?? settings.getDefaultThinkingLevel()
    ?? "medium";
  return { model, thinkingLevel: resolveThinkingLevel(config, model, piThinking) };
}

export const CLI_HELP = `Pi Reader — browser reading workspace backed by pi

Usage:
  pi-reader [options] [article-url]

Options:
  --config PATH  Use another config file (default: ${READER_CONFIG_PATH})
  --no-open      Start the server without opening the default browser
  -h, --help     Show this help

The process stays alive while the browser reader is available. Press Ctrl+C to stop it.
Model credentials come from pi (/login, auth.json, or provider environment variables).`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(args);
  if (options.help) { console.log(CLI_HELP); return; }
  const config = await loadReaderConfig(options.configPath);
  const runtime = await ModelRuntime.create();
  const settings = SettingsManager.create(process.cwd());
  const { model, thinkingLevel } = await resolveStandaloneSelection(config, runtime, settings as StandaloneSettings);
  const label = `${model.provider}/${model.id} · thinking:${thinkingLevel}`;
  const state = new ReaderState(createRuntimeAnswer(runtime, model, thinkingLevel));
  const browser = new BrowserReader(state, label, options.openBrowser ? {} : { launch: () => {} });
  const result = await browser.open(options.articleUrl);
  console.log(`Pi Reader: ${result.url}`);
  console.log(`Model: ${label}`);
  if (!result.launched) console.warn(`Browser launch failed: ${result.error}`);
  console.log("Press Ctrl+C to stop. Nothing is persisted.");

  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void browser.dispose().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
