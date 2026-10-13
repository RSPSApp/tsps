"use strict";

/**
 * A local model through Ollama's chat API (OLLAMA_URL, e.g. http://localhost:11434). Free to
 * run, so an owner without a paid key can still have AI bots; pick a model with tool calling
 * (llama3.1, qwen2.5, mistral-nemo ...).
 */
class OllamaProvider {
  static isConfigured(env = process.env) {
    return Boolean(env.OLLAMA_URL);
  }

  constructor(options = {}) {
    this.name = "ollama";
    this.model = options.model ?? "llama3.1";
    this.url = String(options.url ?? process.env.OLLAMA_URL ?? "").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 45000;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async generate({ system, prompt, tools }) {
    const response = await this.fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        tools: tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const body = await response.json();
    const message = body?.message ?? {};
    const calls = (message.tool_calls ?? []).flatMap((call) => {
      const name = call?.function?.name;
      let input = call?.function?.arguments ?? {};
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          return [];
        }
      }
      return name ? [{ name, input }] : [];
    });
    return {
      calls,
      text: String(message.content ?? "").trim(),
      refused: false,
      usage: { input: body?.prompt_eval_count ?? 0, output: body?.eval_count ?? 0, cacheRead: 0 },
    };
  }
}

module.exports = { OllamaProvider };
