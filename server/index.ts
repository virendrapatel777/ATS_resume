import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import express from "express";
import cors from "cors";
import multer from "multer";
import PDFDocument from "pdfkit";
import { extractText } from "unpdf";
import {
  getAnalyzerPrompt,
  getUpdaterPrompt,
  buildAnalyzerUserContent,
  buildUpdaterUserContent,
} from "./prompts.js";
import {
  envProviderConfig,
  PROVIDERS,
  resolveConfig,
  streamToolUse,
  analyzeToolSpec,
  updateToolSpec,
  testProviderKey,
  type RequestConfig,
} from "./llm.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const MAX_INPUT_CHARS = 30000;

function truncate(text: string, max = MAX_INPUT_CHARS) {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

function sse(res: express.Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const cancel = () => res.end();
  return { send, cancel };
}

app.get("/api/config", (_req, res) => {
  const env = envProviderConfig();
  res.json({
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.defaultModel,
      hasEnvKey: Boolean(process.env[p.envKey]),
      placeholder: p.placeholder,
    })),
    activeProvider: env.provider ?? null,
    activeModel: env.model ?? null,
    baseUrl: PROVIDERS.find((p) => p.id === env.provider)?.baseUrl ?? null,
  });
});

function bodyConfig(body: unknown): RequestConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    provider: (b.provider as RequestConfig["provider"]) ?? undefined,
    apiKey: typeof b.apiKey === "string" ? b.apiKey : undefined,
    baseUrl: typeof b.baseUrl === "string" ? b.baseUrl : undefined,
    model: typeof b.model === "string" ? b.model : undefined,
  };
}

app.post("/api/test-key", async (req, res) => {
  const config = bodyConfig(req.body);
  if (!resolveConfig(config)) {
    return res.status(400).json({ error: "Please enter an API key." });
  }
  try {
    const ok = await testProviderKey(config);
    res.json({ ok: true, message: ok });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e instanceof Error ? e.message : "API key test failed.",
    });
  }
});

app.post("/api/parse-pdf", upload.single("resumePdf"), async (req, res) => {
  const file = req.file;
  if (!file || file.size === 0) {
    return res.status(400).json({ error: "No PDF file provided." });
  }
  try {
    const result = await extractText(new Uint8Array(file.buffer), { mergePages: true });
    const text = (Array.isArray(result.text) ? result.text.join("\n") : result.text ?? "").trim();
    if (text.length < 80) {
      return res.status(400).json({
        error:
          "This PDF contains no extractable text (it may be a scanned image). Paste your resume as text instead.",
      });
    }
    const r = truncate(text, 60000);
    res.json({ text: r.text, truncated: r.truncated, name: file.originalname });
  } catch (e) {
    res.status(400).json({
      error: `Could not parse the PDF: ${e instanceof Error ? e.message : "unknown error"}`,
    });
  }
});

app.post("/api/analyze", async (req, res) => {
  const config = bodyConfig(req.body);
  if (!resolveConfig(config)) {
    return res.status(500).json({
      error:
        "No LLM provider configured. Open Settings to enter an API key, or set one in .env.",
    });
  }
  const resume = String(req.body?.resume ?? "").trim();
  const jd = String(req.body?.jd ?? "").trim();
  if (!resume || !jd) {
    return res.status(400).json({ error: "Both a resume and a job description are required." });
  }

  const r = truncate(resume);
  const j = truncate(jd);
  const { send, cancel } = sse(res);

  (async () => {
    try {
      if (r.truncated || j.truncated) {
        send("notice", {
          message: "Input was truncated to fit the model context.",
        });
      }
      const system = await getAnalyzerPrompt();
      const acc = await streamToolUse({
        system,
        userContent: buildAnalyzerUserContent(r.text, j.text),
        tool: analyzeToolSpec,
        config,
        onDelta: (delta) => send("partial", { delta }),
        onNotice: (message) => send("notice", { message }),
      });
      send("result", acc.parsed);
      send("done", {});
    } catch (e) {
      send("error", { message: e instanceof Error ? e.message : "Analysis failed." });
    } finally {
      cancel();
    }
  })();
});

app.post("/api/update", async (req, res) => {
  const config = bodyConfig(req.body);
  if (!resolveConfig(config)) {
    return res.status(500).json({
      error:
        "No LLM provider configured. Open Settings to enter an API key, or set one in .env.",
    });
  }
  const resume = String(req.body?.resume ?? "").trim();
  const keywords: string[] = Array.isArray(req.body?.keywords)
    ? req.body.keywords.map((k: unknown) => String(k))
    : [];
  if (!resume || keywords.length === 0) {
    return res.status(400).json({
      error: "A resume and at least one selected keyword are required.",
    });
  }
  if (keywords.length > 12) {
    return res.status(400).json({
      error: "Please select at most 12 keywords per run for quality output.",
    });
  }

  const r = truncate(resume);
  const { send, cancel } = sse(res);

  (async () => {
    try {
      if (r.truncated) {
        send("notice", { message: "Resume was truncated to fit the model context." });
      }
      const system = await getUpdaterPrompt();
      const acc = await streamToolUse({
        system,
        userContent: buildUpdaterUserContent(r.text, keywords),
        tool: updateToolSpec,
        config,
        onDelta: (delta) => send("partial", { delta }),
        onNotice: (message) => send("notice", { message }),
      });
      send("result", acc.parsed);
      send("done", {});
    } catch (e) {
      send("error", {
        message: e instanceof Error ? e.message : "Bullet generation failed.",
      });
    } finally {
      cancel();
    }
  })();
});

app.post("/api/download-pdf", async (req, res) => {
  const text = String(req.body?.text ?? "");
  const filename = String(req.body?.filename ?? "updated-resume")
    .replace(/[^\w\- ]+/g, "")
    .trim() || "updated-resume";
  if (!text.trim()) {
    return res.status(400).json({ error: "No resume text provided." });
  }

  try {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);

    const fontSize = 10.5;
    const lineHeight = 15;
    const usableWidth = 595.28 - 100;
    const bottom = 841.89 - 50;
    let y = 50;

    const lines: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        lines.push("");
        continue;
      }
      if (doc.widthOfString(line) <= usableWidth) {
        lines.push(line);
        continue;
      }
      const words = line.split(/\s+/);
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (doc.widthOfString(candidate) <= usableWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
    }

    for (const line of lines) {
      if (y + lineHeight > bottom) {
        doc.addPage();
        y = 50;
      }
      if (line === "") {
        y += lineHeight / 2;
        continue;
      }
      if (/^[A-Z][A-Z /,&'-]{2,}$/.test(line.trim())) {
        doc.fontSize(12).fillColor("#1d4ed8");
        doc.text(line, 50, y, { width: usableWidth, lineBreak: false });
        y = doc.y + 6;
      } else if (/^\s*[-+*]/.test(line)) {
        doc.fontSize(fontSize).fillColor("#111111");
        doc.text(line, 60, y, { width: usableWidth - 10, lineBreak: false });
        y = doc.y + lineHeight;
      } else {
        doc.fontSize(fontSize).fillColor("#111111");
        doc.text(line, 50, y, { width: usableWidth, lineBreak: false });
        y = doc.y + lineHeight;
      }
    }

    doc.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: "PDF generation failed." });
    } else {
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`ATS API server running at http://localhost:${PORT}`);
});
