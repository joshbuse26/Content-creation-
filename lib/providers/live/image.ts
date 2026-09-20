import { z } from "zod";
import { getConfig } from "@/lib/config";
import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";

/**
 * Live image generation — fal.ai FLUX. Returned URLs are provider-hosted and
 * short-lived: callers MUST copy images to our object storage before
 * persisting keys (never store third-party URLs — spec §0).
 *
 * With a reference image the request goes to the image-to-image endpoint:
 * the reference (already 1280×720) fixes the output size and seeds the
 * composition; `strength` is how far the prompt may depart from it.
 */
const TEXT_TO_IMAGE_URL = "https://fal.run/fal-ai/flux/dev";
const IMAGE_TO_IMAGE_URL = "https://fal.run/fal-ai/flux/dev/image-to-image";

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
    const body =
      req.reference === undefined
        ? {
            prompt: req.prompt,
            image_size: { width: req.width, height: req.height },
            num_images: req.count,
          }
        : {
            prompt: req.prompt,
            image_url: req.reference.dataUrl,
            strength: req.reference.strength,
            num_images: req.count,
          };
    const res = await fetch(req.reference === undefined ? TEXT_TO_IMAGE_URL : IMAGE_TO_IMAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${IMAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new Error(`Image API failed with status ${res.status}`);
    }
    const data = responseSchema.parse((await res.json()) as unknown);
    return data.images.map((img): GeneratedImage => ({ url: img.url, base64Png: null }));
  }
}
