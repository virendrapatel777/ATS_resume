import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..");

const PROMPT_FILES = {
  analyzer: "ATS_Resume_Builder_SKILL.md",
  updater: "Resume_Skill_Updater_RICEPOT_Prompt.md",
} as const;

let cache: Partial<Record<keyof typeof PROMPT_FILES, string>> = {};

const PROMPT_2_MARKER = "# PROMPT 2";

function extractPrompt1(skillFile: string): string {
  const idx = skillFile.indexOf(PROMPT_2_MARKER);
  if (idx === -1) return skillFile.trim();
  return skillFile.slice(0, idx).trim();
}

export async function getAnalyzerPrompt(): Promise<string> {
  if (!cache.analyzer) {
    const raw = await readFile(path.join(PROJECT_ROOT, PROMPT_FILES.analyzer), "utf8");
    cache.analyzer = extractPrompt1(raw);
  }
  return cache.analyzer;
}

export async function getUpdaterPrompt(): Promise<string> {
  if (!cache.updater) {
    cache.updater = await readFile(
      path.join(PROJECT_ROOT, PROMPT_FILES.updater),
      "utf8"
    );
  }
  return cache.updater;
}

export function buildAnalyzerUserContent(resume: string, jd: string): string {
  return `RESUME:\n${resume}\n\nJOB DESCRIPTION:\n${jd}`;
}

export function buildUpdaterUserContent(resume: string, keywords: string[]): string {
  const list = keywords.map((k) => `- ${k}`).join("\n");
  return (
    `RESUME:\n${resume}\n\nSelected Keywords:\n${list}\n\n` +
    `In addition to the bullets, you MUST also:\n` +
    `1. Identify areas in the resume where these skills and keywords can be incorporated or emphasized, matching the candidate's true experience.\n` +
    `2. Modify the resume by including these keywords so it stays coherent, professional, and accurate.\n` +
    `3. Output the complete updated resume in the updated_resume field with the new content inserted at the right places.\n` +
    `4. Output a highlighted version in the highlighted_resume field where every inserted or modified line starts with a plus marker '+' (e.g. '+ - Architected CI/CD pipelines using Jenkins').`
  );
}
