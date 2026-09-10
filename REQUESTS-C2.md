# REQUESTS-C2 — wave-C frontend track

Contract / server needs discovered while building the archetype picker,
staged generation flow, style-gate rendering and marketing refresh. Nothing
here blocks the wave: every gap has a shipping client-side workaround.
Owned by whoever holds the frozen layer / C1.

## 1. No contract persists a project's generation target before a draft

`project.create` / `project.update` (frozen) carry no
`generationMode/archetypeId/crossover` fields, and no
`project.setGenerationTarget` procedure exists — yet `projectSchema`
already returns those columns (always null today) and the picker is part
of project creation. Workaround shipped: the choice is stashed per project
in localStorage (`components/generation/generation-store.ts`, same pattern
as the editor's hook-store) and sent as the `generation` param on every
staged script call; once a draft exists, the latest script row's mode
fields are treated as server truth. Consequences: the choice does not
follow the user across browsers/devices and teammates cannot see it until
a draft exists. Request: an additive `project.update` input extension (or
a small `project.setGenerationTarget` mutation) writing the existing
columns.

## 2. `script.topics/outline/hooks` results are not persisted server-side

The staged procedures return their payloads synchronously and store
nothing (C0 stubs; the C1 handoff also has no persistence). Refresh-resume
for the pre-draft steps therefore rides a schema-validated localStorage
bridge (`gr.stagedflow.<projectId>`); the draft step resumes properly via
`script.listVersions` + the SSE replay endpoint. If C1 adds persistence
(e.g. a jsonb column on scripts/projects like the hookCandidates plan in
OPEN-ITEMS), the panel's restore path can prefer the server copy — the
seam is `restoreFlow`/`storeStagedFlow`.

## 3. `script.draft` (stub) completes synchronously

The C0 stub creates the script as `final` before returning, so the SSE
stream shows an immediate full replay rather than live section streaming.
The panel already handles both (it treats the stream identically); noting
so nobody chases a "streaming looks instant" bug. C1's real pipeline
restores live pacing with no client change.

## 4. `NEXT_PUBLIC_FEATURE_PARTNERED_NAMED` (build-time) — when partnered ships

The picker's partnered tab is compiled behind
`process.env.NEXT_PUBLIC_FEATURE_PARTNERED_NAMED` ("1"/"true"); it renders
NOTHING today (flag unset → no tab, no copy, no code path reachable), and
the server rejects the mode regardless (`server/modes.ts`). When the
partnered launch is scheduled, add the NEXT_PUBLIC flag to the web build
env alongside the server's `FEATURE_PARTNERED_NAMED`, plus a partner list
read procedure (none exists — deliberate, per OPEN-ITEMS).

## 5. Per-stage credit labels in the ledger UI

Every staged run ledgers under reason `script_generation` (frozen enum has
no per-stage members). The billing screen therefore shows four identical
"script_generation" rows for a full staged flow. Fine for now; if Josh
wants labeled rows it is the `ALTER TYPE credit_reason` class change
already flagged in OPEN-ITEMS.
