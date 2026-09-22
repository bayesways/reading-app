import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthInteraction, Model, Provider } from "@earendil-works/pi-ai";
import { StandaloneAssistant } from "../src/standalone-assistant.ts";

const model = (provider: string, id: string) => ({
  provider, id, api: "openai-responses", name: id, reasoning: true, input: ["text"],
  contextWindow: 128_000, maxTokens: 32_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}) as Model<any>;

const settings = {
  getDefaultProvider: () => undefined,
  getDefaultModel: () => undefined,
  getDefaultThinkingLevel: () => "medium" as const,
  getModelThinkingLevel: () => undefined,
};

test("standalone assistant starts without credentials and completes provider setup in the browser", async () => {
  const availableModel = model("example", "reader-model");
  let connected = false;
  let submitted = "";
  const provider = {
    id: "example", name: "Example AI",
    auth: {
      apiKey: {
        name: "Example API key",
        login: async (interaction: AuthInteraction) => {
          interaction.notify({ type: "auth_url", url: "https://example.com/account", instructions: "Create a key." });
          submitted = await interaction.prompt({ type: "secret", message: "Paste the API key" });
          connected = true;
          return { type: "api_key", key: submitted };
        },
      },
    },
  } as unknown as Provider;
  const runtime = {
    getProviders: () => [provider],
    getProvider: (id: string) => id === provider.id ? provider : undefined,
    getModel: () => undefined,
    getAvailable: async (providerId?: string) => connected && (!providerId || providerId === provider.id) ? [availableModel] : [],
    login: async (_providerId: string, _type: string, interaction: AuthInteraction) => provider.auth.apiKey!.login!(interaction as never),
    refresh: async () => ({ aborted: false, errors: new Map() }),
    completeSimple: async () => { throw new Error("not called"); },
  };

  const assistant = new StandaloneAssistant(runtime as never, settings, { defaultModel: null, defaultThinkingLevel: "high" });
  await assistant.initialize();
  assert.equal(assistant.snapshot().selected, undefined);
  assert.deepEqual(assistant.snapshot().providers[0].methods, [{ type: "api_key", label: "Example API key" }]);

  assistant.startLogin("example", "api_key");
  while (!assistant.snapshot().auth?.prompt) await new Promise((resolve) => setTimeout(resolve, 0));
  const pending = assistant.snapshot().auth!;
  assert.equal(pending.authUrl, "https://example.com/account");
  assert.equal(pending.prompt!.type, "secret");
  assistant.respondToLogin(pending.prompt!.id, "local-test-key");
  while (assistant.snapshot().auth?.status === "running") await new Promise((resolve) => setTimeout(resolve, 0));

  const ready = assistant.snapshot();
  assert.equal(submitted, "local-test-key");
  assert.equal(ready.auth?.status, "success");
  assert.equal(ready.selected, undefined);
  assert.equal(ready.models[0].label, "reader-model · Example AI");
  await assistant.selectModel("example/reader-model");
  assert.equal(assistant.snapshot().selected?.thinkingLevel, "high");
});

test("standalone assistant prefers an available configured model and changes models per process", async () => {
  const first = model("example", "first");
  const second = model("example", "second");
  const provider = { id: "example", name: "Example AI", auth: { apiKey: { name: "Key" } } } as unknown as Provider;
  const runtime = {
    getProviders: () => [provider], getProvider: () => provider,
    getModel: () => undefined, getAvailable: async () => [first, second],
    login: async () => ({ type: "api_key", key: "x" }),
    refresh: async () => ({ aborted: false, errors: new Map() }),
    completeSimple: async () => { throw new Error("not called"); },
  };
  const assistant = new StandaloneAssistant(runtime as never, settings, {
    defaultModel: "example/second", defaultThinkingLevel: "medium",
  });
  await assistant.initialize();
  assert.equal(assistant.snapshot().selected?.value, "example/second");
  await assistant.selectModel("example/first");
  assert.equal(assistant.snapshot().selected?.value, "example/first");
  await assert.rejects(assistant.selectModel("example/missing"), /not available/);
});

test("standalone assistant never replaces an explicit model with the provider's first catalog entry", async () => {
  const spark = model("openai-codex", "gpt-5.3-codex-spark");
  const terra = model("openai-codex", "gpt-5.6-terra");
  const provider = {
    id: "openai-codex", name: "OpenAI Codex",
    auth: { oauth: { name: "ChatGPT", login: async () => ({ type: "oauth", refresh: "r", access: "a", expires: Date.now() + 60_000 }) } },
  } as unknown as Provider;
  let interaction: AuthInteraction | undefined;
  const runtime = {
    getProviders: () => [provider], getProvider: () => provider,
    getModel: () => undefined, getAvailable: async () => [spark, terra],
    login: async (_providerId: string, _type: string, next: AuthInteraction) => {
      interaction = next;
      return provider.auth.oauth!.login(next as never);
    },
    refresh: async () => ({ aborted: false, errors: new Map() }),
    completeSimple: async () => { throw new Error("not called"); },
  };
  const assistant = new StandaloneAssistant(runtime as never, settings, { defaultModel: null, defaultThinkingLevel: "medium" });
  await assistant.initialize();
  assert.equal(assistant.snapshot().selected, undefined, "catalog order must not auto-select Spark");
  await assistant.selectModel("openai-codex/gpt-5.6-terra");
  assistant.startLogin("openai-codex", "oauth");
  while (assistant.snapshot().auth?.status === "running") await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(interaction);
  assert.equal(assistant.snapshot().selected?.value, "openai-codex/gpt-5.6-terra");
});
