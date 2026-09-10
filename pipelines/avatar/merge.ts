import type { AudienceAvatar } from "@/lib/types/entities";
import type { GeneratedAvatar } from "@/lib/types/pipeline";
import type { AvatarFieldsPatch, AvatarMetaPatch } from "@/server/channel/repo";

/**
 * §5.2 editable-fields semantics — user edits win.
 *
 * If the existing avatar has last_edited_by set, an AI regeneration only
 * fills fields that are currently EMPTY; the user's non-empty values are
 * untouched. `regenerateAll` (the user's explicit "regenerate all") replaces
 * everything and clears last_edited_by, since no field is user-authored
 * anymore. A fresh/never-edited avatar always takes the full generation.
 */

const isEmptyText = (v: string | null): boolean => v === null || v.trim() === "";
const isEmptyList = (v: readonly unknown[]): boolean => v.length === 0;

export interface AvatarWrite {
  fields: AvatarFieldsPatch;
  meta: AvatarMetaPatch;
}

export function mergeGeneratedAvatar(
  existing: AudienceAvatar | null,
  generated: GeneratedAvatar,
  regenerateAll: boolean,
  now: Date,
): AvatarWrite {
  const full: AvatarFieldsPatch = {
    ageRange: generated.ageRange,
    genderSplit: generated.genderSplit,
    geo: generated.geo,
    sophistication: generated.sophistication,
    pains: generated.pains,
    motivations: generated.motivations,
    vocabularyNotes: generated.vocabularyNotes,
  };

  const userEdited = existing !== null && existing.lastEditedBy !== null;

  if (existing === null || !userEdited || regenerateAll) {
    return {
      fields: full,
      meta: {
        aiGeneratedAt: now,
        // "Regenerate all" discards the user's edits, so the row is no longer
        // user-authored; an untouched row stays untouched (null stays null).
        lastEditedBy: regenerateAll ? null : (existing?.lastEditedBy ?? null),
      },
    };
  }

  // User-edited and not a full regenerate: fill only the empty fields.
  const fields: AvatarFieldsPatch = {};
  if (isEmptyText(existing.ageRange)) fields.ageRange = generated.ageRange;
  if (isEmptyText(existing.genderSplit)) fields.genderSplit = generated.genderSplit;
  if (isEmptyList(existing.geo)) fields.geo = generated.geo;
  if (existing.sophistication === null) fields.sophistication = generated.sophistication;
  if (isEmptyList(existing.pains)) fields.pains = generated.pains;
  if (isEmptyList(existing.motivations)) fields.motivations = generated.motivations;
  if (isEmptyText(existing.vocabularyNotes)) fields.vocabularyNotes = generated.vocabularyNotes;

  return {
    fields,
    meta: { aiGeneratedAt: now, lastEditedBy: existing.lastEditedBy },
  };
}
