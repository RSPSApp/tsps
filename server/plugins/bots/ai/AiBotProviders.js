"use strict";

const { AnthropicProvider } = require("./providers/AnthropicProvider");
const { OllamaProvider } = require("./providers/OllamaProvider");

/**
 * The model backends. Each one reads its own key or URL from the environment (.env), never
 * from world config; one without it is left out. Adding a backend (OpenAI, Gemini ...) is a
 * class with isConfigured() and generate({ system, prompt, tools }) -> { calls, text }, listed here.
 */
const PROVIDER_CLASSES = Object.freeze({
  anthropic: AnthropicProvider,
  ollama: OllamaProvider,
});

/**
 * The config's provider entries whose backend is configured, each with a client.
 * `log` reports the ones skipped, once.
 */
function createProviders(entries, options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const providers = [];
  for (const entry of entries ?? []) {
    const Provider = PROVIDER_CLASSES[entry?.provider];
    if (!Provider) {
      log("ai_bot_provider_unknown", { provider: entry?.provider ?? null });
      continue;
    }
    if (!Provider.isConfigured(env)) {
      log("ai_bot_provider_not_configured", { provider: entry.provider });
      continue;
    }
    providers.push(new Provider({ ...entry, timeoutMs: options.timeoutMs }));
  }
  return providers;
}

/** The provider a bot uses: its saved one when still available, else the next round-robin. */
function providerFor(providers, saved, index) {
  if (providers.length === 0) {
    return null;
  }
  const match = providers.find(
    (provider) => provider.name === saved?.provider && provider.model === saved?.model
  );
  return match ?? providers[index % providers.length];
}

module.exports = { PROVIDER_CLASSES, createProviders, providerFor };
