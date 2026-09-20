"use client";

import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { IconUpload, IconX } from "@/components/ui/icons";

/** Output frame — matches the generated thumbnails so image-to-image keeps the size. */
export const REFERENCE_WIDTH = 1280;
export const REFERENCE_HEIGHT = 720;
const JPEG_QUALITY = 0.85;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/**
 * Fit an image into a 1280×720 JPEG data URL (cover-crop, centred) in the
 * browser, so a 12MB phone photo becomes a ~200KB frame before upload and
 * the provider's image-to-image output lands at thumbnail size.
 */
export async function frameReferenceImage(file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Drop a PNG, JPEG or WebP image.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = REFERENCE_WIDTH;
    canvas.height = REFERENCE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("This browser can't resize images.");
    const scale = Math.max(REFERENCE_WIDTH / bitmap.width, REFERENCE_HEIGHT / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (REFERENCE_WIDTH - w) / 2, (REFERENCE_HEIGHT - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

/**
 * Drag-and-drop (or click) for ONE reference image — a face photo or an
 * example frame. The value is the framed data URL, ready for the API.
 */
export function ReferenceDropzone({
  value,
  onChange,
  onError,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = async (file: File | undefined) => {
    if (file === undefined) return;
    setBusy(true);
    try {
      onChange(await frameReferenceImage(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't read that image.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  };

  if (value !== null) {
    return (
      <div className="flex items-center gap-3">
        {/* A data URL preview of the user's own upload — not a remote asset. */}
        <img
          src={value}
          alt="Reference image"
          width={160}
          height={90}
          className="h-[90px] w-[160px] rounded-md border border-zinc-200 object-cover dark:border-line"
        />
        <div className="text-xs text-zinc-500 dark:text-muted">
          <p>Guides framing, subject and colours — not an exact face match.</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1"
            onClick={() => {
              onChange(null);
            }}
          >
            <IconX size={12} /> Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop a reference image"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={onDrop}
      className={`flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-3 text-sm transition-colors ${
        over
          ? "border-accent-500 bg-accent-500/10"
          : "border-zinc-300 hover:border-accent-400 dark:border-line"
      }`}
    >
      <IconUpload size={16} className="shrink-0 text-zinc-400 dark:text-muted" />
      <div>
        <p className="font-medium">{busy ? "Preparing…" : "Drop a face photo or example frame"}</p>
        <p className="text-xs text-zinc-500 dark:text-muted">
          PNG, JPEG or WebP — framed to 1280×720 here before upload.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="sr-only"
        aria-label="Choose a reference image"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
