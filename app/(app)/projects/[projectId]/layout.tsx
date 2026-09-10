"use client";

import type { ReactNode } from "react";
import { ProjectFrame } from "@/components/projects/project-frame";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <ProjectFrame>{children}</ProjectFrame>;
}
