import { z } from "zod";
import { getDb, hasDb, schema } from "@/db";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import { archetypeSchema, type Archetype } from "@/lib/types/entities";

/**
 * archetypes router — wave C (PRODUCT-CONTRACTS §2).
 *
 * The catalog is GLOBAL and read-only: any workspace member may list it, no
 * credits charged, no per-workspace rows. With a database the seeded table
 * is authoritative (scripts/seed.ts inserts the same 12 objects); keyless
 * fixture mode serves lib/archetypes.ts directly, so the picker is never
 * empty. An unseeded database also falls back to the static seeds — the
 * catalog contract is "never an empty list".
 */
export const archetypesImpl = {
  async list(): Promise<Archetype[]> {
    if (hasDb()) {
      const rows = await getDb().select().from(schema.archetypes).orderBy(schema.archetypes.sort);
      if (rows.length > 0) {
        return z.array(archetypeSchema).parse(rows);
      }
    }
    return [...ARCHETYPE_SEEDS];
  },
};
