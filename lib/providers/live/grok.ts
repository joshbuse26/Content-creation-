import { getConfig, LLM_MODELS } from "@/lib/config";
import type { LlmProvider, LlmRequest, LlmResponse } from "../types";

const DEFAULT_TIMEOUT_MS = 120_000;
const API_URL = "https://api.x.ai/v1/chat/completions";

interface GrokMessage {
  role: "system" | "user";
  content: string;
}

interface GrokUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface GrokCompletion {
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: GrokUsage;
}

interface GrokStreamChunk {
  choices?: {
    delta?: { content?: string | null };
  }[];
}

/**
 * Live LLM provider — xAI Grok, OpenAI-compatible chat completions.
 *
 * Callers address models by the canonical tier IDs in LLM_MODELS (the frozen
 * LlmRequest contract); this provider translates each tier to its Grok
 * equivalent (XAI_MODEL_MAIN / XAI_MODEL_FAST, env-overridable) so the whole
 * pipeline switches backends with LLM_BACKEND alone.
 */
export class GrokLlm implements LlmProvider {
  private headers(): Record<string, string> {
    const { XAI_API_KEY } = getConfig();
    if (XAI_API_KEY === undefined) {
      throw new Error("XAI_API_KEY is required for the Grok LLM backend");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    };
  }

  private translateModel(model: LlmRequest["model"]): string {
    const { XAI_MODEL_MAIN, XAI_MODEL_FAST } = getConfig();
    return model === LLM_MODELS.haiku ? XAI_MODEL_FAST : XAI_MODEL_MAIN;
  }

  private body(req: LlmRequest, stream: boolean): string {
    const messages: GrokMessage[] = [];
    if (req.system !== undefined) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    return JSON.stringify({
      model: this.translateModel(req.model),
      messages,
      max_tokens: req.maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(stream ? { stream: true } : {}),
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: this.headers(),
      body: this.body(req, false),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Grok API error: HTTP ${String(res.status)}`);
    }
    const data = (await res.json()) as GrokCompletion;
    const choice = data.choices?.[0];
    const finish = choice?.finish_reason ?? null;
    return {
      text: choice?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      stopReason: finish === "stop" ? "end_turn" : finish === "length" ? "max_tokens" : "other",
    };
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: this.headers(),
      body: this.body(req, true),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok || res.body === null) {
      throw new Error(`Grok API error: HTTP ${String(res.status)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return;
          let chunk: GrokStreamChunk;
          try {
            chunk = JSON.parse(payload) as GrokStreamChunk;
          } catch {
            continue; // partial frame split across reads lands in buffer next pass
          }
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta !== undefined && delta !== null && delta !== "") yield delta;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
