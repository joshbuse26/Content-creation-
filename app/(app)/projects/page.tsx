import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectListScreen } from "@/components/projects/project-list";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  // Suspense boundary: ProjectListScreen reads useSearchParams (top-bar search).
  return (
    <Suspense>
      <ProjectListScreen />
    </Suspense>
  );
}
