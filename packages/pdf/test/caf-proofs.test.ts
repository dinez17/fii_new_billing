import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { appendCafProofs } from "../src/caf.js";

async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300 + i, 400]);
  return Buffer.from(await doc.save());
}
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ4QAAAAASUVORK5CYII=", "base64");
describe("CAF proof pages", () => {
  it("preserves the CAF when there are no uploaded proofs", async () => {
    const caf = await pdf(1);
    expect(await appendCafProofs(caf, [])).toBe(caf);
  });
  it("appends front, back and optional GST in order and keeps every PDF page", async () => {
    const result = await appendCafProofs(await pdf(1), [
      { kind: "GST_CERTIFICATE", mimeType: "application/pdf", bytes: await pdf(2) },
      { kind: "ID_BACK", mimeType: "application/pdf", bytes: await pdf(1) },
      { kind: "ID_FRONT", mimeType: "image/png", bytes: image },
    ]);
    const pages = (await PDFDocument.load(result)).getPages();
    expect(pages).toHaveLength(5);
    expect(pages.map((page) => Math.round(page.getWidth()))).toEqual([300, 595, 300, 300, 301]);
  });
  it("skips missing slots and rejects unreadable proofs instead of silently omitting them", async () => {
    expect((await PDFDocument.load(await appendCafProofs(await pdf(1), [{ kind: "ID_BACK", mimeType: "image/png", bytes: image }]))).getPageCount()).toBe(2);
    await expect(appendCafProofs(await pdf(1), [{ kind: "ID_FRONT", mimeType: "application/pdf", bytes: Buffer.from("%PDF-invalid") }])).rejects.toThrow("Cannot attach ID proof - front");
  });
});
