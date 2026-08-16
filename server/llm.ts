import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import OpenAI from "openai";

export type ProviderId = "groq" | "openai" | "openrouter" | "anthropic";

export interface RequestConfig {
  provider?: ProviderId | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    [key: string]: unknown;
  };
}

export interface UnifiedToolCall {
  jsonText: string;
  parsed: Record<string, unknown> | null;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  envKey: string;
  defaultModel: string;
  baseUrl: string | null;
  placeholder: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "groq",
    label: "Groq",
    envKey: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    baseUrl: null,
    placeholder: "gsk_...",
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    baseUrl: null,
    placeholder: "sk-...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    baseUrl: "https://openrouter.ai/api/v1",
    placeholder: "sk-or-v1-...",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-5",
    baseUrl: null,
    placeholder: "sk-ant-...",
  },
];

export function envProviderConfig(): RequestConfig {
  for (const p of PROVIDERS) {
    if (process.env[p.envKey]) {
      return {
        provider: p.id,
        apiKey: process.env[p.envKey],
        model:
          process.env[`${p.id.toUpperCase()}_MODEL`] ?? p.defaultModel,
      };
    }
  }
  return {};
}

export function resolveConfig(cfg?: RequestConfig | null): {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string | null;
} | null {  const providerId = cfg?.provider ?? envProviderConfig().provider;
  if (!providerId) return null;

  const info = PROVIDERS.find((p) => p.id === providerId)!;
  const apiKey = cfg?.apiKey?.trim() || process.env[info.envKey];
  if (!apiKey) return null;

  const model =
    cfg?.model?.trim() ||
    process.env[`${providerId.toUpperCase()}_MODEL`] ||
    info.defaultModel;
  const baseUrl = cfg?.baseUrl?.trim() || info.baseUrl;

  return { provider: providerId, apiKey, model, baseUrl };
}

export function friendlyError(raw: string, provider: ProviderId): Error {
  const rate = /rate_limit_exceeded|rate limit|Too many requests|429/i.test(raw);
  const tpm = /tokens per minute \(TPM\)/i.test(raw);
  const tpd = /tokens per day \(TPD\)/i.test(raw);
  const retry = raw.match(/try again in ([\d.]+s|[\d.]+m[\d.]*s)/i)?.[1];

  if (rate && (tpm || tpd)) {
    return new Error(
      `${providerLabel(provider)} rate limit hit${tpd ? " (daily limit)" : " (per-minute limit)"}. ` +
        `Wait ${retry ?? "a minute"} and retry, or use another provider.`
    );
  }
  if (/invalid api key|incorrect api key|authentication|401|unauthorized/i.test(raw)) {
    return new Error(
      `The ${providerLabel(provider)} API key is invalid or expired. Check it in Settings.`
    );
  }
  if (/insufficient_quota|billing|quota|no credits|insufficient credits/i.test(raw)) {
    return new Error(
      `${providerLabel(provider)} account has no remaining credits/quota. Add credits or use another provider.`
    );
  }
  if (/no endpoints found matching your data policy|no provider enabled/i.test(raw)) {
    return new Error(
      `OpenRouter has no endpoint available for this model right now. Try another model id, or use "meta-llama/llama-3.3-70b-instruct:free".`
    );
  }
  if (/does not support|tool_choice.*invalid|invalid.*tool_choice|tools are not supported/i.test(raw)) {
    return new Error(
      `The selected model doesn't support forced tool calls. Pick a different model (e.g. "meta-llama/llama-3.3-70b-instruct:free" or "openai/gpt-4o-mini").`
    );
  }
  if (/request too large/i.test(raw)) {
    return new Error("Input is too large for this provider. Shorten the resume/JD text and retry.");
  }
  if (rate) {
    return new Error(
      `${providerLabel(provider)} is rate-limited${retry ? ` (retry in ${retry})` : ""}. Try another provider.`
    );
  }
  if (/timed out|timeout|ETIMEDOUT/i.test(raw)) {
    return new Error(`${providerLabel(provider)} timed out. Please retry.`);
  }
  return new Error(raw);
}

