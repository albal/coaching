import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractText, MAX_FILE_BYTES, type FileLike } from "../../src/web/extract";
import { createSession, setResume } from "../../src/web/session";

function fixture(name: string): FileLike {
  const buf = readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
  return { name, size: buf.byteLength, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
}

function bytes(name: string, content: Uint8Array | string, size?: number): FileLike {
  const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { name, size: size ?? data.byteLength, arrayBuffer: async () => data.slice().buffer };
}

// Upload → extract → (user reviews) → setResume, as the UI does it.
async function addResumeFromFile(file: FileLike) {
  const result = await extractText(file);
  return result.ok ? { result, session: setResume(createSession(), result.text) } : { result };
}

describe("adding a Resume from a file", () => {
  it("reads a text PDF", async () => {
    const { result, session } = await addResumeFromFile(fixture("resume.pdf"));
    expect(result).toEqual({ ok: true, text: "Jane Doe - DevOps Engineer\nRan Helm charts on EKS for 40 services." });
    expect(session).toMatchObject({ ok: true, session: { resume: expect.stringContaining("Helm charts on EKS") } });
  });

  it("reads a DOCX", async () => {
    const { result } = await addResumeFromFile(fixture("resume.docx"));
    expect(result).toEqual({ ok: true, text: "Jane Doe - DevOps Engineer\n\nCut deploy time from 40 to 6 minutes with GitLab CI." });
  });

  it("reads Markdown and plain text", async () => {
    expect(await extractText(fixture("resume.md"))).toEqual({ ok: true, text: "# Jane Doe\n\n- Ran Helm charts on EKS for 40 services." });
    expect(await extractText(bytes("cv.txt", "Plain text resume with enough words in it."))).toMatchObject({ ok: true });
  });

  it("returns no_text for a scanned or image-only PDF", async () => {
    expect(await addResumeFromFile(fixture("scanned.pdf"))).toEqual({ result: { ok: false, reason: "no_text" } });
  });

  it("rejects files over 5 MB without reading them", async () => {
    const big: FileLike = { name: "big.pdf", size: MAX_FILE_BYTES + 1, arrayBuffer: () => Promise.reject(new Error("should not read")) };
    expect(await extractText(big)).toEqual({ ok: false, reason: "too_large" });
  });

  it("identifies files by their bytes, not their name", async () => {
    expect(await extractText(bytes("resume.pdf", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])))).toEqual({ ok: false, reason: "unsupported" });
    const pdf = fixture("resume.pdf");
    expect(await extractText({ ...pdf, name: "resume.txt" })).toMatchObject({ ok: true, text: expect.stringContaining("EKS") });
  });

  it("reports a corrupt PDF or DOCX as unreadable", async () => {
    expect(await extractText(bytes("x.pdf", "%PDF-1.4 garbage"))).toEqual({ ok: false, reason: "unreadable" });
    expect(await extractText(bytes("x.docx", new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])))).toEqual({ ok: false, reason: "unreadable" });
  });
});
