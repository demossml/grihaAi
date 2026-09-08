import { createInterface } from "node:readline/promises";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GrishAiConfig, GrishAiProvider, ModelConfig } from "@griha/shared-types";
import {
  applyConfig,
  CUSTOM_BASE_URL_DEFAULT,
} from "../../../src/utils/provider-bootstrap.js";
import {
  configExists,
  getConfigPath,
  loadConfig,
  saveConfig,
} from "@griha/config";
import { getModelsForProvider } from "../../../src/utils/model-catalog.js";

interface ProviderDef {
  id: GrishAiProvider;
  label: string;
  /** Environment variable that supplies the API key for built-in providers. */
  envKey?: string;
}

const PROVIDERS: ProviderDef[] = [
  { id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
  { id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
  { id: "google", label: "Google (Gemini)", envKey: "GEMINI_API_KEY" },
  { id: "xai", label: "xAI", envKey: "XAI_API_KEY" },
  { id: "deepseek", label: "DeepSeek", envKey: "DEEPSEEK_API_KEY" },
  { id: "custom", label: "Custom endpoint", envKey: "CUSTOM_API_KEY" },
];

const CUSTOM_MODEL_OPTION = "Type custom model name";

/** Env vars already present in the shell before this extension started. */
const ORIGINAL_ENV_KEYS = new Set(Object.keys(process.env));

function envKeyDetected(def: ProviderDef): boolean {
  return Boolean(def.envKey && ORIGINAL_ENV_KEYS.has(def.envKey));
}

function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

async function askApiKey(ctx: ExtensionContext, def: ProviderDef): Promise<string | undefined> {
  if (envKeyDetected(def)) return undefined; // genuinely present in the user's shell
  const entered = await ctx.ui.input(`Enter your ${def.label} API key (or Enter to skip):`, "sk-...");
  return entered && entered.trim() ? entered.trim() : undefined;
}

async function selectProvider(ctx: ExtensionContext): Promise<ProviderDef | undefined> {
  const chosen = await ctx.ui.select(
    "Choose provider:",
    PROVIDERS.map((p) => p.label),
  );
  if (!chosen) return undefined;
  return PROVIDERS.find((p) => p.label === chosen);
}

async function selectModel(ctx: ExtensionContext, def: ProviderDef): Promise<string | undefined> {
  const models = getModelsForProvider(def.id);
  if (models.length === 0) {
    const custom = await ctx.ui.input("Model name (free text):", "");
    return custom?.trim() || undefined;
  }
  const options = [
    ...models.map((m) => `${m.name} → ${m.id}`),
    CUSTOM_MODEL_OPTION,
  ];
  const choice = await ctx.ui.select(`Choose model for ${def.label}:`, options);
  if (!choice) return undefined;
  if (choice === CUSTOM_MODEL_OPTION) {
    const custom = await ctx.ui.input("Type model id:", "");
    return custom?.trim() || undefined;
  }
  const idx = options.indexOf(choice);
  return models[idx]?.id;
}

async function selectBaseUrl(ctx: ExtensionContext): Promise<string | undefined> {
  const url = await ctx.ui.input("Base URL (OpenAI-compatible):", CUSTOM_BASE_URL_DEFAULT);
  return url?.trim() || CUSTOM_BASE_URL_DEFAULT;
}

async function runWizard(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  ctx.ui.notify("Welcome to Grish-AI!", "info");

  const def = await selectProvider(ctx);
  if (!def) return;

  if (envKeyDetected(def)) {
    ctx.ui.notify(`API key detected from ${def.envKey}.`, "info");
  }
  const apiKey = await askApiKey(ctx, def);

  const model = await selectModel(ctx, def);
  if (!model) return;

  let baseUrl: string | undefined;
  if (def.id === "custom") {
    baseUrl = await selectBaseUrl(ctx);
  }

  const main: ModelConfig = {
    provider: def.id,
    model,
    apiKey,
    baseUrl: def.id === "custom" ? baseUrl : undefined,
  };

  let vision: ModelConfig | undefined;
  const addVision = await ctx.ui.confirm(
    "Настроить vision-модель?",
    "Для картинок и OCR. Можно пропустить и добавить позже через /setup.",
  );
  if (addVision) {
    const visionDef = await selectProvider(ctx);
    if (visionDef) {
      const visionModel = await selectModel(ctx, visionDef);
      if (visionModel) {
        const visionKey = visionDef.id === def.id ? apiKey : await askApiKey(ctx, visionDef);
        let visionBaseUrl: string | undefined;
        if (visionDef.id === "custom") visionBaseUrl = await selectBaseUrl(ctx);
        vision = {
          provider: visionDef.id,
          model: visionModel,
          apiKey: visionKey,
          baseUrl: visionBaseUrl,
        };
      }
    }
  }

  const cfg: GrishAiConfig = {
    version: 1,
    provider: def.id,
    model,
    apiKey,
    baseUrl,
    setupCompletedAt: new Date().toISOString(),
    models: { main, ...(vision ? { vision } : {}) },
  };
  saveConfig(cfg);
  await applyConfig(pi, ctx, cfg);

  ctx.ui.notify(
    `Provider: ${def.id} · Model: ${model}${vision ? ` · Vision: ${vision.provider}/${vision.model}` : ""} · saved to ${getConfigPath()}. Change later with /model or /setup.`,
    "info",
  );
}

async function selectModelReadline(
  rl: ReturnType<typeof createInterface>,
  def: ProviderDef,
): Promise<string | undefined> {
  const models = getModelsForProvider(def.id);
  if (models.length === 0) {
    const custom = (await rl.question("Model name (free text): ")).trim();
    return custom || undefined;
  }
  process.stdout.write(`Choose model for ${def.label}:\n`);
  models.forEach((m, i) => process.stdout.write(`  [${i + 1}] ${m.name} → ${m.id}\n`));
  process.stdout.write(`  [${models.length + 1}] Type custom model name\n`);
  const raw = (await rl.question("> ")).trim();
  const idx = Number.parseInt(raw, 10) - 1;
  if (idx >= 0 && idx < models.length) return models[idx].id;
  if (idx === models.length) {
    const custom = (await rl.question("Type model id: ")).trim();
    return custom || undefined;
  }
  return undefined;
}

/** Terminal fallback for environments without pi's TUI (readline/promises). */
async function runWizardReadline(): Promise<GrishAiConfig | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("\nWelcome to Grish-AI!\n\n");
    process.stdout.write("It looks like this is the first run. Let's set up your model.\n\n");
    process.stdout.write("Choose provider:\n");
    PROVIDERS.forEach((p, i) => process.stdout.write(`  [${i + 1}] ${p.label}\n`));
    const idxRaw = (await rl.question("> ")).trim();
    const idx = Number.parseInt(idxRaw, 10) - 1;
    const def = PROVIDERS[idx];
    if (!def) return null;

    let apiKey: string | undefined;
    if (envKeyDetected(def)) {
      process.stdout.write(`API key detected from ${def.envKey}.\n`);
    } else {
      const key = (await rl.question(`Enter your ${def.label} API key: `)).trim();
      if (key) apiKey = key;
    }

    const model = await selectModelReadline(rl, def);
    if (!model) return null;

    let baseUrl: string | undefined;
    if (def.id === "custom") {
      const url = (await rl.question("Base URL (OpenAI-compatible): ")).trim();
      baseUrl = url || CUSTOM_BASE_URL_DEFAULT;
    }

    return {
      version: 1,
      provider: def.id,
      model,
      apiKey,
      baseUrl,
      setupCompletedAt: new Date().toISOString(),
    };
  } finally {
    rl.close();
  }
}

