import type {
  AuthEvent,
  AuthPrompt,
  AuthType,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AssistantSnapshot, BrowserAssistant } from "./browser.ts";
import { resolveThinkingLevel, type ReaderConfig, type ReaderThinkingLevel } from "./config.ts";
import { createRuntimeAnswer } from "./model.ts";
import type { Answer } from "./reader.ts";

interface StandaloneSettings {
  getDefaultProvider(): string | undefined;
  getDefaultModel(): string | undefined;
  getDefaultThinkingLevel(): ReaderThinkingLevel | undefined;
  getModelThinkingLevel(provider: string, modelId: string): ReaderThinkingLevel | undefined;
}

interface AssistantRuntime extends Pick<ModelRuntime,
  "completeSimple" | "getAvailable" | "getModel" | "getProvider" | "getProviders" | "login" | "refresh"
> {}

interface PendingPrompt {
  id: number;
  resolve(value: string): void;
  reject(error: Error): void;
  cleanup(): void;
}

function methods(provider: Provider): Array<{ type: AuthType; label: string }> {
  const result: Array<{ type: AuthType; label: string }> = [];
  if (provider.auth.oauth) {
    result.push({ type: "oauth", label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name });
  }
  if (provider.auth.apiKey?.login) result.push({ type: "api_key", label: provider.auth.apiKey.name });
  return result;
}

function modelValue(model: Model<any>): string { return `${model.provider}/${model.id}`; }

/** Owns the standalone reader's model choice and bridges pi's login prompts into the local page. */
export class StandaloneAssistant implements BrowserAssistant {
  private available: readonly Model<any>[] = [];
  private selected?: Model<any>;
  private thinkingLevel: ReaderThinkingLevel = "medium";
  private auth?: AssistantSnapshot["auth"];
  private authController?: AbortController;
  private pendingPrompt?: PendingPrompt;
  private promptSequence = 0;
  private catalogError = "";

  readonly answer: Answer = (reading, question, kind, signal, selection) => {
    if (!this.selected) {
      throw new Error("Choose an assistant model above before asking a question.");
    }
    return createRuntimeAnswer(this.runtime, this.selected, this.thinkingLevel)(reading, question, kind, signal, selection);
  };

  constructor(
    private readonly runtime: AssistantRuntime,
    private readonly settings: StandaloneSettings,
    private readonly config: ReaderConfig,
  ) {}

  async initialize(): Promise<void> {
    await this.refreshAvailable();
    const preferred = this.config.defaultModel ?? this.piDefault();
    if (preferred) this.selected = this.available.find((entry) => modelValue(entry) === preferred);
    this.updateThinkingLevel();
  }

