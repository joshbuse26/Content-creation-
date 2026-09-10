import type { Metadata } from "next";
import { IdeasFeedScreen } from "@/components/ideas/ideas-feed";

export const metadata: Metadata = { title: "Ideas" };

export default function IdeasPage() {
  return <IdeasFeedScreen />;
}