function providerLabel(id: ProviderId): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function streamToolUse(args: {
  system: string;
  userContent: string;
  tool: ToolSpec;
  config?: RequestConfig | null;
  maxTokens?: number;
  onDelta: (partialJson: string, isDone: boolean) => void;
  onNotice?: (message: string) => void;
}): Promise<UnifiedToolCall> {
  const resolved = resolveConfig(args.config);
  if (!resolved) {
    throw new Error(
      "No LLM provider configured. Open Settings to enter an API key, or set one in .env."
    );
  }

  try {
    const acc =
      resolved.provider === "anthropic"
        ? await streamAnthropic(resolved, args)
        : resolved.provider === "groq"
          ? await streamGroq(resolved, args)
          : await streamOpenAiCompatible(resolved, args);

    if (!acc.parsed) {
      throw new Error(
        `The model (${resolved.model}) didn't return usable structured output. ` +
          `Try again, or switch model/provider in Settings.`
      );
    }
    return acc;
  } catch (e) {
    if (e instanceof Error && e.name === "FriendlyLlmError") throw e;
    throw friendlyError(e instanceof Error ? e.message : String(e), resolved.provider);
  }
}

class FriendlyLlmError extends Error {
  name = "FriendlyLlmError";
}

function openAiTool(tool: ToolSpec) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

async function streamAnthropic(
  resolved: { apiKey: string; model: string },
  args: {
    system: string;
    userContent: string;
    tool: ToolSpec;
    maxTokens?: number;
    onDelta: (partialJson: string, isDone: boolean) => void;
  }
): Promise<UnifiedToolCall> {
  const client = new Anthropic({ apiKey: resolved.apiKey });
  let jsonText = "";

  const stream = await client.messages.create(
    {
      model: resolved.model,
      max_tokens: args.maxTokens ?? 12000,
      system: args.system,
      messages: [{ role: "user", content: args.userContent }],
      tools: [
        {
          name: args.tool.name,
          description: args.tool.description,
          input_schema: args.tool.inputSchema,
        },
      ],
      tool_choice: { type: "tool", name: args.tool.name },
      stream: true,
    },
    { maxRetries: 1 }
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      const delta = event.delta as { partial_json?: string; type?: string };
      if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        jsonText += delta.partial_json;
        args.onDelta(delta.partial_json, false);
      }
    }
  }

  args.onDelta("", true);
  return { jsonText, parsed: tryParseJson(jsonText) };
}

async function streamGroq(
  resolved: { apiKey: string; model: string },
  args: {
    system: string;
    userContent: string;
    tool: ToolSpec;
    maxTokens?: number;
    onDelta: (partialJson: string, isDone: boolean) => void;
    onNotice?: (message: string) => void;
  }
): Promise<UnifiedToolCall> {
  const client = new Groq({ apiKey: resolved.apiKey });
  let jsonText = "";
  let contentText = "";

  const inputChars = args.system.length + args.userContent.length;
  const estimatedInputTokens = Math.ceil(inputChars / 4);
  const remaining = 12000 - estimatedInputTokens - 500;
  const max_tokens = Math.min(args.maxTokens ?? 12000, Math.max(remaining, 512));
  if (max_tokens < (args.maxTokens ?? 12000)) {
    args.onNotice?.(
      `Groq free tier has a 12K token-per-minute limit. Output budget reduced to ${max_tokens} tokens — long reports may be cut off.`
    );
  }

  const stream = await client.chat.completions.create(
    {
      model: resolved.model,
      max_tokens,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.userContent },
      ],
      tools: [openAiTool(args.tool)],
      tool_choice: { type: "function", function: { name: args.tool.name } },
      stream: true,
    },
    { maxRetries: 1 }
  );

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const delta = choice?.delta?.tool_calls?.[0]?.function?.arguments;
    if (typeof delta === "string" && delta.length > 0) {
      jsonText += delta;
      args.onDelta(delta, false);
    }
    const contentDelta = choice?.delta?.content;
    if (typeof contentDelta === "string") {
      contentText += contentDelta;
    }
  }

  args.onDelta("", true);

  if (jsonText.length === 0 && contentText.length > 0) {
    const fenced = contentText.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced?.[1] ?? contentText;
    jsonText = extractJsonObject(candidate);
    if (jsonText.length > 0) {
      args.onDelta(jsonText, false);
      args.onDelta("", true);
    }
  }

  return { jsonText, parsed: tryParseJson(jsonText) };
}

