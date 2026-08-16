import { useState } from "react";
import type { AppSettings } from "../lib/settings";
import { requestConfig } from "../lib/settings";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AppSettings | null;
  onSave: (settings: AppSettings) => void;
  providers: {
    id: string;
    label: string;
    defaultModel: string;
    hasEnvKey: boolean;
    placeholder: string;
  }[];
  activeEnvProvider: string | null;
}

function detectProviderFromKey(key: string): string | null {
  const k = key.trim();
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("sk-or-v1-") || k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-")) return "openai";
  return null;
}

export function SettingsModal({
  open,
  onClose,
  settings,
  onSave,
  providers,
  activeEnvProvider,
}: Props) {
  const [provider, setProvider] = useState(settings?.provider ?? activeEnvProvider ?? providers[0]?.id ?? "");
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? "");
  const [model, setModel] = useState(settings?.model ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const selected = providers.find((p) => p.id === provider);
  const effectiveModel = model.trim() || selected?.defaultModel || "";
  const hasEnvKey = selected?.hasEnvKey ?? false;
  const keyEntered = apiKey.trim().length > 0 || hasEnvKey;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          requestConfig(
            { provider, apiKey, model: effectiveModel },
            apiKey.trim() || undefined,
            effectiveModel
          )
        ),
      });
      const body = await res.json();
      if (res.ok && body.ok) {
        setTestResult({ ok: true, message: body.message });
      } else {
        setTestResult({ ok: false, message: body.error ?? "API key test failed." });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : "API key test failed.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      if (!keyEntered) {
        setTestResult({ ok: false, message: "Enter an API key or pick a provider with an .env key." });
        return;
      }
      const saved: AppSettings = {
        provider,
        apiKey: apiKey.trim(),
        model: effectiveModel,
      };
      onSave(saved);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-sky-950/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fade-in w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-sky-200">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-sky-950">⚙️ API Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-sky-500 hover:bg-sky-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-sky-900">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel("");
                setTestResult(null);
              }}
              className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.hasEnvKey ? " (env key set)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-sky-900">
              API Key
              {hasEnvKey && (
                <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  .env key will be used
                </span>
              )}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                const value = e.target.value;
                setApiKey(value);
                setTestResult(null);
                const detected = detectProviderFromKey(value);
                if (detected && detected !== provider) {
                  setProvider(detected);
                  setModel("");
                }
              }}
              placeholder={selected?.placeholder ?? "Enter your API key…"}
              className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 font-mono text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
            <p className="mt-1 text-[11px] text-sky-500">
              Your key is stored only in this browser (localStorage) and sent directly to the local API server for each request. It never leaves your machine.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-sky-900">
              Model{" "}
              <span className="font-normal text-sky-500">(optional — default shown)</span>
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={selected?.defaultModel ?? "model id"}
              className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 font-mono text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>

          {testResult && (
            <div
              className={`rounded-lg p-3 text-sm ${
                testResult.ok
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-red-50 text-red-700 ring-1 ring-red-200"
              }`}
            >
              {testResult.ok ? "✅ " : "❌ "}
              {testResult.message}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !keyEntered}
              className="flex-1 rounded-lg bg-sky-100 px-3 py-2 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-200 disabled:opacity-40"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !keyEntered}
              className="flex-1 rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-3 py-2 text-sm font-bold text-white shadow-md shadow-sky-200 transition-all hover:from-sky-600 hover:to-blue-700 disabled:opacity-40"
            >
              Save settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
