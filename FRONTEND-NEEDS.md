# FRONTEND-NEEDS

Contract / server / deployment needs discovered while fixing the frontend
(owned by the parallel server agent or deployment config — NOT changed here).

## 1. `NEXT_PUBLIC_FIXTURE_UI` build-time env flag

The generation screen's fixture SSE replay is now gated on an explicit
signal instead of "the endpoint errored": it runs only when
`NEXT_PUBLIC_FIXTURE_UI=1` (or `true`) is present **at build time**
(`components/generation/use-script-stream.ts`). Deployments that run with
`PROVIDERS=fixture` and want the demo stream replay must set
`NEXT_PUBLIC_FIXTURE_UI=1` in the web build environment (e.g.
railway.web.json / local `.env`). Live deployments should leave it unset —
a failed stream then shows a stalled state with retry, never demo content.

## 2. Revision diff coordinates (server-side rebasing)

The client now treats every pending revision's `diff` ops as targeting the
section bodies **as returned by `script.get`** at review load time, applies
accepted ops rebased against those original line numbers, refuses to accept
a suggestion whose ops overlap an already-accepted one (marked stale in the
UI), and sends `revision.accept` calls strictly in user order. The parallel
server-side fix should preserve these invariants:

- `revision.accept` must apply the stored ops against the body the ops were
  generated for (or rebase equivalently), independent of accept order.
- After accepts, `script.get` bodies and remaining revisions' ops must stay
  mutually consistent (re-issue/rebase or invalidate ops that no longer
  apply — the client will render them as stale either way).

## 3. Hook candidate persistence (existing REQUESTS-A3 #4)

The editor no longer falls back to fixture hook candidates; when
`script.get.hookCandidates` is null after a web-process restart and the
browser's localStorage bridge is empty, the hook switcher shows a "hook
candidates unavailable" note. Persisting stage-3 hook candidates
server-side (already requested in REQUESTS-A3 #4 / OPEN-ITEMS) would close
that gap for good.

## 4. Trained voices (Wave D2 — WAVE-D-PLAN §2c)

Trained StyleCards are first-class alongside archetypes. The archetype picker
gained an optional `trainedSlot` prop; the project style row passes a
`<TrainVoicePanel>` into it, rendered under a "Trained voices" tab. The panel:

- lists the workspace's `source="trained"` voice profiles (from
  `voiceProfile.list`), each selectable as a generation target
  (`mode: "train_on_my_channel"`, `voiceProfileId` set), renamable
  (`voiceProfile.rename`) and deletable (`voiceProfile.remove`);
- trains from the active channel via `voice.trainFromChannel` (optional sample
  video IDs), and remixes a competitor via `remixFrom` — both show the 5-credit
  cost and a confirm dialog before charging;
- a "Remixed" vs "From channel" badge is derived client-side from
  `trainedFromChannelId !== channelId`.

Selecting a trained voice flows through the same `applyChange` path as
archetypes (localStorage stash + `project.setGenerationTarget` + the staged-flow
invalidation event), so a trained card behaves exactly like any other style for
downstream generation and Coach context. `targetLabel` shows "Trained voice"
for the mode; if a richer label (the profile's name) is wanted, thread the
voice-profile list into `targetLabel`.

## 5. PDF research upload (Wave D4 — binary, outside tRPC)

Binary PDFs upload via a dedicated route, not tRPC (tRPC carries JSON only;
the text `research.upload` procedure still handles paste/MD/TXT):

- `POST /api/research-upload`, `multipart/form-data` with fields
  `workspaceId`, `projectId`, and a `file` (the PDF). On success returns the
  created research doc as JSON (`201`; dates are ISO strings — this is a
  direct fetch, not a superjson tRPC call, so parse dates yourself if needed).
- Errors: `400` (not a PDF / no extractable text / over the per-plan word
  cap — body `{ error, code }`), `413` (file over the 20 MB byte cap), `401`
  unauthenticated, `403` no `research:create`, `404` missing/foreign project.
- No credit is charged (identical to the text-upload path). The doc is stored
  as `kind:"upload"` attributed to the filename, and cites into the script
  exactly like paste/url research.
- Client flow: a file picker that POSTs the PDF, then invalidate
  `research.list` to show the new doc. A scanned/image-only PDF returns
  `400 code:"empty"` — surface "couldn't read text from this PDF".

## 6. Unique-angle surfacing (Wave D4)

- The quality/style gate report now carries `styleGates.uniqueAngleApplied`
  (`true` = the script commits to the frame's angle, `false` = generic /
  under-applied with a `notes` entry, `null` = no angle set or not evaluated).
  It is additive; the `StyleGatesPanel` does not render it yet — add a row
  ("Unique angle") mapping `uniqueAngleApplied` through the existing
  `GateRow` verdict (true/false/null → Pass/Fail/Not evaluated) when wanted.
- Framing UI nudge: when the chosen frame's `angle` is blank, nudge the user
  to set one before generating. `isBlankAngle(angle)` +
  `SET_UNIQUE_ANGLE_NUDGE` (both exported from `lib/style-gates.ts`) give the
  typed check + copy. The gate is intentionally NOT hard-blocking — angle-less
  projects still generate; the nudge + the reported signal are the driver,
  alongside the prompt-level directive.