  snapshot(): AssistantSnapshot {
    const availableProviders = new Set(this.available.map((model) => model.provider));
    const providerItems = this.runtime.getProviders()
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        configured: availableProviders.has(provider.id),
        methods: methods(provider),
      }))
      .filter((provider) => provider.configured || provider.methods.length)
      .sort((a, b) => a.name.localeCompare(b.name));
    const models = this.available.map((model) => {
      const provider = this.runtime.getProvider(model.provider);
      return {
        value: modelValue(model),
        provider: model.provider,
        providerName: provider?.name ?? model.provider,
        id: model.id,
        name: model.name,
        label: `${model.name} · ${provider?.name ?? model.provider}`,
      };
    }).sort((a, b) => a.label.localeCompare(b.label));
    const selected = this.selected ? {
      value: modelValue(this.selected),
      provider: this.selected.provider,
      id: this.selected.id,
      label: `${this.selected.name} · ${this.runtime.getProvider(this.selected.provider)?.name ?? this.selected.provider}`,
      thinkingLevel: this.thinkingLevel,
    } : undefined;
    return {
      selected,
      models,
      providers: providerItems,
      ...(this.auth ? { auth: this.auth } : {}),
      ...(this.catalogError ? { error: this.catalogError } : {}),
    };
  }

  async selectModel(value: string): Promise<void> {
    const model = this.available.find((entry) => modelValue(entry) === value);
    if (!model) throw new Error("That model is not available. Connect its provider first.");
    this.selected = model;
    this.updateThinkingLevel();
  }

  startLogin(providerId: string, type: AuthType): void {
    if (this.authController) throw new Error("A provider connection is already in progress.");
    const provider = this.runtime.getProvider(providerId);
    const method = provider && methods(provider).find((entry) => entry.type === type);
    if (!provider || !method) throw new Error("That sign-in method is not available.");
    const controller = new AbortController();
    this.authController = controller;
    this.auth = {
      providerId,
      providerName: provider.name,
      method: type,
      methodLabel: method.label,
      status: "running",
      message: `Connecting ${provider.name}…`,
    };
    void this.runLogin(provider, type, controller);
  }

  respondToLogin(promptId: number, value: string): void {
    const pending = this.pendingPrompt;
    if (!pending || pending.id !== promptId) throw new Error("That sign-in prompt has expired.");
    if (!value.trim()) throw new Error("Enter a value to continue.");
    this.pendingPrompt = undefined;
    pending.cleanup();
    pending.resolve(value);
  }

  cancelLogin(): void {
    const pending = this.pendingPrompt;
    this.pendingPrompt = undefined;
    pending?.cleanup();
    pending?.reject(new Error("Sign-in cancelled."));
    this.authController?.abort();
    this.authController = undefined;
    if (this.auth) this.auth = { ...this.auth, status: "error", message: "Sign-in cancelled.", prompt: undefined };
  }

  dismissLogin(): void {
    if (this.auth?.status === "running") throw new Error("Finish or cancel sign-in first.");
    this.auth = undefined;
  }

  dispose(): void {
    if (this.authController) this.cancelLogin();
  }

  private piDefault(): string | undefined {
    const provider = this.settings.getDefaultProvider();
    const model = this.settings.getDefaultModel();
    return provider && model ? `${provider}/${model}` : undefined;
  }

  private updateThinkingLevel(): void {
    if (!this.selected) {
      this.thinkingLevel = this.config.defaultThinkingLevel ?? this.settings.getDefaultThinkingLevel() ?? "medium";
      return;
    }
    const fallback = this.settings.getModelThinkingLevel(this.selected.provider, this.selected.id)
      ?? this.settings.getDefaultThinkingLevel()
      ?? "medium";
    this.thinkingLevel = resolveThinkingLevel(this.config, this.selected, fallback);
  }

  private async refreshAvailable(providerId?: string): Promise<void> {
    try {
      const models = await this.runtime.getAvailable(providerId);
      this.available = providerId
        ? [...this.available.filter((model) => model.provider !== providerId), ...models]
        : models;
      this.catalogError = "";
    } catch (error) {
      this.catalogError = `Could not inspect model credentials: ${(error as Error).message}`;
    }
  }

  private prompt(input: AuthPrompt, controller: AbortController): Promise<string> {
    const id = ++this.promptSequence;
    this.auth = {
      ...this.auth!,
      status: "running",
      prompt: {
        id,
        type: input.type,
        message: input.message,
        ...("placeholder" in input && input.placeholder ? { placeholder: input.placeholder } : {}),
        ...(input.type === "select" ? { options: input.options.map((option) => ({ ...option })) } : {}),
      },
    };
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        if (this.pendingPrompt?.id === id) this.pendingPrompt = undefined;
        cleanup();
        reject(new Error("Sign-in cancelled."));
      };
      const cleanup = () => {
        controller.signal.removeEventListener("abort", abort);
        input.signal?.removeEventListener("abort", abort);
      };
      this.pendingPrompt = { id, resolve, reject, cleanup };
      controller.signal.addEventListener("abort", abort, { once: true });
      input.signal?.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted || input.signal?.aborted) abort();
    });
  }

  private notify(event: AuthEvent): void {
    if (!this.auth) return;
    if (event.type === "auth_url") {
      this.auth = {
        ...this.auth,
        message: event.instructions ?? "Open this sign-in page to continue.",
        authUrl: event.url,
      };
    } else if (event.type === "device_code") {
      this.auth = {
        ...this.auth,
        message: "Open the verification page and enter this code.",
        authUrl: event.verificationUri,
        deviceCode: event.userCode,
      };
    } else {
      this.auth = {
        ...this.auth,
        message: event.message,
        ...(event.type === "info" && event.links ? { links: event.links.map((link) => ({ ...link })) } : {}),
      };
    }
  }

  private async runLogin(provider: Provider, type: AuthType, controller: AbortController): Promise<void> {
    try {
      await this.runtime.login(provider.id, type, {
        signal: controller.signal,
        prompt: (input) => this.prompt(input, controller),
        notify: (event) => this.notify(event),
      });
      await this.runtime.refresh({
        providers: [provider.id], allowNetwork: true,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const selectedValue = this.selected ? modelValue(this.selected) : undefined;
      await this.refreshAvailable(provider.id);
      const providerModels = this.available.filter((model) => model.provider === provider.id);
      const preferred = this.config.defaultModel ?? this.piDefault();
      const preferredModel = providerModels.find((model) => modelValue(model) === preferred);
      // A credential refresh must never silently replace a choice the user made in the page.
      // Catalog order is not a compatibility signal: the first Codex model, for example, can
      // be unavailable to the account that just authenticated.
      this.selected = this.available.find((model) => modelValue(model) === selectedValue) ?? preferredModel;
      this.updateThinkingLevel();
      this.auth = {
        ...this.auth!, status: "success", prompt: undefined,
        message: providerModels.length
          ? this.selected
            ? `${provider.name} is connected. Your selected model is ready.`
            : `${provider.name} is connected. Choose a model to start asking questions.`
          : `${provider.name} is connected, but it did not return any models.`,
      };
    } catch (error) {
      if (!controller.signal.aborted) {
        this.auth = {
          ...this.auth!, status: "error", prompt: undefined,
          message: (error as Error).message || `Could not connect ${provider.name}.`,
        };
      }
    } finally {
      const pending = this.pendingPrompt;
      this.pendingPrompt = undefined;
      pending?.cleanup();
      if (this.authController === controller) this.authController = undefined;
    }
  }
}
