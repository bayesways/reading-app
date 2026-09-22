import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { BrowserReader } from "./browser.ts";
import {
  loadReaderConfig,
  READER_CONFIG_PATH,
  type ReaderThinkingLevel,
} from "./config.ts";
import { ReaderState } from "./reader.ts";
import { StandaloneAssistant } from "./standalone-assistant.ts";

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

interface StandaloneSettings {
  getDefaultProvider(): string | undefined;
  getDefaultModel(): string | undefined;
  getDefaultThinkingLevel(): ReaderThinkingLevel | undefined;
  getModelThinkingLevel(provider: string, modelId: string): ReaderThinkingLevel | undefined;
}

export const CLI_HELP = `Pi Reader — browser reading workspace backed by pi

Usage:
  pi-reader [options] [article-url]

Options:
  --config PATH  Use another config file (default: ${READER_CONFIG_PATH})
  --no-open      Start the server without opening the default browser
  -h, --help     Show this help

The process stays alive while the browser reader is available. Press Ctrl+C to stop it.
Choose and connect a model provider in the reader. Existing pi credentials and provider environment variables are also recognized.`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(args);
  if (options.help) { console.log(CLI_HELP); return; }
  const config = await loadReaderConfig(options.configPath);
  const runtime = await ModelRuntime.create();
  const settings = SettingsManager.create(process.cwd());
  const assistant = new StandaloneAssistant(runtime, settings as StandaloneSettings, config);
  await assistant.initialize();
  const state = new ReaderState(assistant.answer);
  const browser = new BrowserReader(state, "No model selected", {
    ...(options.openBrowser ? {} : { launch: () => {} }),
    assistant,
  });
  const result = await browser.open(options.articleUrl);
  console.log(`Pi Reader: ${result.url}`);
  console.log(`Model: ${assistant.snapshot().selected?.value ?? "choose one in the reader"}`);
  if (!result.launched) console.warn(`Browser launch failed: ${result.error}`);
  console.log("Press Ctrl+C to stop. Articles and discussions stay in memory.");

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
