import assert from "node:assert/strict";
import { test } from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import { parseCliArgs, resolveStandaloneSelection } from "../src/cli.ts";
import {
  parseModelId,
  parseReaderConfig,
  resolveReaderModel,
  resolveThinkingLevel,
  THINKING_LEVELS,
} from "../src/config.ts";
import { registryThinkingOptions } from "../src/model.ts";

const model = (provider = "anthropic", id = "claude-test", reasoning = true) => ({
  provider, id, api: provider === "anthropic" ? "anthropic-messages" : "openai-responses",
  name: id, reasoning, input: ["text"], contextWindow: 128_000, maxTokens: 32_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}) as Model<any>;

test("repo config accepts pi model IDs and every supported thinking level", () => {
  for (const level of THINKING_LEVELS) {
    assert.deepEqual(parseReaderConfig(JSON.stringify({ defaultModel: "openrouter/anthropic/claude", defaultThinkingLevel: level })), {
      defaultModel: "openrouter/anthropic/claude", defaultThinkingLevel: level,
    });
  }
  assert.deepEqual(parseModelId("openrouter/anthropic/claude"), { provider: "openrouter", modelId: "anthropic/claude" });
  assert.throws(() => parseReaderConfig("{"), /Could not parse/);
  assert.throws(() => parseReaderConfig("[]"), /JSON object/);
  assert.throws(() => parseReaderConfig('{"model":"x"}'), /unknown setting/);
  assert.throws(() => parseReaderConfig('{"defaultModel":"no-slash"}'), /provider\/model/);
  assert.throws(() => parseReaderConfig('{"defaultThinkingLevel":"extreme"}'), /must be null or one of/);
});

test("configured model overrides pi's active model and thinking is clamped to capabilities", () => {
  const configured = model("openai", "gpt-test");
  configured.thinkingLevelMap = { xhigh: null, max: null };
  const active = model("anthropic", "active");
  const config = parseReaderConfig('{"defaultModel":"openai/gpt-test","defaultThinkingLevel":"xhigh"}');
  const resolved = resolveReaderModel(config, { find: (provider, id) => provider === "openai" && id === "gpt-test" ? configured : undefined }, active);
  assert.equal(resolved, configured);
  assert.equal(resolveThinkingLevel(config, configured), "high");
  assert.throws(() => resolveReaderModel(config, { find: () => undefined }, active), /was not found by pi/);
  const fallback = parseReaderConfig('{"defaultModel":null,"defaultThinkingLevel":null}');
  assert.equal(resolveReaderModel(fallback, { find: () => undefined }, active), active);
  assert.equal(resolveThinkingLevel(fallback, active, "low"), "low");
  assert.equal(resolveThinkingLevel(config, model("openai", "plain", false)), "off");
});

test("registry model requests receive native thinking controls", () => {
  const anthropic = model();
  const high = registryThinkingOptions(anthropic, "high", 20_480, 16_384);
  assert.equal(high.thinkingEnabled, true);
  assert.equal(high.effort, "high");
  assert.equal(high.thinkingBudgetTokens, 16_384);
  const off = registryThinkingOptions(anthropic, "off", 4096, 0);
  assert.equal(off.thinkingEnabled, false);
  assert.equal(off.reasoningEffort, undefined);
  const google = model("google", "gemini-3-flash-preview");
  assert.deepEqual(registryThinkingOptions(google, "medium", 12_288, 8192).thinking, { enabled: true, level: "MEDIUM" });
  const openai = model("openai", "gpt-test");
  assert.equal(registryThinkingOptions(openai, "xhigh", 20_480, 16_384).reasoningEffort, "high"); // no xhigh map => clamp
});

test("standalone CLI uses repo config first, then pi defaults", async () => {
  const configured = model("anthropic", "configured");
  const piDefault = model("openai", "default");
  const available = model("google", "available");
  const models = {
    getModel: (provider: string, id: string) => [configured, piDefault].find((entry) => entry.provider === provider && entry.id === id),
    getAvailable: async () => [available],
  };
  const settings = {
    getDefaultProvider: () => "openai",
    getDefaultModel: () => "default",
    getDefaultThinkingLevel: () => "low" as const,
    getModelThinkingLevel: () => undefined,
  };
  let selected = await resolveStandaloneSelection({ defaultModel: "anthropic/configured", defaultThinkingLevel: "high" }, models, settings);
  assert.equal(selected.model, configured);
  assert.equal(selected.thinkingLevel, "high");
  selected = await resolveStandaloneSelection({ defaultModel: null, defaultThinkingLevel: null }, models, settings);
  assert.equal(selected.model, piDefault);
  assert.equal(selected.thinkingLevel, "low");
  selected = await resolveStandaloneSelection({ defaultModel: null, defaultThinkingLevel: "medium" }, {
    getModel: () => undefined, getAvailable: async () => [available],
  }, { ...settings, getDefaultProvider: () => undefined, getDefaultModel: () => undefined });
  assert.equal(selected.model, available);
  assert.equal(selected.thinkingLevel, "medium");
});

test("standalone CLI argument parsing supports direct URLs and headless launch", () => {
  assert.deepEqual(parseCliArgs(["--no-open", "--config", "/tmp/reader.json", "https://example.com"]), {
    articleUrl: "https://example.com", configPath: "/tmp/reader.json", openBrowser: false, help: false,
  });
  assert.equal(parseCliArgs(["--help"]).help, true);
  assert.throws(() => parseCliArgs(["--wat"]), /Unknown option/);
  assert.throws(() => parseCliArgs(["one", "two"]), /at most one/);
});
