function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let inList = false;

  for (const rawLine of md.split("\n")) {
    const trimmed = rawLine.trim();
    const isListItem = /^[-*] /.test(trimmed) || /^\d+\. /.test(trimmed);

    if (isListItem && !inList) {
      out.push('<ul class="list-disc pl-5 space-y-1 my-1">');
      inList = true;
    } else if (!isListItem && inList) {
      out.push("</ul>");
      inList = false;
    }

    if (!trimmed) {
      out.push("");
    } else if (/^[═━─]+$/.test(trimmed)) {
      out.push('<hr class="border-sky-200 my-2" />');
    } else if (/^#+ /.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      const size = level <= 2 ? "text-lg font-bold mt-4 mb-1" : "text-base font-bold mt-3 mb-1";
      out.push(
        `<h3 class="${size} text-sky-900">${renderInline(trimmed.replace(/^#+\s*/, ""))}</h3>`
      );
    } else if (isListItem) {
      out.push(`<li>${renderInline(trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""))}</li>`);
    } else if (trimmed.startsWith("```")) {
      /* skip fence */
    } else {
      out.push(`<p class="whitespace-pre-wrap">${renderInline(trimmed)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}
