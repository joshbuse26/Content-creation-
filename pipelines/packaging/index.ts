/**
 * Packaging pipeline — spec §5.11.
 *
 * descriptions (3 modes, Sonnet) · tags (Haiku, 15-25) · chapters (derived
 * from section est_seconds, pure code) · thumbnail TEXT briefs (image gen is
 * cut to v1.1 — no ImageProvider usage anywhere in this directory).
 */

export {
  deriveChapters,
  formatTimestamp,
  renderChapterList,
  type ChapterSourceSection,
  type DeriveChaptersOptions,
} from "./chapters";
export {
  fixturePackagingContext,
  loadPackagingContext,
  type PackagingContext,
  type PackagingFrame,
  type PackagingSection,
} from "./context";
export {
  buildDescriptionPrompt,
  fillDescriptionTemplate,
  generateDescriptionBody,
  type DescriptionTemplateInput,
} from "./descriptions";
export {
  buildTagsPrompt,
  deterministicTags,
  extractTagArray,
  generateTagList,
  normalizeTags,
  TAG_MAX,
  TAG_MIN,
} from "./tags";
export {
  buildThumbnailBrief,
  COMPOSITION_PATTERN_NOTES,
  type ThumbnailBriefInput,
} from "./thumbnail-brief";
export {
  handlePackagingJob,
  packagingJobInputSchema,
  type PackagingJobInput,
  type PackagingJobName,
} from "./jobs";
