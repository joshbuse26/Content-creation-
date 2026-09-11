/**
 * Single source of truth for the product name.
 *
 * Every place branding appears — page titles, emails, exports, MCP server
 * name, marketing copy — MUST import this constant. Renaming the product is
 * a one-line change.
 */
export const PRODUCT_NAME = "Gin Rummy";

/**
 * Product-native name for the chat script coach (Wave D, WAVE-D-PLAN §2b).
 * Additive: the underlying LLM is never named in any user-facing string
 * (the words "Grok"/"xAI" and any model-vendor name are copy-lint failures).
 * The persona presents as this name only.
 */
export const COACH_NAME = "Coach";
