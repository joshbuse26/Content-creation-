import { router } from "@/server/trpc";
import {
  apiKeysRouter,
  archetypesRouter,
  avatarRouter,
  billingRouter,
  channelRouter,
  chaptersRouter,
  dashboardRouter,
  descriptionRouter,
  frameRouter,
  ideasRouter,
  projectRouter,
  researchRouter,
  revisionRouter,
  scriptRouter,
  tagsRouter,
  templatesRouter,
  thumbnailsRouter,
  titlesRouter,
  voiceProfileRouter,
  workspaceRouter,
} from "./_contracts";

/** The app router — build spec §6. Shape is frozen; bodies get real. */
export const appRouter = router({
  workspace: workspaceRouter,
  channel: channelRouter,
  avatar: avatarRouter,
  archetypes: archetypesRouter,
  ideas: ideasRouter,
  project: projectRouter,
  research: researchRouter,
  frame: frameRouter,
  script: scriptRouter,
  voiceProfile: voiceProfileRouter,
  revision: revisionRouter,
  titles: titlesRouter,
  thumbnails: thumbnailsRouter,
  description: descriptionRouter,
  tags: tagsRouter,
  chapters: chaptersRouter,
  templates: templatesRouter,
  dashboard: dashboardRouter,
  billing: billingRouter,
  apiKeys: apiKeysRouter,
});

export type AppRouter = typeof appRouter;
