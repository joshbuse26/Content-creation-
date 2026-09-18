import type { Metadata } from "next";
import { ThumbnailStudioTool } from "@/components/toolkit/thumbnail-studio-tool";

export const metadata: Metadata = { title: "Thumbnail Studio" };

export default function ThumbnailStudioPage() {
  return <ThumbnailStudioTool />;
}
