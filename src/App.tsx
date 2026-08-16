import { useEffect, useRef, useState } from "react";
import type { AnalyzeOutput, BulletResult, MissingKeyword, PartialKeyword, UpdateOutput } from "./lib/stream";
import { consumeSse } from "./lib/stream";
import { renderMarkdown } from "./lib/markdown";
import { SettingsModal } from "./components/SettingsModal";
import {
  fetchConfig,
  loadSettings,
  requestConfig,
  type AppSettings,
  type ProviderInfo,
} from "./lib/settings";

type Phase = "input" | "analyzing" | "select" | "updating" | "done";

function tryExtract<T extends keyof AnalyzeOutput & keyof UpdateOutput>(
  jsonText: string,
  field: string
): string | null {
  try {
    const parsed = JSON.parse(jsonText);
    const value = parsed?.[field];
    if (typeof value === "string") return value;
  } catch {
    /* incomplete JSON while streaming */
  }
  return null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadTxt(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

function normalizeKeywords(raw: unknown): MissingKeyword[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MissingKeyword[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      out.push({ keyword: entry.trim(), priority: "MEDIUM" });
    } else if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).keyword === "string"
    ) {
      const k = entry as { keyword: string; priority?: MissingKeyword["priority"] };
      out.push({
        keyword: k.keyword,
        priority: k.priority === "HIGH" || k.priority === "LOW" ? k.priority : "MEDIUM",
      });
    }
  }
  return out;
}

