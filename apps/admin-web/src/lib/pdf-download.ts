/** Save authenticated PDF bytes without navigating a tab to a temporary blob URL. */
export async function downloadPdf(data: Blob, filename: string): Promise<void> {
  const signature = new TextDecoder().decode(await data.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") {
    throw new Error("No valid PDF was received. IDM may have intercepted the download. Hold Alt while clicking the PDF button, or disable IDM integration for this billing website, then try again.");
  }
  const blob = new Blob([data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/[\\/:*?"<>|]/g, "-").replace(/\.pdf$/i, "") || "document"}.pdf`;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
