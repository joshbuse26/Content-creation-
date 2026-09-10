/** Trigger a client-side file download from the export procedures' payload. */
export function downloadFile(
  filename: string,
  mimeType: string,
  content: string,
  encoding: "utf8" | "base64",
): void {
  const blob =
    encoding === "base64"
      ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: mimeType })
      : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