async function streamOpenAiCompatible(
  resolved: { apiKey: string; model: string; baseUrl: string | null; provider: ProviderId },
  args: {
    system: string;
    userContent: string;
    tool: ToolSpec;
    maxTokens?: number;
    onDelta: (partialJson: string, isDone: boolean) => void;
  }
): Promise<UnifiedToolCall> {
  const client = new OpenAI({
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl ?? undefined,
    defaultHeaders: resolved.provider === "openrouter"
      ? { "HTTP-Referer": "http://localhost:5173", "X-Title": "ATS Resume Builder" }
      : undefined,
  });
  let jsonText = "";
  let contentText = "";

  const stream = await client.chat.completions.create(
    {
      model: resolved.model,
      max_tokens: args.maxTokens ?? 8000,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.userContent },
      ],
      tools: [openAiTool(args.tool)],
      tool_choice: { type: "function", function: { name: args.tool.name } },
      stream: true,
    },
    { maxRetries: 1 }
  );

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const toolDelta = choice?.delta?.tool_calls?.[0]?.function?.arguments;
    if (typeof toolDelta === "string" && toolDelta.length > 0) {
      jsonText += toolDelta;
      args.onDelta(toolDelta, false);
    }
    const contentDelta = choice?.delta?.content;
    if (typeof contentDelta === "string") {
      contentText += contentDelta;
    }
  }

  args.onDelta("", true);

  if (jsonText.length === 0 && contentText.length > 0) {
    const fenced = contentText.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced?.[1] ?? contentText;
    jsonText = extractJsonObject(candidate);
    if (jsonText.length > 0) {
      args.onDelta(jsonText, false);
      args.onDelta("", true);
    }
  }

  return { jsonText, parsed: tryParseJson(jsonText) };
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "";
  return text.slice(start, end + 1);
}

export async function testProviderKey(config: RequestConfig): Promise<string> {
  const resolved = resolveConfig(config);
  if (!resolved) {
    throw new Error("Please enter an API key.");
  }

  const label = providerLabel(resolved.provider);

  if (resolved.provider === "anthropic") {
    const client = new Anthropic({ apiKey: resolved.apiKey });
    try {
      await client.messages.create(
        {
          model: resolved.model,
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        },
        { maxRetries: 0, timeout: 20000 }
      );
      return `${label} ✓ — API key works`;
    } catch (e) {
      throw friendlyError(e instanceof Error ? e.message : String(e), resolved.provider);
    }
  }

  if (resolved.provider === "groq") {
    const client = new Groq({ apiKey: resolved.apiKey });
    try {
      await client.chat.completions.create(
        {
          model: resolved.model,
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        },
        { maxRetries: 0, timeout: 20000 }
      );
      return `${label} ✓ — API key works`;
    } catch (e) {
      throw friendlyError(e instanceof Error ? e.message : String(e), resolved.provider);
    }
  }

  // openai / openrouter
  const client = new OpenAI({
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl ?? undefined,
    defaultHeaders: resolved.provider === "openrouter"
      ? { "HTTP-Referer": "http://localhost:5173", "X-Title": "ATS Resume Builder" }
      : undefined,
  });
  try {
    await client.chat.completions.create(
      {
        model: resolved.model,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      },
      { maxRetries: 0, timeout: 20000 }
    );
    return `${label} ✓ — API key works`;
  } catch (e) {
    throw friendlyError(e instanceof Error ? e.message : String(e), resolved.provider);
  }
}

export const analyzeToolSpec: ToolSpec = {
  name: "output_analysis_report",
  description:
    "Deliver the complete ATS analysis report and the structured keyword lists.",
  inputSchema: {
    type: "object",
    properties: {
      report: {
        type: "string",
        description:
          "The full ATS analysis report exactly following the MANDATORY OUTPUT FORMAT",
      },
      missing_keywords: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          },
          required: ["keyword", "priority"],
        },
      },
      partial_keywords: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            found_as: { type: "string" },
          },
          required: ["keyword", "found_as"],
        },
      },
    },
    required: ["report", "missing_keywords", "partial_keywords"],
  },
};

export const updateToolSpec: ToolSpec = {
  name: "output_skill_bullets",
  description:
    "Deliver the generated resume bullets, the updated resume, the highlighted resume, and the final summary.",
  inputSchema: {
    type: "object",
    properties: {
      bullets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            section: { type: "string" },
            under: { type: "string" },
            bullet_text: { type: "string" },
            action: { type: "string" },
            ats_note: { type: "string" },
            human_note: { type: "string" },
          },
          required: [
            "keyword",
            "section",
            "under",
            "bullet_text",
            "action",
            "ats_note",
            "human_note",
          ],
        },
      },
      summary: { type: "string" },
      updated_resume: {
        type: "string",
        description:
          "The complete updated resume as plain text with every generated bullet inserted into the appropriate section. Preserve the original structure, contact details, company names, dates, and formatting.",
      },
      highlighted_resume: {
        type: "string",
        description:
          "The same updated resume where every inserted or modified line starts with a plus marker '+' so changes can be highlighted in the UI.",
      },
    },
    required: ["bullets", "summary", "updated_resume", "highlighted_resume"],
  },
};