function normalizePartial(raw: unknown): PartialKeyword[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PartialKeyword[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      out.push({ keyword: entry.trim(), found_as: "" });
    } else if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).keyword === "string"
    ) {
      const k = entry as { keyword: string; found_as?: string };
      out.push({ keyword: k.keyword, found_as: k.found_as ?? "" });
    }
  }
  return out;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("input");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeEnvProvider, setActiveEnvProvider] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState("");
  const [jd, setJd] = useState("");
  const [resume, setResume] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [reportJson, setReportJson] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingKeyword[]>([]);
  const [partial, setPartial] = useState<PartialKeyword[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [bullets, setBullets] = useState<BulletResult[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [updatedResume, setUpdatedResume] = useState<string | null>(null);
  const [highlightedResume, setHighlightedResume] = useState<string | null>(null);

  const [copiedBullet, setCopiedBullet] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSettings(loadSettings());
    fetchConfig()
      .then((c) => {
        setProviders(c.providers ?? []);
        setActiveEnvProvider(c.activeProvider ?? null);
        if (!loadSettings()) {
          const envModel = c.activeModel;
          if (envModel) setModel(envModel);
        } else {
          setModel(loadSettings()?.model ?? "");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [reportJson]);

  async function handleFile(file: File | undefined | null) {
    setFileError(null);
    if (!file) return;
    setParsing(true);
    try {
      const form = new FormData();
      form.append("resumePdf", file);
      const res = await fetch("/api/parse-pdf", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "PDF parsing failed.");
      setFileName(file.name);
      setResume(body.text);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "PDF parsing failed.");
    } finally {
      setParsing(false);
    }
  }

  const activeLabel = settings
    ? providers.find((p) => p.id === settings.provider)?.label ?? settings.provider
    : providers.find((p) => p.id === activeEnvProvider)?.label ?? null;
  const hasKey =
    (settings && (settings.apiKey.length > 0 ||
      providers.find((p) => p.id === settings.provider)?.hasEnvKey)) ||
    (!settings && Boolean(activeEnvProvider));

  async function handleAnalyze() {
    setPhase("analyzing");
    setError(null);
    setNotice(null);
    setReportJson("");
    setReport(null);
    setMissing([]);
    setPartial([]);
    setBullets([]);
    setSummary(null);
    setUpdatedResume(null);
    setHighlightedResume(null);

    try {
      await consumeSse(
        await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume,
            jd,
            ...requestConfig(settings),
          }),
        }),
        {
          onNotice: (m) => setNotice(m),
          onDelta: (d) => setReportJson((prev) => prev + d),
          onResult: (parsed) => {
            const out = parsed as unknown as AnalyzeOutput;
            if (out.report) setReport(out.report);
            const missingNorm = normalizeKeywords(out.missing_keywords);
            if (missingNorm) {
              setMissing(missingNorm);
              setSelected((prev) => {
                const next = new Set(prev);
                for (const k of missingNorm) next.add(k.keyword);
                return next;
              });
            }
            const partialNorm = normalizePartial(out.partial_keywords);
            if (partialNorm) {
              setPartial(partialNorm);
              setSelected((prev) => {
                const next = new Set(prev);
                for (const k of partialNorm) next.add(k.keyword);
                return next;
              });
            }
          },
          onError: (m) => setError(m),
        }
      );
      setPhase((p) => (p === "analyzing" ? "select" : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
      setPhase("input");
    }
  }

  async function handleGenerate() {
    setPhase("updating");
    setError(null);
    setNotice(null);
    setBullets([]);
    setSummary(null);
    setUpdatedResume(null);
    setHighlightedResume(null);

    try {
      await consumeSse(
        await fetch("/api/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume,
            keywords: Array.from(selected),
            ...requestConfig(settings),
          }),
        }),
        {
          onNotice: (m) => setNotice(m),
          onDelta: (d) => setReportJson((prev) => prev + d),
          onResult: (parsed) => {
            const out = parsed as unknown as UpdateOutput;
            if (Array.isArray(out.bullets)) setBullets(out.bullets);
            if (typeof out.summary === "string") setSummary(out.summary);
            if (typeof out.updated_resume === "string") setUpdatedResume(out.updated_resume);
            if (typeof out.highlighted_resume === "string") {
              setHighlightedResume(out.highlighted_resume);
            }
          },
          onError: (m) => setError(m),
        }
      );
      setPhase((p) => (p === "updating" ? "done" : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bullet generation failed.");
      setPhase("select");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function handleDownloadPdf() {
    if (!updatedResume) return;
    setPdfBusy(true);
    try {
      const res = await fetch("/api/download-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: updatedResume, filename: "updated-resume" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "PDF generation failed.");
      }
      downloadBlob(await res.blob(), "updated-resume.pdf");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF generation failed.");
    } finally {
      setPdfBusy(false);
    }
  }

  function toggleKeyword(k: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function handleStartOver() {
    setPhase("input");
    setJd("");
    setResume("");
    setFileName(null);
    setReportJson("");
    setReport(null);
    setMissing([]);
    setPartial([]);
    setSelected(new Set());
    setError(null);
    setNotice(null);
    setBullets([]);
    setSummary(null);
    setUpdatedResume(null);
    setHighlightedResume(null);
  }

  const liveReport = tryExtract(reportJson, "report");
  const totalKeywords = missing.length + partial.length;
  const allKeywords = [...missing.map((m) => m.keyword), ...partial.map((p) => p.keyword)];
  const canAnalyze = jd.trim().length > 0 && resume.trim().length > 0 && phase !== "analyzing";

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-3xl shadow-lg shadow-sky-200">
            📄
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-sky-950 sm:text-4xl">
            ATS Resume Builder
          </h1>
          <p className="max-w-xl text-sm text-sky-700">
            Analyze your resume against any job description, then generate ATS-optimized bullets and a fully updated resume ready to download.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                hasKey
                  ? "bg-sky-100 text-sky-800 ring-1 ring-sky-300"
                  : "bg-red-100 text-red-700 ring-1 ring-red-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${hasKey ? "bg-emerald-500" : "bg-red-500"}`}
              />
              {hasKey ? (activeLabel ?? "LLM configured") : "No API key set"}
            </span>
            {model && <span className="text-xs text-sky-500">{model}</span>}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-300 transition-colors hover:bg-sky-50"
            >
              ⚙️ Settings
            </button>
          </div>
        </header>

        {/* Stepper */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {(
            [
              ["input", "1 · Upload & Analyze"],
              ["select", "2 · Pick Keywords"],
              ["done", "3 · Updated Resume"],
            ] as [string, string][]
          ).map(([id, label], i) => {
            const activeStep =
              phase === "select" || phase === "updating"
                ? 1
                : phase === "done"
                  ? 2
                  : 0;
            const done = i < activeStep;
            const active = i === activeStep;
            return (
              <div key={id} className="flex items-center gap-2">
                {i > 0 && <div className={`h-0.5 w-8 ${done || active ? "bg-sky-500" : "bg-sky-200"}`} />}
                <div
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-sky-600 text-white shadow-md shadow-sky-200"
                      : done
                        ? "bg-sky-100 text-sky-700 ring-1 ring-sky-300"
                        : "bg-white text-sky-400 ring-1 ring-sky-200"
                  }`}
                >
                  {done ? "✓ " : ""}
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Notices / errors */}
        {notice && (
          <div className="fade-in mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            ⚠️ {notice}
          </div>
        )}
        {error && (
          <div className="fade-in mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            ❌ {error}
          </div>
        )}

        {/* Step 1: inputs */}
        {phase === "input" && (
          <div className="fade-in grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl bg-white/80 p-6 shadow-lg shadow-sky-100 ring-1 ring-sky-100 backdrop-blur">
              <h2 className="mb-3 font-bold text-sky-900">Job Description</h2>
              <textarea
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                placeholder="Paste the full job description here…"
                className="h-64 w-full resize-y rounded-xl border border-sky-200 bg-white p-4 font-mono text-xs focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>

            <div className="flex flex-col gap-4 rounded-2xl bg-white/80 p-6 shadow-lg shadow-sky-100 ring-1 ring-sky-100 backdrop-blur">
              <div>
                <h2 className="mb-1 font-bold text-sky-900">Your Resume</h2>
                {fileName && <p className="text-xs text-sky-500">📄 {fileName}</p>}
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
                  dragOver
                    ? "border-sky-500 bg-sky-50"
                    : "border-sky-200 bg-sky-50/50"
                }`}
              >
                <button
                  type="button"
                  disabled={parsing}
                  onClick={() => fileRef.current?.click()}
                  className="font-semibold text-sky-700 underline underline-offset-2 disabled:opacity-50"
                >
                  {parsing ? "Parsing PDF…" : "Upload resume PDF"}
                </button>
                <span className="text-xs text-sky-400">or drag & drop — or paste text below</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </div>
              {fileError && <p className="text-xs text-red-600">{fileError}</p>}

              <textarea
                value={resume}
                onChange={(e) => setResume(e.target.value)}
                placeholder="Paste your resume text here, or upload a PDF above…"
                className="h-44 w-full resize-y rounded-xl border border-sky-200 bg-white p-4 font-mono text-xs focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-3.5 font-bold text-white shadow-lg shadow-sky-200 transition-all hover:from-sky-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                🔍 Analyze Resume
              </button>
            </div>
          </div>
        )}

        {/* Analyzing / report */}
        {(phase === "analyzing" || phase === "select" || phase === "updating" || phase === "done") &&
          report !== null && (
            <div
              ref={reportRef}
              className="fade-in mb-6 rounded-2xl bg-white/90 p-6 shadow-lg shadow-sky-100 ring-1 ring-sky-100"
            >
              <h2 className="mb-4 font-bold text-sky-900">📊 ATS Analysis Report</h2>
              <div
                className="report-markdown max-h-[32rem] overflow-y-auto font-mono text-xs leading-relaxed text-slate-700"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(liveReport ?? report ?? ""),
                }}
              />
              {(phase === "analyzing" || phase === "updating") && (
                <p className="mt-3 flex items-center gap-2 text-xs text-sky-500">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                  streaming…
                </p>
              )}
            </div>
          )}

        {/* Keyword selection */}
        {(phase === "select" || phase === "updating") && (
          <div className="fade-in mb-6 rounded-2xl bg-white/90 p-6 shadow-lg shadow-sky-100 ring-1 ring-sky-100">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-sky-900">
                🎯 Select the keywords you genuinely possess{" "}
                <span className="text-sm font-normal text-sky-500">
                  ({selected.size}/{totalKeywords} selected)
                </span>
              </h2>
              <div className="flex gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(allKeywords))}
                  className="text-sky-600 underline underline-offset-2"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-sky-600 underline underline-offset-2"
                >
                  Clear
                </button>
              </div>
            </div>

            {totalKeywords === 0 && (
              <p className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-700">
                No missing-keyword list was returned. You can add keywords manually below.
              </p>
            )}

            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
              {missing.map((k) => (
                <label
                  key={k.keyword}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/50 p-2.5 text-sm hover:bg-sky-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(k.keyword)}
                    onChange={() => toggleKeyword(k.keyword)}
                    className="mt-0.5 accent-sky-600"
                  />
                  <span>
                    <span className="text-red-500">❌</span> {k.keyword}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        k.priority === "HIGH"
                          ? "bg-red-100 text-red-700"
                          : k.priority === "MEDIUM"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {k.priority}
                    </span>
                  </span>
                </label>
              ))}
              {partial.map((k) => (
                <label
                  key={k.keyword}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/50 p-2.5 text-sm hover:bg-sky-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(k.keyword)}
                    onChange={() => toggleKeyword(k.keyword)}
                    className="mt-0.5 accent-sky-600"
                  />
                  <span>
                    <span className="text-amber-500">🔶</span> {k.keyword}
                    {k.found_as && (
                      <span className="block text-[11px] text-sky-500">Found as: {k.found_as}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            {/* Manual keywords */}
            {Array.from(selected)
              .filter((k) => !allKeywords.includes(k))
              .length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {Array.from(selected)
                  .filter((k) => !allKeywords.includes(k))
                  .map((k) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-300"
                    >
                      ✚ {k}
                      <button
                        type="button"
                        onClick={() => toggleKeyword(k)}
                        className="text-sky-500 hover:text-red-500"
                        aria-label={`Remove ${k}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Add a keyword manually (press Enter)…"
                className="flex-1 rounded-lg border border-sky-200 bg-white px-3 py-2 font-mono text-xs focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const value = (e.target as HTMLInputElement).value.trim();
                    if (!value) return;
                    setSelected((prev) => new Set(prev).add(value));
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
              />
            </div>

            <button
              type="button"
              disabled={selected.size === 0 || phase === "updating"}
              onClick={handleGenerate}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-3 font-bold text-white shadow-lg shadow-sky-200 transition-all hover:from-sky-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "updating"
                ? "Generating… (streaming live)"
                : `✍️ Generate bullets & updated resume for ${selected.size} keyword${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {/* Generated bullets */}
        {(phase === "updating" || phase === "done") && bullets.length > 0 && (
          <div className="fade-in mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sky-900">
                ✍️ Generated bullets ({bullets.length})
              </h2>
              <button
                type="button"
                onClick={async () => {
                  await copy(bullets.map((b) => b.bullet_text).join("\n\n"));
                  setCopiedAll(true);
                  setTimeout(() => setCopiedAll(false), 1500);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  copiedAll
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-sky-100 text-sky-700 hover:bg-sky-200"
                }`}
              >
                {copiedAll ? "Copied all ✓" : "Copy all bullets"}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {bullets.map((b) => (
                <div
                  key={b.keyword}
                  className="rounded-xl bg-white/90 p-4 shadow-md shadow-sky-100 ring-1 ring-sky-100"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="font-bold text-sky-900">🔑 {b.keyword}</h3>
                    <button
                      type="button"
                      onClick={async () => {
                        await copy(b.bullet_text);
                        setCopiedBullet(b.keyword);
                        setTimeout(() => setCopiedBullet(null), 1500);
                      }}
                      className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                        copiedBullet === b.keyword
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-sky-100 text-sky-700 hover:bg-sky-200"
                      }`}
                    >
                      {copiedBullet === b.keyword ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                  <p className="mb-3 rounded-lg bg-sky-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                    {b.bullet_text}
                  </p>
                  <div className="space-y-1 text-xs text-sky-700">
                    <p>
                      <span className="font-bold">📍 Insert:</span> {b.section}
                      {b.under ? ` — ${b.under}` : ""}
                    </p>
                    <p>
                      <span className="font-bold">🔄 Action:</span> {b.action}
                    </p>
                    <p>
                      <span className="font-bold">💡 ATS:</span> {b.ats_note}
                    </p>
                    {b.human_note && (
                      <p>
                        <span className="font-bold">💡 Human:</span> {b.human_note}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {phase === "updating" && (
              <p className="flex items-center gap-2 text-xs text-sky-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                generating…
              </p>
            )}
          </div>
        )}

        {/* Updated resume */}
        {phase === "done" && updatedResume && (
          <div className="fade-in mb-6 rounded-2xl bg-white/90 p-6 shadow-lg shadow-sky-100 ring-2 ring-sky-300">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold text-sky-900">📄 Updated Resume — changes highlighted</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await copy(updatedResume);
                  }}
                  className="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-700 transition-colors hover:bg-sky-200"
                >
                  Copy text
                </button>
                <button
                  type="button"
                  onClick={() => downloadTxt(updatedResume, "updated-resume.txt")}
                  className="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-700 transition-colors hover:bg-sky-200"
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={pdfBusy}
                  className="rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-sky-200 transition-all hover:from-sky-600 hover:to-blue-700 disabled:opacity-50"
                >
                  {pdfBusy ? "Generating PDF…" : "⬇️ Download PDF"}
                </button>
              </div>
            </div>

            <div className="max-h-[32rem] overflow-y-auto rounded-xl bg-slate-50 p-4 font-mono text-xs leading-relaxed ring-1 ring-sky-100">
              {(highlightedResume ?? updatedResume).split("\n").map((line, i) => {
                const isChanged = line.trimStart().startsWith("+");
                return (
                  <div
                    key={i}
                    className={
                      isChanged
                        ? "whitespace-pre-wrap rounded bg-emerald-100 px-1 py-0.5 text-emerald-900"
                        : "whitespace-pre-wrap text-slate-700"
                    }
                  >
                    {line.replace(/^\+\s?/, "") || "\u00A0"}
                  </div>
                );
              })}
            </div>

            {summary && (
              <div className="mt-4 rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
                <h3 className="mb-2 font-bold text-sky-900">📊 Resume Update Summary</h3>
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-sky-800">
                  {summary}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Start over */}
        {phase !== "input" && (
          <div className="text-center">
            <button
              type="button"
              onClick={handleStartOver}
              className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-sky-700 ring-1 ring-sky-300 transition-colors hover:bg-sky-50"
            >
              ↺ Start over with a new resume
            </button>
          </div>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={(s) => {
          setSettings(s);
          setModel(s.model);
        }}
        providers={providers}
        activeEnvProvider={activeEnvProvider}
      />
    </div>
  );
}
