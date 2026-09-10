/**
 * Ideation domain (B1): §5.3 outlier index + §5.4 daily ideas.
 *
 * Worker wiring (A0): route the sync queue's `outlier-refresh` and
 * `daily-ideas` jobs to processIdeationJob and call
 * registerIdeationSchedules() at worker startup — see REQUESTS-B1.md.
 */
export {
  runOutlierRefresh,
  computeOutlierRatio,
  OUTLIER_RATIO_THRESHOLD,
  type OutlierRefreshSummary,
} from "./outliers";
export {
  runDailyIdeas,
  DAILY_IDEAS_COUNT,
  DEDUP_WINDOW_DAYS,
  IDEA_BATCH_CREDIT_COST,
  type DailyIdeasParams,
  type DailyIdeasResult,
} from "./ideas";
export {
  processIdeationJob,
  registerIdeationSchedules,
  fanOutDailyIdeas,
  fanOutOutlierRefresh,
  outlierJobDataSchema,
  dailyIdeasJobDataSchema,
  IDEATION_SCHEDULER_IDS,
  IDEATION_SCHEDULE_PATTERNS,
} from "./jobs";
export { getIdeationDeps, setIdeationDepsForTests, type IdeationDeps } from "./deps";
export {
  getIdeationStore,
  setIdeationStoreForTests,
  InMemoryIdeationStore,
  DrizzleIdeationStore,
  type IdeationStore,
  type NewIdea,
  type UpsertNicheVideo,
} from "./store";
export {
  isDuplicateTitle,
  titleSimilarity,
  normalizeTitle,
  normalizeKeywordSet,
  TITLE_SIMILARITY_THRESHOLD,
} from "./similarity";
