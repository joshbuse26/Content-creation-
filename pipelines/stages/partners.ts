import { TRPCError } from "@trpc/server";
import { hasDb } from "@/db";
import { parseStyleCard } from "@/lib/style-card";
import type { StyleCard } from "@/lib/types/entities";

/**
 * Partner resolution for `partnered_named` generation (PRODUCT-CONTRACTS
 * §3). The feature flag is enforced UPSTREAM by server/modes.ts
 * (`assertGenerationTargetAllowed`) at every dispatch site — this module is
 * only reached with the flag on, and it adds the record-level checks the
 * flag cannot: the partner row must exist, be `enabled` (which the DB CHECK
 * ties to signed license fields — an enabled partner always has a license
 * on file), and carry a style card.
 *
 * No routers create partner rows in this wave (deliberate — see
 * OPEN-ITEMS). Production reads the `partners` table; keyless/fixture mode
 * has an in-memory registry that is EMPTY by default (tests seed it), so a
 * flag-on fixture deployment still cannot generate as a named partner by
 * accident.
 */

export interface PartnerRecord {
  id: string;
  name: string;
  enabled: boolean;
  styleCard: StyleCard | null;
}

export interface PartnerSource {
  get(partnerId: string): Promise<PartnerRecord | null>;
}

export class InMemoryPartnerSource implements PartnerSource {
  private partners = new Map<string, PartnerRecord>();

  set(partner: PartnerRecord): void {
    this.partners.set(partner.id, partner);
  }

  get(partnerId: string): Promise<PartnerRecord | null> {
    return Promise.resolve(this.partners.get(partnerId) ?? null);
  }
}

class DrizzlePartnerSource implements PartnerSource {
  async get(partnerId: string): Promise<PartnerRecord | null> {
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const rows = await getDb()
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, partnerId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      styleCard: row.styleCard === null ? null : parseStyleCard(row.styleCard),
    };
  }
}

let cached: PartnerSource | undefined;

export function getPartnerSource(): PartnerSource {
  cached ??= hasDb() ? new DrizzlePartnerSource() : new InMemoryPartnerSource();
  return cached;
}

export function setPartnerSourceForTests(source: PartnerSource | undefined): void {
  cached = source;
}

/**
 * Resolve an enabled partner's style card or throw a clear, typed error:
 * unknown id → NOT_FOUND; disabled (= unlicensed, per the DB CHECK) →
 * FORBIDDEN; enabled but no card authored yet → PRECONDITION_FAILED.
 */
export async function resolvePartnerCard(
  partnerId: string,
  source: PartnerSource = getPartnerSource(),
): Promise<StyleCard> {
  const partner = await source.get(partnerId);
  if (partner === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "partner not found" });
  }
  if (!partner.enabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This partner voice is not enabled — a signed license is required first.",
    });
  }
  if (partner.styleCard === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This partner has no style card yet.",
    });
  }
  return partner.styleCard;
}
