"use strict";

const { Anthropic } = require("@anthropic-ai/sdk");

// Models that take the server-side refusal fallback ("default" picks the substitute by
// refusal category). Older models reject the parameter, so it is only sent to these.
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Claude through the Anthropic SDK. Credentials come from the environment
 * (ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN), as the SDK resolves them.
 */
class AnthropicProvider {
  static isConfigured(env = process.env) {
    return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  }

  constructor(options = {}) {
    this.name = "anthropic";
    this.model = options.model ?? "claude-opus-5-5";
    this.effort = options.effort === null ? null : options.effort ?? "low";
    this.client = options.client ?? new Anthropic({ timeout: options.timeoutMs ?? 45000, maxRetries: 1 });
  }

  /**
   * One request, no conversation: `system` is the same for every bot (cached), `prompt` is
   * this bot's situation. Returns the tool calls; text outside them is ignored.
   */
  async generate({ system, prompt, tools }) {
    const request = {
      model: this.model,
      max_tokens: 4000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        strict: true,
      })),
      messages: [{ role: "user", content: prompt }],
    };
    if (this.effort) {
      request.output_config = { effort: this.effort };
    }
    if (FALLBACK_MODELS.test(this.model)) {
      request.betas = [FALLBACK_BETA];
      request.fallbacks = "default";
    }
    const response = await this.client.beta.messages.create(request);
    const usage = {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
      cacheRead: response.usage?.cache_read_input_tokens ?? 0,
    };
    if (response.stop_reason === "refusal") {
      return { calls: [], text: "", refused: true, usage };
    }
    const calls = [];
    const text = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        calls.push({ name: block.name, input: block.input ?? {} });
      } else if (block.type === "text") {
        text.push(block.text);
      }
    }
    return { calls, text: text.join("\n").trim(), refused: false, usage };
  }
}

module.exports = { AnthropicProvider };
