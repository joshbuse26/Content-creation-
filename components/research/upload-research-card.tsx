"use client";

import { useRef, useState } from "react";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { IconUpload } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/**
 * Upload-research card (WAVE-D-PLAN §3 D4): one intake for PDF, .txt and .md.
 *
 * PDFs are binary and cannot ride tRPC, so they POST multipart to the
 * dedicated `/api/research-upload` route, which extracts the text server-side
 * and stores a `kind:"upload"` research doc attributed to the filename. Text
 * files (.txt/.md) keep the existing tRPC path — the parent reads them and
 * handles the upload via `onTextFile`.
 *
 * On a successful PDF upload we call `onUploaded` (the parent invalidates
 * `research.list` so the new doc appears in the source list) and toast
 * success; any server error — non-PDF, scanned/empty, over the per-plan word
 * cap, too large, or a parse timeout — is surfaced via toast using the
 * route's own message.
 */

const ACCEPT = "application/pdf,.pdf,.txt,.md,.markdown,text/plain,text/markdown";

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
}

/** Turn a failed upload response into a human message, preferring the route's
 *  own `{ error }` body and special-casing the scanned/image-only PDF. */
async function uploadErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; code?: string };
    if (data.code === "empty") {
      return "Couldn’t read text from this PDF — it looks scanned or image-only.";
    }
    if (typeof data.error === "string" && data.error.trim() !== "") {
      return data.error;
    }
  } catch {
    // Non-JSON error body — fall back to a status-based message below.
  }
  if (res.status === 413) return "That PDF is too large — the cap is 20 MB.";
  return "Upload failed — try again.";
}

export function UploadResearchCard({
  workspaceId,
  projectId,
  onUploaded,
  onTextFile,
  textBusy = false,
  textError = false,
}: {
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  onUploaded: () => void;
  onTextFile: (file: File) => void;
  textBusy?: boolean;
  textError?: boolean;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const uploadPdf = async (file: File) => {
    setLocalError(null);
    setPdfBusy(true);
    try {
      const body = new FormData();
      body.set("workspaceId", workspaceId);
      body.set("projectId", projectId);
      body.set("file", file);
      const res = await fetch("/api/research-upload", { method: "POST", body });
      if (!res.ok) {
        const message = await uploadErrorMessage(res);
        setLocalError(message);
        toast(message);
        return;
      }
      const doc = (await res.json().catch(() => null)) as { title?: string } | null;
      onUploaded();
      toast(`Added “${doc?.title ?? file.name}” to your sources.`, "success");
    } catch {
      const message = "Upload failed — check your connection and try again.";
      setLocalError(message);
      toast(message);
    } finally {
      setPdfBusy(false);
    }
  };

  const handleFile = (file: File) => {
    setLocalError(null);
    if (isPdfFile(file)) {
      void uploadPdf(file);
      return;
    }
    if (isTextFile(file)) {
      onTextFile(file);
      return;
    }
    setLocalError("Unsupported file — upload a PDF, .txt, or .md file.");
  };

  return (
    <Card>
      <CardHeader title="Upload research" subtitle="Bring your own: PDF, .txt or .md." />
      <CardBody>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          aria-label="Upload research file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) handleFile(file);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="primary"
          busy={pdfBusy || textBusy}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          <IconUpload size={13} /> Choose file
        </Button>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          5k words on Free, 25k on paid plans. PDFs are parsed server-side; every upload is stored
          as text and cited like any other source.
        </p>
        {localError !== null ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{localError}</p>
        ) : null}
        {textError ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">Upload failed.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
