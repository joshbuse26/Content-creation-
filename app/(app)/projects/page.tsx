import type { Metadata } from "next";
import { ProjectListScreen } from "@/components/projects/project-list";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <ProjectListScreen />;
}
