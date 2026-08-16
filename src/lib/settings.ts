import type { RequestConfig } from "../lib/stream";

export interface ProviderInfo {
  id: string;
  label: string;
  defaultModel: string;
  hasEnvKey: boolean;
  placeholder: string;
}

export interface AppSettings {
  provider: string;
  apiKey: string;
  model: string;
}

const STORAGE_KEY = "ats-builder-settings";

export function loadSettings(): AppSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    if (!parsed.provider) return null;
    return {
      provider: String(parsed.provider),
      apiKey: String(parsed.apiKey ?? ""),
      model: String(parsed.model ?? ""),
    };
  } catch {
    return null;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function requestConfig(
  settings: AppSettings | null,
  apiKeyOverride?: string,
  modelOverride?: string
): RequestConfig {
  if (!settings) return {};
  return {
    provider: settings.provider as RequestConfig["provider"],
    apiKey: apiKeyOverride ?? (settings.apiKey || null),
    model: modelOverride ?? (settings.model || null),
  };
}

export async function fetchConfig(): Promise<{
  providers: ProviderInfo[];
  activeProvider: string | null;
  activeModel: string | null;
  baseUrl: string | null;
}> {
  const res = await fetch("/api/config");
  return res.json();
}
