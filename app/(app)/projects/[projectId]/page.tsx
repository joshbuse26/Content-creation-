import { redirect } from "next/navigation";

export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Chat is the primary project surface (Wave D); the staged wizard tabs
  // (research → packaging) remain one click away in the project nav.
  redirect(`/projects/${projectId}/chat`);
}
