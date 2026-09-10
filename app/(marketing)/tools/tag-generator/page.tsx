import type { Metadata } from "next";
import { toolDef } from "@/components/tools/tool-defs";
import { ToolPage } from "@/components/tools/tool-page";
import { PRODUCT_NAME } from "@/lib/branding";

const def = toolDef("tag-generator");

export const metadata: Metadata = {
  title: def.name,
  description: def.blurb,
  alternates: { canonical: def.path },
  openGraph: {
    title: `${def.name} · ${PRODUCT_NAME}`,
    description: def.blurb,
    url: def.path,
    type: "website",
  },
};

export default function TagGeneratorPage() {
  return <ToolPage def={def} />;
}
