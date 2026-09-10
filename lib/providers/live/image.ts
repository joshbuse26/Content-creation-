import { z } from "zod";
import { getConfig } from "@/lib/config";
import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";

/**
 * Live image generation — fal.ai FLUX. Returned URLs are provider-hosted and
 * short-lived: callers MUST copy images to our object storage before
 * persisting keys (never store third-party URLs — spec §0).
 */

const responseSchema = z.object({
  images: z
    .array(
      z.object({
        url: z.string(),
      }),
    )
    .default([]),
});

export class LiveImage implements ImageProvider {
  async generate(req: ImageRequest): Promise<GeneratedImage[]> {
    const { IMAGE_API_KEY } = getConfig();
    if (IMAGE_API_KEY === undefined) {
      throw new Error("IMAGE_API_KEY is required for the live image provider");
    }
    const res = await fetch("https://fal.run/fal-ai/flux/dev", {
      method: "POST",
      headers: {
        Authorization: `Key ${IMAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: req.prompt,
        image_size: { width: req.width, height: req.height },
        num_images: req.count,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new Error(`Image API failed with status ${res.status}`);
    }
    const data = responseSchema.parse((await res.json()) as unknown);
    return data.images.map((img): GeneratedImage => ({ url: img.url, base64Png: null }));
  }
}