async function runFirstRunSetup(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (ctx.hasUI && ctx.mode === "tui") {
    await runWizard(pi, ctx);
    return;
  }
  if (Boolean(process.stdin.isTTY)) {
    const cfg = await runWizardReadline();
    if (cfg) {
      saveConfig(cfg);
      await applyConfig(pi, ctx, cfg);
      process.stdout.write(`Configuration saved to ${getConfigPath()}\n`);
    }
    return;
  }
  process.stderr.write(
    "[grish-ai] First run detected, but no interactive UI is available. Run `pi` interactively to complete setup.\n",
  );
}

async function persistModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  current: GrishAiConfig,
  provider: GrishAiProvider,
  model: string,
  baseUrl?: string,
): Promise<void> {
  const providerChanged = provider !== current.provider;
  const next: GrishAiConfig = {
    ...current,
    provider,
    model,
    apiKey: providerChanged ? undefined : current.apiKey,
    baseUrl: provider === "custom" ? (baseUrl ?? current.baseUrl) : undefined,
    setupCompletedAt: new Date().toISOString(),
    models: {
      ...current.models,
      main: {
        provider,
        model,
        apiKey: providerChanged ? undefined : current.apiKey,
        baseUrl: provider === "custom" ? (baseUrl ?? current.baseUrl) : undefined,
      },
    },
  };
  saveConfig(next);
  const ok = await applyConfig(pi, ctx, next);
  if (ok) {
    ctx.ui.notify(`Model set to ${provider}/${model}.`, "info");
  }
  if (providerChanged) {
    ctx.ui.notify("Provider changed — run /setup if a new API key is needed.", "warning");
  }
}

export default function firstRunSetup(pi: ExtensionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup") return;

    if (!configExists()) {
      await runFirstRunSetup(pi, ctx);
      return;
    }

    const cfg = loadConfig();
    if (cfg) {
      await applyConfig(pi, ctx, cfg);
    }
  });

  pi.registerCommand("setup", {
    description: "Run the first-run setup wizard again",
    async handler(_args, ctx) {
      await runWizard(pi, ctx);
    },
  });

  pi.registerCommand("model", {
    description: "Change model (and optionally provider)",
    async handler(args, ctx) {
      const current = loadConfig();
      if (!current) {
        ctx.ui.notify("No config found — run /setup first.", "error");
        return;
      }

      const trimmed = args.trim();
      if (trimmed) {
        let provider = current.provider;
        let model = trimmed;
        const slash = trimmed.indexOf("/");
        if (slash > 0) {
          const prov = trimmed.slice(0, slash);
          const mod = trimmed.slice(slash + 1);
          if (providerById(prov)) provider = prov as GrishAiProvider;
          if (mod) model = mod;
        }
        await persistModel(pi, ctx, current, provider, model);
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("/model needs interactive mode.", "error");
        return;
      }

      const currentLabel = providerById(current.provider)?.label ?? current.provider;
      const keep = `Keep provider (${currentLabel}) and choose another model`;
      const change = "Change provider + model";
      const cancel = "Cancel";
      const choice = await ctx.ui.select(
        `Current: ${current.provider} / ${current.model}`,
        [keep, change, cancel],
      );
      if (!choice || choice === cancel) return;

      if (choice === keep) {
        const def = providerById(current.provider);
        if (!def) {
          ctx.ui.notify("Unknown provider in config.", "error");
          return;
        }
        const model = await selectModel(ctx, def);
        if (!model) return;
        await persistModel(pi, ctx, current, def.id, model);
        return;
      }

      const def = await selectProvider(ctx);
      if (!def) return;
      const model = await selectModel(ctx, def);
      if (!model) return;

      let baseUrl: string | undefined;
      if (def.id === "custom") baseUrl = await selectBaseUrl(ctx);

      await persistModel(pi, ctx, current, def.id, model, baseUrl);
    },
  });
}
