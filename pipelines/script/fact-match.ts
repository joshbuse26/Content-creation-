import type { ResearchDoc } from "@/lib/types/entities";

/**
 * Pure-code claim extraction + matching. Used as the deterministic
 * fact-check in fixture mode, and to sanity-validate live Haiku output
 * (a returned researchDocId must reference an attached doc).
 */

const CLAIM_SIGNALS =
  /\d|percent|study|studies|research|measured|data|survey|panel|benchmark|median|average/i;

export function extractClaimSentences(body: string): string[] {
  const sentences = body.match(/[^.!?\n]{15,300}[.!?]/g) ?? [];
  return sentences.map((s) => s.trim()).filter((s) => CLAIM_SIGNALS.test(s));
}

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9$][a-z0-9'.-]{2,}/g) ?? []).filter(
    (w) => w.length > 3,
  );
}

export const SUPPORT_THRESHOLD = 0.55;

/** Best supporting doc for a claim, or null when nothing clears the bar. */
export function findSupportingDoc(
  claim: string,
  docs: Pick<ResearchDoc, "id" | "content" | "title">[],
): string | null {
  const claimWords = contentWords(claim);
  if (claimWords.length === 0) return null;
  let bestId: string | null = null;
  let bestScore = 0;
  for (const doc of docs) {
    const docWords = new Set(contentWords(`${doc.title} ${doc.content}`));
    let hits = 0;
    for (const word of claimWords) {
      if (docWords.has(word)) hits += 1;
    }
    const score = hits / claimWords.length;
    if (score > bestScore) {
      bestScore = score;
      bestId = doc.id;
    }
  }
  return bestScore >= SUPPORT_THRESHOLD ? bestId : null;
}

export function matchClaims(
  body: string,
  docs: Pick<ResearchDoc, "id" | "content" | "title">[],
): { claim: string; researchDocId: string | null }[] {
  return extractClaimSentences(body).map((claim) => ({
    claim,
    researchDocId: findSupportingDoc(claim, docs),
  }));
}
