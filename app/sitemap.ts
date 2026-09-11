import type { MetadataRoute } from "next";
import { getConfig } from "@/lib/config";

/**
 * Public sitemap (OPEN-ITEMS): the marketing home, legal pages, the free-tool
 * hub, and the four standalone generator pages — every route that is
 * crawlable and carries its own canonical + OG metadata. Authenticated app
 * routes (dashboard, projects, settings) and API routes are deliberately
 * excluded. Base URL comes from APP_URL so it is correct per deployment.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getConfig().APP_URL.replace(/\/$/, "");
  const now = new Date();
  const paths = [
    "/",
    "/tools",
    "/tools/title-generator",
    "/tools/tag-generator",
    "/tools/description-generator",
    "/tools/hook-analyzer",
    "/privacy",
    "/terms",
  ];
  return paths.map((path) => ({
    url: `${base}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: path.startsWith("/tools") ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path.startsWith("/tools") ? 0.8 : 0.3,
  }));
}
