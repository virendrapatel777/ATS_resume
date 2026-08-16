export interface MissingKeyword {
  keyword: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
}

export interface PartialKeyword {
  keyword: string;
  found_as: string;
}

export interface BulletResult {
  keyword: string;
  section: string;
  under: string;
  bullet_text: string;
  action: string;
  ats_note: string;
  human_note: string;
}

export interface AnalyzeOutput {
  report: string;
  missing_keywords: MissingKeyword[];
  partial_keywords: PartialKeyword[];
}

export interface UpdateOutput {
  bullets: BulletResult[];
  summary: string;
  updated_resume: string;
  highlighted_resume: string;
}

export interface RequestConfig {
  provider?: "groq" | "openai" | "openrouter" | "anthropic" | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

export interface StreamHandlers {
  onNotice?: (message: string) => void;
  onDelta?: (jsonText: string) => void;
  onResult?: (parsed: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

export async function consumeSse(
  response: Response,
  handlers: StreamHandlers
): Promise<void> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("Streaming is not supported in this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      try {
        const data = JSON.parse(dataLines.join("\n"));
        switch (event) {
          case "notice":
            handlers.onNotice?.(data.message ?? "");
            break;
          case "partial":
            handlers.onDelta?.(data.delta ?? "");
            break;
          case "result":
            handlers.onResult?.(data);
            break;
          case "error":
            handlers.onError?.(data.message ?? "Unknown error.");
            break;
        }
      } catch {
        /* ignore malformed frames */
      }
    }
  }
}
