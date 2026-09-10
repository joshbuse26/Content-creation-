# Runbook: enabling FEATURE_PARTNERED_NAMED (partnered creator voices)

**This flag stays OFF without signed licenses. There are no exceptions.** The default is
`FEATURE_PARTNERED_NAMED=false`; while it is off the server rejects every
`partnered_named` generation request (`server/modes.ts`, FORBIDDEN) and the UI hides the
mode. Unauthorized named-creator impersonation is not a feature of this product
(PRODUCT-CONTRACTS §3/§7) — this runbook exists so that IF a real partnership is ever
signed, ops enables it in the right order and nothing else ever does.

## Preconditions (all of them, per partner, before anything is flipped)

1. **Signed license on file.** A written license agreement, signed by the creator (or
   their authorized representative), covering style emulation and the use of their name
   in product/marketing copy. Legal holds the document; you hold its URL.
2. The license is current (not expired/terminated) and its scope covers what the product
   will actually do.

No signed license → stop here. Do not create the partner row "in advance", do not flip
the flag "for testing" (fixture mode + tests already cover the code path with the flag
off).

## Enable checklist — in this order

1. **Signed license on file** (see preconditions). Record the document URL and the
   signature date.
2. **Create the partner row with the license fields set.** `partners` has no routers by
   design (no create/enable API exists) — insert via a reviewed migration or manual SQL:
   `name`, `style_card` (built from partner-supplied material only), `license_doc_url`,
   `license_signed_at`, `enabled = true`. The DB CHECK refuses `enabled = true` unless
   BOTH license fields are non-null — do not weaken or work around that constraint; it is
   the last line of defense.
3. **Flip the flag**: set `FEATURE_PARTNERED_NAMED=true` on BOTH the web and worker
   services, then redeploy. Even with the flag on, generation additionally requires the
   partner row to be `enabled` (which the CHECK ties to the license fields) — the flag
   alone licenses nothing.
4. **Copy-lint allowlist entry.** Any marketing/UI copy naming the partner ("sounds like
   <Partner>") trips `tests/copy-lint.test.ts` by design. Add the exact matched string to
   `partnerAllowlist` in `tests/copy-lint.allowlist.json` — that list only takes effect
   while the flag is on. Never put partner claims in the plain `allowlist`.

## Verify

- With the flag on: a `partnered_named` generation for the licensed partner succeeds; one
  for a partner id with `enabled = false` still fails.
- `pnpm test` is green with `FEATURE_PARTNERED_NAMED=true` set (copy-lint honors the
  partner allowlist only under the flag).

## Disable / revoke (license ends or is terminated)

1. Set the partner row `enabled = false` immediately (SQL) — this alone stops generation.
2. Remove the partner's `partnerAllowlist` entries and take down the named marketing copy.
3. If no other partner remains enabled, set `FEATURE_PARTNERED_NAMED=false` and redeploy.
