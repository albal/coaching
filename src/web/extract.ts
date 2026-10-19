// Turns an uploaded file into text on the user's device. The raw file never
// leaves the browser; only the extracted (and user-reviewed) text is sent.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Fewer visible characters than this means the PDF has no text layer.
const MIN_TEXT_CHARS = 20;

export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ExtractFailure = "too_large" | "unsupported" | "no_text" | "unreadable";
export type ExtractResult = { ok: true; text: string } | { ok: false; reason: ExtractFailure };

export const EXTRACT_MESSAGES: Record<ExtractFailure, string> = {
  too_large: "That file is over 5 MB. Please upload a smaller file or paste the text instead.",
  unsupported: "We can read PDF, DOCX, TXT and Markdown files. Please upload one of those or paste the text instead.",
  no_text: "We couldn't read text from this PDF — please paste your Resume instead.",
  unreadable: "We couldn't read that file. Please paste the text instead.",
};

type Kind = "pdf" | "docx" | "text";

// Identify the format from the file's first bytes, not its name.
function kindOf(bytes: Uint8Array): Kind | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (starts([0x50, 0x4b, 0x03, 0x04])) return "docx"; // PK zip
  if (!bytes.subarray(0, 8192).includes(0)) return "text";
  return null;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    // pdf.js parses in a same-origin Web Worker (allowed by the CSP's default-src 'self').
    pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  }
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim(),
    );
  }
  await task.destroy();
  return pages.join("\n\n");
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // The browser build reads arrayBuffer; the Node build (tests) reads buffer.
  const input = typeof Buffer === "undefined" ? { arrayBuffer } : { buffer: Buffer.from(arrayBuffer) };
  return (await mammoth.extractRawText(input as { arrayBuffer: ArrayBuffer })).value;
}

export async function extractText(file: FileLike): Promise<ExtractResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "too_large" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = kindOf(bytes);
  if (!kind) return { ok: false, reason: "unsupported" };
  let text: string;
  try {
    text =
      kind === "pdf" ? await pdfText(bytes) : kind === "docx" ? await docxText(bytes) : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: kind === "text" ? "unsupported" : "unreadable" };
  }
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS) return { ok: false, reason: kind === "pdf" ? "no_text" : "unreadable" };
  return { ok: true, text };
}
