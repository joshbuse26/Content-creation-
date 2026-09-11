/**
 * prompts/ — every LLM prompt in the product, as versioned, typed template
 * functions (build spec §5: prompts live here, never inline). A2 owns this
 * directory. Bump PROMPT_VERSION in version.ts on any change.
 */
export { PROMPT_VERSION, type PromptTemplate } from "./version";
export { BANNED_PHRASES, bannedPhraseList, findBannedPhrases } from "./banned-phrases";
export { planQueriesPrompt, compileBriefPrompt } from "./research";
export type { PlanQueriesInput, CompileBriefInput } from "./research";
export { proposeFramesPrompt, type ProposeFramesInput } from "./frames";
export { outlinePrompt, type OutlinePromptInput } from "./outline";
export { topicsPrompt, type TopicsPromptInput } from "./topics";
export { trainVoicePrompt, type TrainVoicePromptInput } from "./train-voice";
export {
  hookPrompt,
  sectionPrompt,
  regenerateSectionPrompt,
  type HookPromptInput,
  type SectionPromptInput,
  type RegenerateSectionPromptInput,
} from "./sections";
export { retentionPrompt, type RetentionPromptInput } from "./retention";
export { voicePrompt, type VoicePromptInput } from "./voice";
export { dedupeRewritePrompt, type DedupeRewriteInput } from "./dedupe";
export { factCheckPrompt, type FactCheckPromptInput } from "./fact-check";
export { qualityFixPrompt, type QualityFixPromptInput } from "./quality-fix";
export { revisionPrompt, type RevisionPromptInput } from "./revision";
export {
  titlesPrompt,
  scoreTitlesPrompt,
  TITLE_PATTERN_FAMILIES,
  type TitlesPromptInput,
  type ScoreTitlesPromptInput,
  type TitlePatternFamily,
} from "./titles";
