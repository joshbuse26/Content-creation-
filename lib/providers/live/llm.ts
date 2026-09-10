import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "@/lib/config";
import type { LlmProvider, LlmRequest, LlmResponse } from "../types";

const DEFAULT_TIMEOUT_MS = 120_000;

/** Live LLM provider — Anthropic Messages API. */
export class AnthropicLlm implements LlmProvider {
  private client: Anthropic | undefined;

  private getClient(): Anthropic {
    if (this.client === undefined) {
      const { ANTHROPIC_API_KEY } = getConfig();
      if (ANTHROPIC_API_KEY === undefined) {
        throw new Error("ANTHROPIC_API_KEY is required for the live LLM provider");
      }
      this.client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const message = await this.getClient().messages.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.system !== undefined ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: [{ role: "user", content: req.prompt }],
      },
      { timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      stopReason:
        message.stop_reason === "end_turn"
          ? "end_turn"
          : message.stop_reason === "max_tokens"
            ? "max_tokens"
            : "other",
    };
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const stream = this.getClient().messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.system !== undefined ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: [{ role: "user", content: req.prompt }],
      },
      { timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
