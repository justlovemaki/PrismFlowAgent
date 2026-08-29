# `@prismflow/dsh`

Native PrismFlow plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), pinned to DSH `0.1.0-rc.6`.

The package runs in the DSH Cordis process. It does **not** call the PrismFlow HTTP API, require a PrismFlow API key, or require a separate PrismFlow server.

## Execution model

PrismFlow separates its control/publication plane from its data plane:

- **Dashboard:** configure managed sources; create, migrate, and administer ordered serial workflow generators with a rolling latest-50 version history; inspect collapsed-by-default draft summaries and explicitly expand one draft to edit it with optimistic concurrency and packed-media validation, view its safe rendered Markdown preview, approve or reject the exact displayed version/SHA-256, or publish an approved Artifact; browse receipts.
- **DSH Chat:** list configured sources; persist source content; create an all-source or explicitly approved single-source Selection; create and recover Generation Requests; run the configured Agent generator; inspect or edit unapproved Drafts; publish approved Artifacts through the durable publication tools; and, when explicitly enabled in the toolset, use the legacy `prismflow_github_push` compatibility path for arbitrary text. Approval, deletion, media presentation, and Receipt audit remain Dashboard-only.
- **Profile configuration:** owns legacy generator bootstrap/compatibility bindings, Publisher destinations, paths, filenames, endpoints, repositories, buckets, credential references, Providers, tools, and all hard limits. Legacy prompt history is never editable from Dashboard or Chat.

There is no Dashboard fetch/query/request-creation API, ingestion scheduler, or publication scheduler. Normal publication always reads the exact approved Artifact from the durable Draft Store and verifies its version/hash provenance. The explicitly enabled legacy `prismflow_github_push` compatibility tool is the sole exception: it accepts arbitrary text plus a fixed supported target and writes with the Profile-owned GitHub credential without creating a Draft, Attempt, or Receipt. Article-directory targets add dated Frontmatter. The fixed `justlovemaki/Hex2077-Site:rss-t.xml` target rejects model-supplied XML and accepts only an exact persisted `rssOutputId` returned by `prismflow_generate_rss_content`; it revalidates that stored XML and writes it byte-for-byte to root `rss-t.xml` on branch `book`.

Per-article WeChat author, digest, cover, crop, and image-order customization belongs only in the typed approved Artifact presentation/media manifest. It is never a publish argument, Profile mutation, or Dashboard modal value.

## Bundle rows

The bundle contributes independently configurable Cordis rows. Storage, production, selection, and publication rows remain disabled by default for headless profiles:

- `prismflow-core`: source registry (`ctx.prismSources`)
- `prismflow-source-rss`, `prismflow-source-github-trending`, `prismflow-source-follow`, `prismflow-source-ai-search`
- `prismflow-store-source-settings`: durable managed-source configuration (`ctx.prismSourceSettings`)
- `prismflow-store-image-generation-settings`: versioned SQLite image endpoint/model/encoding configuration plus a fixed write-only Credential slot (`ctx.prismImageGenerationSettings`)
- `prismflow-store-content`: durable normalized content (`ctx.prismContentStore`)
- `prismflow-store-content-relevance`: bounded cached AI relevance assessments
- `prismflow-store-content-selection`: immutable AI Selection Artifacts and reviewer cache
- `prismflow-reviewer-ai-relevance-subagent`: fixed no-tool ambiguity/audit reviewer
- `prismflow-publisher-core`: trusted publisher registry (`ctx.prismPublishers`)
- `prismflow-publisher-local-markdown`, `prismflow-publisher-github-markdown`, `prismflow-publisher-r2-markdown`, `prismflow-publisher-wechat-draft`
- `prismflow-store-production-media`: content-addressed approved Production image bytes
- `prismflow-store-publication-receipts`: append-only publication receipts
- `prismflow-store-production`: immutable Generation Requests, drafts, approvals, and Artifact publication
- `prismflow-store-generator-prompts`: internal read-only four-field compatibility history for old pinned Requests and legacy workflow projection/adoption
- `prismflow-store-generator-workflows`: ordered workflow definitions and rolling immutable history
- `prismflow-generator-subagent`: Profile-configured Agent-bound legacy generators and fixed serial workflow runner
- `prismflow-tool-source`: source discovery/fetch tools
- `prismflow-tool-content`: source sync and persisted-content query tools
- `prismflow-tool-content-relevance`, `prismflow-tool-content-selection`: compact relevance and automated selection tools
- `prismflow-tool-production`: Chat production and approved-draft publication tools
- `prismflow-tool-production-media`: bounded Chat/pre-production image ingest and hash-bound Draft presentation versioning
- `prismflow-tool-publication-receipts`: receipt query tools

## Pack and install locally

```sh
cd integrations/dsh
npm pack
dsh plugin --profile web add ./prismflow-dsh-0.19.23.tgz
prismflow-dsh-dashboard "$DSH_HOME/profiles/web"
```

The installer requires the canonical layout `<dshHome>/profiles/<profileName>`, validates it with the named-Profile manager, creates a Profile-local Dashboard Loader, and YAML-migrates the one exact Dashboard row with absolute `dshHome` plus safe `profileName`. Conflicting aliases, unsupported row shapes, or duplicates fail closed. DSH rc.6 scans browser modules only from package-root Cordis rows, so installing or upgrading the package/loader requires restarting DSH Web.

## SQLite Storage Domain migration

DSH Web defaults Storage Domain data to the whole-file JSON backend. For growing content stores, install the pinned SQLite backend in the target Profile and migrate while every DSH process using that home is stopped:

```sh
pnpm --dir "$DSH_HOME/profiles/web" add @deepseek-ai/dsh-storage-sqlite@0.1.0-rc.6
prismflow-dsh-migrate-sqlite "$DSH_HOME/storages" "$DSH_HOME/storages/domain.sqlite"
```

The migration command reads every top-level JSON unit in the storage root, validates its exact envelope and identifier names, imports all units/tables/records and non-null globals into a fresh temporary SQLite database in one transaction, runs equality/count/integrity/schema checks, creates a timestamped byte-for-byte JSON backup, and only then publishes `domain.sqlite` with an atomic same-directory no-clobber hard link. A target created concurrently wins rather than being replaced. The command leaves the original JSON files unchanged for rollback.

After a successful migration, append the SQLite backend row and route every Storage Domain to it in the Profile patch. Backend lifecycle injection resolves this appended registration safely. Keep `storage-json` registered for rollback, but do not enable the `storage-domain` override before migration validation:

```yaml
- insert:
    - id: storage-sqlite
      name: '@deepseek-ai/dsh-storage-sqlite'
      config:
        path: C:/absolute/dsh-home/storages/domain.sqlite
        journalMode: wal

- id: storage-domain
  config:
    backend: sqlite
```

Restart DSH and verify sources, content, drafts, receipts, workspaces, and session projections. Rollback requires stopping DSH, restoring `storage-domain.backend: json`, and accepting that writes made after SQLite cutover are not present in the preserved JSON snapshot.

## Dashboard

The Profile-local client adds **PrismFlow 流光** at the bottom of the DSH sidebar. Its six tabs are:

1. **总览** — control-plane and Chat capability status.
2. **数据源配置** — controlled GitHub Trending, RSS/Atom, AI Search, and Follow settings.
3. **工作流生成器** — a spacious responsive master-detail canvas for logical generator ids/names/descriptions and 1–8 stable-id serial steps. A compact numbered rail selects one active step at a time (with roving arrow/Home/End keyboard navigation), while the focused editor renders only that step's name, Persona, and optional Process Prompt. Selected-step toolbar actions add/duplicate/remove/reorder without losing local edits or selection; metadata and deployment policy stay compact and read-only where applicable. Legacy projections are marked **旧版生成器 · 尚未迁移**, and their primary action is **迁移为工作流**. That action uses the existing exact legacy version/SHA-256 CAS adoption and then reloads normal workflow editing. It never writes legacy prompt history. A dirty/saved badge remains visible beside generator metadata. Immediately after the master-detail canvas, a normal-flow footer reports changed state and atomically saves or discards the full workflow; `Ctrl+S`/`Cmd+S` invokes that same guarded CAS save when the Workflow tab is active, valid, changed or adoptable, and idle. There is no autosave or floating/sticky action overlay. Archive/re-enable remains confirmation-gated in a separate **生成器状态** management section below history, never beside the primary save. A clean archived native workflow may be permanently deleted only after an exact version/SHA-256 preflight and typed generator-ID confirmation. Deletion appends an irreversible terminal tombstone rather than erasing history: normal Builder/Chat discovery hides it, its ID can never be reused, and pinned Requests retain their embedded workflow snapshot and runtime provenance. Pending or running Requests block deletion. New generators show only save, and read-only historical preview footers show only **关闭历史预览**. Version history is collapsed by default, and historical previews reuse the same read-only master-detail canvas. Generation Requests can still be cancelled/retried without displaying source or generated content. Provider/model/tools/paths/credentials and all ceilings are rejected from Dashboard bodies.

Workflow tombstones are a zero-copy version-1 format cutover. Before the first deletion, historical `@prismflow/dsh` workflow-store releases remain compatible with the unchanged rows. After a `delete` tombstone exists, distributed releases `0.13.0` through `0.17.3` intentionally fail workflow-store startup because their startup history scan rejects the unknown terminal action; this is the downgrade fence. Restore service by running the current release again—never edit, remove, or overwrite a tombstone. Every process across an upgrade or attempted downgrade must use the same deployment-controlled workflow writer lock path. Private or modified historical builds are unsupported unless separately attested.
4. **草稿审核与发布** — collapsed-by-default summaries with title, status/dirty state, draft version, and abbreviated SHA-256; per-draft 展开/收起 controls reveal full SHA-256, title/Markdown editing for `draft` and `rejected` records, the safe rendered preview, displayed version/hash-bound approval/rejection with conflict refresh and a required second click, and approved Artifact publication. Expansion state is independent per draft and is not reset or expanded en masse by refresh; unsaved editor state and existing conflict safeguards remain in force.
5. **发布与存储目标管理器** — a master-detail workspace for the four fixed Local/GitHub/R2/WeChat Profile rows. A grouped channel rail selects exactly one target editor; basic behavior remains visible while network/capacity limits, write-only credentials, and destructive lifecycle actions are independently collapsed. An empty fixed channel can create its first target, but the visual manager never offers generic or same-channel additions once a target exists, preventing accidental duplicate selection; identity changes use the explicit copy-and-replace lifecycle instead. Unsupported runtimes do not occupy the primary workspace, diagnostics/import live under the overflow menu, and one non-floating global change area below the editor reviews, discards, or validates/applies all row changes. The installer pins one absolute `dshHome` and safe `profileName` in the exact Dashboard row; neither can be selected by the browser. Adding a destination never enables its channel; identity changes clone to a new immutable destination ID and retire the old ID. Apply submits v2 Profile/document/row CAS revisions, validates and preflights before maintenance, drains generation/publication server-side, atomically replaces only the managed overrides, and returns **restart required** without hot rebinding.
6. **发布审计** — allowlisted Receipt metadata.

### Publisher Profile change workflow

Publisher targets remain owned only by the named DSH Profile. Set `DSH_HOME`, then use the fixed-scope native command (typed JSON is read from stdin; raw YAML and arbitrary paths are rejected):

```sh
prismflow-dsh-profile export --profile web > publishers.json
prismflow-dsh-profile validate --profile web < plan.json
prismflow-dsh-profile preflight --profile web < plan.json
prismflow-dsh-profile import --profile web < plan.json
prismflow-dsh-profile pending --profile web
prismflow-dsh-profile reconcile --profile web
prismflow-dsh-profile cancel-pending --profile web
```

`pending` and `reconcile` inspect the one unresolved ledger entry and safely classify the current patch as the old hash, new hash, or ambiguous. `reconcile` also records a new-hash operation as completed. `cancel-pending` succeeds only when the ledger proves both the old hash and the durable `prepared` (pre-drain) phase; it never clears a draining, legacy-phase, new-hash, or ambiguous operation. Resume requires the running Dashboard's **继续待恢复操作** action so every generation/publication admission authority is drained before commit.

The bundle inserts the four fixed publisher plugin rows. In the named Profile's `cordis.patch.yml`, the managed form is at most one top-level `- id: prismflow-publisher-*` override per channel—never another publisher row inside a Profile-local `insert`. Export merges each override over the fixed bundle default `{ disabled: true, config: { destinations: [] } }`, so missing channels still appear as disabled, empty rows in the typed document. Import edits an existing top-level override or creates one for every missing channel without creating duplicate plugin instances, while preserving unrelated YAML, comments, and order.

Local typed input is capped at 2 MiB; each direct Dashboard POST remains capped at 32 KiB and requires an explicit same-origin `Origin` plus a loopback peer/Host. V2 plans carry the exact Profile SHA-256, stable document revision, and expected old row revision for every complete replacement. Import verifies canonical timestamps, exact keys and fingerprints and rejects unknown/secret-value fields, higher-precedence overlays, nested/duplicate/remove/ambiguous publisher operations, and managed module aliases. The shared exclusive cross-process lock captures and repeatedly rechecks the canonical Profile directory realpath plus filesystem identity, in addition to regular-file identity and every CAS level. A stable parent coordination lock prevents a renamed/replaced Profile directory from admitting a second manager; active or unverifiable owners are never displaced.

A dedicated Profile-managed state artifact retains immutable destination-ID digests so retired IDs cannot be reused with another identity; exact restoration is allowed. Tombstones are never pruned: state fails closed above 10,000 identities or 2 MiB. State is directory-durable before patch publication, and patch/state backups are bounded independently to five. A separate operation ledger durably stores the exact normalized strict-v2 request before drain, including deployment-owned destination paths and Credential Ref names but never credential values. Preparation validates tombstone conflicts and ceilings and records the exact state fingerprint/filesystem identity plus identity/absence/hash snapshots for all three higher-precedence overlay candidates. Commit rechecks those state and overlay preconditions after drain and immediately before replacement, including a fresh managed-publisher-reference scan, so changes during drain fail closed without publishing the patch. Every pending entry is retained; oldest completed/cancelled entries are pruned before reservation and iteratively for pending-to-completed byte headroom, with hard limits of 512 records and 1 MiB. The ledger records `prepared` before drain and `draining` before any admission authority is paused, blocks later imports while unresolved, classifies old/new/ambiguous patch hashes, recovers a patch-committed operation after response loss or browser/server restart, and rejects UUID reuse with another digest. Dashboard load discovers pending work without a browser-known UUID and offers strict resume or provably-pre-drain cancellation. Legacy WeChat references export only migration placeholders. Preflight performs no network request or destination write. Every successful direct save returns `restartRequired`; a disabled desired row is applied as soon as runtime reports `active=false`, because its retained plugin config is intentionally not loaded. Restart is out-of-band.

The Dashboard intentionally preserves the current loopback + same-origin **single-user** trust model; it does not invent bearer tokens. The DSH `webServer` integration used here exposes no authenticated administrator principal/capability to require. Consequently, every local OS process able to reach the loopback listener is trusted as the operator. Do not proxy or expose these routes to other users. A deployment requiring multi-user administrator authentication must place them behind a real DSH authenticated-admin capability when one is available, or keep the Dashboard unexposed.

The Dashboard intentionally has no acquisition center, Content Store browser, material selector, Generation Request creator, model-execution endpoint, raw-snapshot publication page, or prompt editor. Its Host API exposes only status, managed-source CRUD, strict workflow administration, content-free Generation Request status/cancel/retry, Publisher discovery, draft list/revision/review/approved publication, the draft-bound media proxy described below, and Receipt query endpoints. All former `/api/prismflow/generator-prompts` list/current/history/update/rollback paths are absent and return 404.

Draft revision is a narrow local control-plane operation. The API accepts exactly `draftId`, `expectedVersion`, `expectedSha256`, `title`, and `markdown`, and rejects stale writers. Only `draft` and `rejected` records are editable; approval and publication states are immutable. A successful revision increments the version, recomputes the Markdown SHA-256, returns the record to `draft`, preserves Generation Request, prompt, source-selection, content-claim, and creation provenance, and clears stale approval/publication fields. For packed selections, the persisted linked Generation Request is passed to the registered generator's same structural media validator used after generation. Required media cannot be removed or satisfied by code fences, comments, hidden HTML, or fallback content.

Every publication first persists a unique attempt/Receipt identity in the version-1 `prismflow_publication_attempts` ledger and then binds the same identity into the Draft claim before the destination-start phase. Normal `publish` remains first/new-destination only. A deliberate repeat uses the separate exact command and requires a currently `published` Draft, a previously used publisher, the displayed version plus full SHA-256, and a caller-generated UUID `intentId`. Dashboard generates that token once per confirmed click; transport replay reuses the token and returns the same durable attempt/Receipt, while a new token creates a new attempt. Restart recovery resolves new claims only from the exact attempt ID, preallocated Receipt ID, publisher, and Artifact identity; an older Receipt for identical content can never finalize a repeat. Missing/conflicting Receipts after destination start remain blocked. Receipt-persistence failures retain a safe normalized candidate and can unlock only after privileged repair persists and verifies that exact Receipt.

Rendered preview is created only for an expanded draft and never injects HTML. It creates React nodes for a conservative subset (headings, ordered items, bold, HTTP(S) links, line breaks, and HTTP(S) image/video elements), leaves unsupported HTML visible as text, and does not auto-link plain text. Recognized HTTP(S) links are visibly highlighted and open in a new tab with `noopener noreferrer`. Eligible canonical videos render immediately as responsive HTML video controls with inline playback, metadata preload, and `no-referrer`; there is no per-resource load control. Browser image/video `src` values always target the same-origin `/api/prismflow/production/media` proxy, never the authoritative host. The proxy accepts only an exact `draftId` + kind + URL tuple present in that draft's linked persisted Generation Request packed materials, rejects credentials, validates every DNS answer as public, pins the chosen socket address, revalidates redirects, and allows only a narrow image/video content-type set. Responses are cancellation-aware, use a 15-second per-hop network timeout, are `nosniff`, and are fully buffered under a hard 32 MiB ceiling; byte ranges are not supported. Resources using blocked protocols, credentials, localhost, `.local`, or private, link-local, multicast, or reserved address literals remain inert placeholders without a `src`. Preview is advisory: approval submits only the version/hash already displayed; a conflict refreshes the displayed record without retrying, so the administrator must inspect it and click again. Publication is blocked while any draft editor is dirty, and automatic review refreshes preserve all existing editor values; explicit manual refresh retains its discard confirmation. Publication still consumes only the approved Artifact.

### Safe workflow-generator builder

Enable `prismflow-store-generator-workflows` before `prismflow-generator-subagent`. Dashboard creation is available only when the generator plugin has a deployment-authored `builderProfile` (see the `dashboard-builder` profile in `cordis.patch.yml`). That profile pins the spawn Provider revision, the named `serial-workflow-v2` runner policy, and every execution ceiling; its canonical SHA-256 covers all non-secret execution-affecting values, credentials are never persisted, and tools remain `allow: []`. The Dashboard workflow DTO contains only logical identity, display metadata, and 1–8 ordered `{id,name,persona,processPrompt}` steps. Persona is required and nonempty. Process Prompt is optional: the exact empty string is preserved in history, rollback snapshots, and hashes; whitespace-only input is rejected. A nonempty value is used byte-for-byte. For an empty value, the pinned v2 runtime deterministically selects a deployment-owned fixed minimal wrapper: step one follows Persona and processes original evidence into structured output, while later steps follow Persona and revise/process the previous draft against the original evidence. Material and drafts remain outside Persona, and fallback text is never persisted or charged to the stored prompt aggregate. `modelRef` is not part of this contract and is rejected because the runtime cannot bind it.

DSH Home with SQLite is supported only as a **single-machine deployment**. Network-filesystem SQLite and multi-host shared SQLite are unsupported. Workflow writes require a deployment-controlled absolute `writerLockPath` on `prismflow-store-generator-workflows`; production generation, review, publication, recovery, and other mutations require a different deployment-controlled absolute `writerLockPath` on `prismflow-store-production`. For example, use `/var/lib/dsh/locks/prismflow-workflows.lock` and `/var/lib/dsh/locks/prismflow-production.lock`. Every local DSH process pointed at the same SQLite file must use those same two paths. They are never Dashboard settings, and the two paths must not be equal.

Each path is an atomically published lease file whose JSON owner records hostname, PID, random nonce, and creation timestamp. The complete owner is fsynced before the canonical hard link appears, so a creation crash cannot publish an empty owner. A live owner is never displaced. A dead same-host PID can be reclaimed only after the bounded stale age, under a separately owned stale-recoverable `.recovery` lease. A foreign-host owner, or a missing/malformed/unreadable owner, is never auto-removed; this is deliberate fail-closed behavior across hostname and PID namespaces. Release rechecks the complete owner record and file identity. Without the appropriate lock, workflow-builder and production mutations fail closed.

**Manual lock recovery:** stop every DSH process using the SQLite database, verify no process can still write it, inspect both the lock file and its `.recovery` file (and any abandoned `.candidate-*` files), take a backup, then remove only the confirmed abandoned files before restarting one process. Never remove a foreign-host or malformed lock while another process may be running.

Each workflow save is one exact CAS mutation and one circular history-row `put`; archive is a versioned disable rather than deletion. New Requests embed the complete validated workflow snapshot, including the full execution profile/strategy and exact Process Prompt strings, plus its version/SHA-256, so retries remain executable after history eviction or archive. The runner fails closed when the exact profile runtime is missing. `serial-workflow-v1` remains registered only for already-pinned old Requests; current definitions are safely rebound to the deployment's v2 profile and all new builder snapshots use v2. Steps are serial: step one sees original material, each later step sees the original evidence plus only the immediately previous structured `{title,markdown}` result, intermediate results stay in memory, and only a validated final result becomes a Draft.

Legacy generators appear as synthetic one/two-step projections with `legacy-stage-1` and `legacy-stage-2`, a clear **旧版生成器 · 尚未迁移** notice, and a **迁移为工作流** primary action. Migration uses the current legacy version/SHA precondition without modifying legacy history. After adoption the generator is edited as a normal workflow. Existing legacy Requests continue their original version-0/managed prompt dispatch unchanged.

Running request cancellation is attempt-CAS protected. Cancellation writes terminal `cancelled` first and aborts only that registered attempt; stale completion/failure cannot create a Draft or overwrite a retry. Chat and Dashboard can cancel and return failed/cancelled requests to `pending`, retaining the immutable snapshot.

### Internal legacy prompt compatibility

`prismflow-store-generator-prompts` remains available only as an internal read-only compatibility store. Its original four fields (`persona`, `instruction`, `reviewPersona`, and `reviewInstruction`), canonical SHA-256 calculation, immutable retained rows, and rolling latest-50 lookup semantics are unchanged so old pinned Generation Requests can resolve exactly and legacy generators can be projected/adopted. Existing rows are never rewritten, deleted, rehashed, rolled back, or repinned. The store exposes no Dashboard or Chat prompt mutation seam.

At execution and workflow-projection time, an old row deterministically composes `persona`, two newline characters, and the legacy `instruction` (and likewise for review); a wrapper already equal to the fixed wrapper is not appended. If either composition exceeds 10,000 characters, projection fails closed with only a generic/count migration error and never truncates or exposes the text. Retries resolve the exact pinned retained version and SHA-256; an evicted version still fails closed rather than silently selecting a newer row.

The deprecated Profile key `allowDashboardPromptEdit: true` may remain on a legacy generator only to bind its existing managed prompt history for old Request resolution and exact workflow adoption. Despite its historical name, it no longer enables an editor or any HTTP mutation. Keep the optional prompt-store row and legacy generator configuration where old managed Requests exist. Migration is performed only in **工作流生成器** through **迁移为工作流**. If the workflow store or Builder is disabled, no fallback prompt editor appears; compatibility history remains backend-only.

Editable Persona policy now belongs to workflow steps. Provider, tools, fixed wrappers, credentials, paths, ceilings, and untrusted-data boundaries remain deployment-controlled.

## Native WeChat draft publisher

Enable `prismflow-store-production-media` and configure `prismflow-publisher-wechat-draft` with one fixed destination per account/mode. A destination creates draft-box items only through `stable_token`, `media/uploadimg`, permanent `material/add_material`, and `draft/add`; it never calls PrismFlow HTTP routes and contains no mass-send/free-publish path.

```yaml
- id: prismflow-store-production-media
  disabled: false
  config:
    # Optional deployment-owned aliases must point to already-ingested exact asset hashes.
    defaultAssets: []

- id: prismflow-tool-production-media
  disabled: false

- id: prismflow-publisher-wechat-draft
  disabled: false
  config:
    destinations:
      - id: account-news
        name: WeChat Drafts — News
        appId: wx...
        appSecretCredential: WECHAT_ACCOUNT_SECRET
        apiOrigin: https://api.weixin.qq.com
        allowInsecureHttp: 0
        tokenMode: stable
        articleType: news
        defaultAuthor: PrismFlow
        digestPolicy: artifact-or-omit
        needOpenComment: 1
        onlyFansCanComment: 0
        defaultCoverAssetRef: https://source.hex2077.dev/logo/hex2077.ai.png
        ffmpegPath: ffmpeg # deployment-controlled executable path
        limits:
          titleChars: 32
          authorChars: 16
          digestChars: 120
          contentChars: 20000 # deployment-attested conservative ceiling
          contentBytes: 1000000 # final substituted UTF-8 content ceiling
          maxImages: 20
          bodyImageBytes: 999999
          permanentImageBytes: 10485760
          maxPixels: 25000000
          maxSourceBytes: 10485760
          fetchTimeoutMs: 15000
          requestTimeoutMs: 30000
          concurrency: 1
```

Create a second destination with `articleType: newspic` rather than exposing a publish-time mode toggle. The native `news` path follows the original PrismFlow publication semantics: Markdown is converted to the original WeChat-oriented safe inline style set, URL entities are decoded before canonical validation, each body image is attempted in document order; matching the original publisher, a body image whose bounded download, conversion, CDN upload, or required cover-material upload still fails is removed from the rendered article and publication continues, while the first successfully retained image becomes the cover. Destination media omissions are audited as `omittedMedia`; they do not use source-record `truncated`, because all bound source records remain represented by the publication Artifact and Receipt provenance, and a configured credential-free HTTPS fallback logo URL is fetched through the pinned safe media transport when no body image exists. Its `draft/add` article intentionally omits `article_type`, matching the original normal-news payload; only `newspic` sends `article_type`. Source images may use HTTP or HTTPS as in the original renderer, but are still fetched only through all-address DNS validation, per-attempt socket pinning, redirect revalidation, deadlines, MIME and size bounds. Matching the original publisher, each source image has one bounded download attempt; a failed download is silently omitted and processing continues with later media. The WeChat compatibility fetch uses the original Axios `Accept`/`User-Agent` behavior without a Referer, while all network safety checks remain enforced. Existing `mmbiz.qpic.cn` images are retained without re-upload. Already compliant bounded JPEG/PNG body images are preserved byte-for-byte as in the original publisher, avoiding size-increasing re-encoding; WebP/AVIF and oversized body images are deterministically converted to bounded WeChat JPG/PNG representations. In `news`, strict HTTP(S) `<video>` sources are fetched through the same safe bounded media transport, passed to the Profile-controlled `ffmpegPath`, limited to the first 5 seconds, 8 FPS, width 400, and at most 40 frames, uploaded as a permanent GIF image, and substituted into the article; download, conversion, or upload failure removes that video and continues. `newspic` removes videos without conversion. Local representation and cover readiness run before a durable publication attempt is allocated. Each acknowledged intermediate image upload clears its in-flight uncertainty marker, so a later explicit WeChat rejection is recorded as definitely not committed rather than incorrectly forcing whole-draft reconciliation; transport timeouts and malformed mutation responses record their exact stage. Unknown body or permanent-media uploads are automatically restored as a retryable publication because `draft/add` has not run yet (an orphan media object may remain). An unknown `draft/add` result remains fail-closed across restart because retrying can create a duplicate WeChat draft. The Attempt retains `externalOutcome: unknown`, and Dashboard requires exact operator reconciliation rather than claiming the external mutation did not occur. WeChat credentials are resolved for every operation and are never projected or logged. The stable-token cache is memory-only, isolated by AppID plus a non-exported credential digest, refreshed early, cleared on provider shutdown, and passively refreshed once for official `40001`, `40014`, and `42001` responses. Production defaults to the official API and permits one Profile-controlled compatible HTTP(S) API Base URL for token, media, and draft operations. Intermediate body/permanent-media transport uncertainty is retried three times through that same API Base URL using the Profile's `requestTimeoutMs` for every upload attempt; `draft/add` uncertainty is never automatically retried. A lost `draft/add` response remains fail-closed because the Host cannot infer external success from a timeout. Dashboard publication returns a structured HTTP 202 reconciliation result rather than a misleading browser-level 409 failure; the Draft remains blocked and the UI still requires operator reconciliation. Dashboard now offers two exact operator reconciliation outcomes after the official-account draft box is checked: confirmed absent restores the pre-publication state; confirmed present first persists an attempt-bound `draft.add.operator-confirmed` Receipt with `verification: unverified`, then marks the Draft published. Both actions show a confirmation dialog and automatically bind the exact blocked WeChat Attempt selected by the Draft; operators no longer type an Attempt ID, while the API still validates the hidden exact Attempt identity. Redirects remain disabled. HTTP is rejected unless the same destination explicitly sets `allowInsecureHttp: 1`; this dangerous compatibility mode sends App Secret, access tokens, articles, and media over plaintext transport. An existing WeChat destination may update the API Base URL and this risk switch in place under exact Profile CAS; other identity changes still require “Replace destination” with a new ID. Configure the official account's **source IP allowlist** for every deployment egress IP before enabling the destination.

New custom cover/order operations require an approved v2 Artifact whose image claims resolve from the content-addressed Production media store. V1 HTTPS images remain only a bounded compatibility path for `news`; the initial URL and every redirect must remain HTTPS. Private/reserved DNS answers, credential URLs, MIME mismatches, oversized bodies, and non-JPG/PNG body images are rejected per image and that image is omitted under the explicitly restored original fail-open policy. The Receipt's `omittedMedia` count records destination media omissions without exposing source URLs or network details; `truncated` remains reserved for omitted source records. Final substituted content is checked against both the character and UTF-8 byte ceilings before `draft/add`. Crop payload serialization remains disabled until official fixtures and a live-account contract test attest the exact `cover_info.crop_percent_list` contract.

WeChat has no dependable idempotency key for image or draft mutations. A timeout, disconnect, cancellation, malformed success, non-semantic HTTP failure, or DSH restart after the WeChat destination started therefore blocks the exact Attempt for operator reconciliation rather than permitting an unsafe duplicate click. Historical retry-released unknown attempts can still be reconciled retrospectively without falsely recording them as externally absent. An official semantic error remains a definite rejection. A confirmed bounded draft `media_id` produces a verified Receipt containing only approved Artifact identity, mode, and draft media ID—never tokens, secrets, request bodies, rendered content, upload URLs, or permanent material IDs.

## PrismFlow Toolset and Skill library

The Dashboard **工具集** tab controls only PrismFlow's Chat surface; it never changes DSH shell, filesystem, Web, Todo, Goal, or third-party tools. It also contains a dedicated **图片生成接口** card for `prismflow_image_generation`: administrators can update the credential-free HTTP(S) endpoint, protocol (`auto`, Images Generations, or Chat Completions), exact model ID, image size, AVIF quality/effort, and save/rotate/remove the write-only API Key. HTTP endpoints are supported for trusted compatibility gateways, but the Dashboard displays a plaintext-transport warning and requires explicit confirmation before saving because the API Key, prompt, and response are not transport-encrypted; production endpoints should use HTTPS. Settings use SQLite version/SHA-256 CAS and become authoritative on the next tool call without a DSH restart. The fixed Credential Ref is never returned to the browser; the real key is resolved per call from DSH Credentials and is never cached or echoed. Image API JSON is streamed through a 48 MiB hard bound so multi-megabyte `b64_json` and data-URL responses can be decoded without being projected into the Chat tool result. The decoded image is converted, persisted as a Production Media asset in SQLite, uploaded to the fixed R2 media destination as AVIF, and the tool returns only the bounded Markdown URL plus asset claim. The persisted SQLite toolset offers core, complete, and custom modes: core retains the twelve primary production and Production Media tools, including image ingestion, unapproved presentation binding, and approved/published-Draft image revision; complete adds the three restricted selection/request operations and the five native compatibility tools `prismflow_process_markdown_media`, `prismflow_trigger_insight_daily_build`, `prismflow_image_generation`, `prismflow_generate_rss_content`, and `prismflow_github_push`, plus the approved-Artifact publication tools `prismflow_publishers` and `prismflow_publish` (23 total, including the compatibility alias for the original approved-only revision tool name). All Chat-facing tool names use the `prismflow_` namespace; existing complete/custom toolsets are migrated from the five former unprefixed compatibility names at startup while Profile-owned credentials and behavior remain unchanged. Unlike `prismflow_publish`, `prismflow_github_push` intentionally restores the original arbitrary-text contract and does not use the approved-Artifact Attempt/Receipt barrier. Article targets retain Frontmatter, filename/branch/message controls, and one-time missing-metadata extraction. The fixed root RSS target uses repository `justlovemaki/Hex2077-Site`, branch `book`, path `rss-t.xml`, requires a persisted `rssOutputId`, and disables Frontmatter and date prefixes. `prismflow_generate_rss_content` rebuilds the feed from persisted `approved` and `published` Drafts in newest-approval-first order; `rssMaxItems` controls the retained history (default 7, maximum 100). Its feed shape and line layout are emitted by the same `rss` (`RSS for Node`) serializer as the original daily tool: indented channel/item elements on separate lines, `AI资讯日报 RSS Feed` metadata, CDATA fields, dated `docs/YYYY-MM/YYYY-MM-DD/` item links and GUIDs, and the complete Markdown-derived HTML in `content:encoded`. Generated XML, bound Markdown, and HTML are persisted in the local SQLite RSS Output Store and visible under the bound Draft in Dashboard review. The generation result renders only the Output ID, byte count, and XML SHA-256 so an Agent cannot truncate or reconstruct the XML between tool calls. Tool-schema changes require a DSH restart and affect subsequent Chat agents.

PrismFlow Skills are standard Agent Skill directory bundles: each immutable kebab-case identity has a `SKILL.md` with YAML frontmatter and Markdown instructions, plus optional `scripts/`, `references/`, and `assets/` resolved relative to the bundle root. Four bundled Skills always ship inside `@prismflow/dsh`; managed edits materialize an override under the deployment-controlled Skill root. The DSH provider advertises only selected `name`/`description` metadata, loads the current body on demand, and exposes a directory `resourceBase` for progressive resource disclosure. SQLite stores CAS-bound version/SHA-256 audit history and toolset selection, not the runtime body authority. Dashboard administrators can create, edit, enable/disable, copy, inspect retained history, roll back, and tombstone-delete IDs without removing the physical bundle. A Skill cannot grant a tool; it can only guide use of PrismFlow tools already admitted by the active toolset. Raw HTML is never executed by the editor preview.

## Chat content-production flow

Enable the durable stores and Chat tools in a Profile with a storage domain:

```yaml
- id: prismflow-store-content
  disabled: false

- id: prismflow-tool-content
  disabled: false

- id: prismflow-store-content-relevance
  disabled: false
  config:
    defaultHours: 48
    maxHashCharsPerRecord: 2000000
    maxAggregateHashChars: 1500000000
    maxScanCharsPerRecord: 524288
    maxAggregateScanChars: 1500000000
    maxEvidence: 8
    maxEvidenceChars: 160
    maxCardChars: 2000

# Relevance remains an internal Selection dependency and is not exposed to normal Chat.
- id: prismflow-tool-content-relevance
  disabled: true

- id: prismflow-store-content-selection
  disabled: false
  config:
    defaultMaxItems: 30
    maxItems: 50
    defaultMaxInputTokens: 50000
    maxInputTokens: 60000
    maxMaterialChars: 80000
    minCharsPerItem: 600
    maxCharsPerItem: 3000
    maxMediaPerItem: 16
    maxPerSource: 8
    longTailPercent: 20
    maxBucketSize: 200
    maxPairComparisons: 200000
    maxMemberClaims: 10000
    selectionHashMaxChars: 12000000

- id: prismflow-reviewer-ai-relevance-subagent
  disabled: false
  config:
    subagentProvider: spawn
    batchSize: 24
    maxCards: 120
    maxCardChars: 800
    unmatchedAuditPercent: 2

- id: prismflow-tool-content-selection
  disabled: false

- id: prismflow-store-publication-receipts
  disabled: false

# Receipt inspection belongs to Dashboard audit.
- id: prismflow-tool-publication-receipts
  disabled: true

- id: prismflow-store-production
  disabled: false
  config:
    writerLockPath: /var/lib/dsh/locks/prismflow-production.lock

# Enabling this bundled row uses the deployment-controlled two-stage
# daily-brief prompts and ceilings defined in cordis.patch.yml.
- id: prismflow-generator-subagent
  disabled: false

- id: prismflow-tool-production
  disabled: false
```

Then use DSH Chat tools in this order:

1. `prismflow_sources` to discover configured source IDs, then `prismflow_sync_source` to fetch and persist each required source.
2. `prismflow_create_ai_selection` to freeze the window, ensure relevance coverage, review bounded ambiguous/audit cards, cluster duplicate events, rank diverse representatives, and persist bounded verbatim material. The restricted `prismflow_create_ai_selection_from_explicit_source` remains available only after explicit user approval.
3. `prismflow_generators` and `prismflow_create_generation_request_from_ai_selection`; Production resolves and pins the persisted Selection internally. The restricted explicit-content-ID request tool remains approval-gated.
4. `prismflow_generation_request` with `action: list | cancel | retry` for bounded Request inspection and recovery.

`prismflow_create_ai_selection` is the default all-sources selector: its Chat schema intentionally has no `sourceId`, `maxItems`, or `maxInputTokens`, so the Agent cannot silently narrow a general request to one feed or degrade output quality by repeatedly lowering item/context budgets. A window below the default 48 hours, category filter, or topic filter requires one-shot user approval. Selection summaries report the distinct selected `sourceIds`. Exact-source selection is isolated as `prismflow_create_ai_selection_from_explicit_source` and also requires one-shot user approval; missing approval support fails closed. The bundled reviewer admits up to 500 cards in bounded batches, covering the supported all-source 48-hour deployment profile without forcing an Agent-selected shorter window.
5. `prismflow_generate_draft` to invoke the calling Agent's restricted, version-pinned workflow using the bounded material snapshot rather than full source bodies. Every stage rejects the Unicode replacement character `U+FFFD` and unpaired UTF-16 surrogates. A stage that returns either is disposed and regenerated once from the same authoritative prompt with an explicit encoding-repair constraint; a second malformed result fails the Generation Request, and no Draft is persisted. The compatibility `daily-brief` starts as two no-tool `spawn` stages and can be adopted into the Workflow Builder; later steps receive the original evidence plus the untrusted previous draft, and only the final result is eligible for persistence.
6. Review the complete draft in the Dashboard and approve its exact version/SHA-256.
7. Approve, delete, publish, explicitly republish, and inspect Receipts only in Dashboard.

`prismflow_drafts` returns summary metadata only, not Markdown. `prismflow_edit_draft` can inspect/save only `draft` or `rejected` rows under exact version/SHA-256 CAS. For an exact `approved` or `published` Draft, Chat may use `prismflow_image_generation`, `prismflow_ingest_production_image`, or `prismflow_get_production_image_claim` for an existing assetId, followed by `prismflow_create_draft_image_revision`; this preserves the source Artifact and creates a new Draft plus Generation Request with immutable derivation provenance and `draft` status. Placement is restricted to `cover-and-first`, `append`, or `cover-only`, and the derived Artifact must be approved again in Dashboard. Any Draft with a bound cover exposes a **查看封面** action directly in the collapsed review list; it opens a same-origin Production Media preview for every destination-bound cover without requiring Draft expansion. Chat still has no approval or deletion authority; Publisher and Receipt capabilities remain limited to their separately enabled controlled tools.

AI relevance remains a conservative, explainable lexical triage rather than an embedding model. The v0.9 selection pipeline sends only bounded `ambiguous` cards plus a deterministic small `unmatched` audit sample to the fixed no-tool reviewer; exact cardinality and ids are required. It then performs bounded SimHash/Jaccard title clustering, explainable source/topic diversity ranking, and deterministic verbatim evidence extraction. The deployment-owned optional source quota is applied before general diversity filling and rechecked after material packing. This deployment requires `github-trending:daily` to contribute 3–5 AI-relevant representative events. Every locally unmatched row from that quota source is sent through the no-tool semantic reviewer rather than relying on the normal 2% unmatched audit sample. Fewer than three reviewer-accepted distinct events, or fewer than three surviving the context budget, fails the Selection rather than silently weakening the quota; no more than five can be admitted. An explicitly approved exact-source Selection for a different source does not inherit the all-source GitHub quota. The immutable Selection Artifact pins content hashes, selection SHA-256, ordered ids, excerpt offsets/hashes, and context budgets. Production accepts only `generatorId + selectionId`, re-resolves those claims, and never accepts material bodies from Chat. Manual ordered-ID Generation Requests remain available only through the deliberately named `prismflow_create_generation_request_from_explicit_content_ids` escape hatch. Its strict DTO requires `selectionIntent: "explicit-user-ordered-content-ids"`, its tool contract forbids Agent-derived IDs, and a `tools/pre-execute` gate requires one-shot user approval; missing approval support fails closed. The former generic direct-request tool name is not registered. Existing one-stage generator configurations remain supported.

The Dashboard may permanently remove a clean `draft` or `rejected` row from normal review visibility with an exact Draft version/SHA-256 confirmation. Deletion writes a durable tombstone instead of destroying the underlying Draft or linked Generation Request, preserving workflow/selection/source provenance for audit. Approved, publishing, and published Drafts cannot be deleted; deleted Drafts cannot be edited, reviewed, previewed, approved, or published, and exact retries are idempotent.

Chat may use the single `prismflow_edit_draft` editor tool on `draft` or `rejected` rows. Dashboard and Chat revisions reject `U+FFFD` and unpaired surrogates rather than preserving mojibake. `action: "inspect"` returns one exact title/Markdown/version/hash inside an explicit untrusted-data boundary. `action: "save"` requires that exact CAS, a complete replacement title/Markdown, and `mediaPolicy: "editor-controlled"`; Chat may add, remove, or rewrite content and may remove media attached to deleted entries. Normal title/Markdown bounds and control-character checks still apply. The Draft version/hash advance, stale saves fail, and approval/publication state is never granted by the tool. Dashboard remains the sole approval authority. Provider, tool permissions, paths, materials, credentials, and stage ceilings remain Profile-controlled. The loopback Dashboard may manage only logical workflow identity and ordered step name/Persona/optional Process Prompt fields under the deployment-owned Builder profile. The legacy four-field prompt history is internal and read-only, retained solely for exact old-Request resolution and CAS-bound workflow adoption. Stage inputs and outputs are independently bounded; an overflow fails closed without truncating authoritative material. At final generation only, a trusted source-media URL that is completely absent from the model output is restored deterministically under a `补充媒体资源` section and then revalidated. Media placement, `<br/>` layout, Alt Text wording, and optional video presentation attributes are prompt-owned style rather than hard runtime formatting contracts. Runtime completeness recognizes rendered Markdown images regardless of line placement and semantically safe HTTP(S) video tags regardless of cosmetic attribute spelling/order. A URL that appears only as plain text, or inside malformed, hidden, code, or unsafe markup, is never treated as rendered media and remains a hard failure. This prevents an Agent from evading media completeness by repeatedly reducing the selected item count while retaining the existing structural safety checks.

## Managed source configuration

Enable the visual settings store once:

```yaml
- id: prismflow-store-source-settings
  disabled: false
  config:
    credentialSlots:
      - id: follow-cookie
        name: Follow / Folo Cookie
        usage: follow-cookie
        credentialRef: PRISMFLOW_FOLLOW_COOKIE
        allowDashboardWrite: true
    bootstrap:
      - { type: github-trending, id: daily, name: 每日热门, category: githubTrending, enabled: true, since: daily, limit: 25 }
      - { type: github-trending, id: weekly, name: 每周热门, category: githubTrending, enabled: false, since: weekly, limit: 25 }
      - { type: follow, id: papers, name: 学术论文, category: paper, enabled: true, listId: '158437917409783808', fetchDays: 3, fetchPages: 1, view: 0, limit: 50, credentialSlotId: follow-cookie }
      - { type: follow, id: reddit, name: Reddit, category: socialMedia, enabled: true, listId: '167576006499975168', fetchDays: 3, fetchPages: 1, view: 0, limit: 50, credentialSlotId: follow-cookie }
      - { type: ai-search, id: ai-news, name: AI 资讯搜索, category: news, enabled: true, keyword: AI 行业最新动态, limit: 10 }
      - { type: rss, id: rss-example, name: 阮一峰的网络日志, category: rss, enabled: true, url: http://www.ruanyifeng.com/blog/atom.xml, limit: 10 }
```

`bootstrap` applies only while the source-settings domain is empty. Dashboard edits register/unregister sources immediately, but fetching is always performed through Chat.

The page mirrors PrismFlow's original **Adapter + Items** model: GitHub Trending, Follow API (Folo), AI 搜索, and RSS 订阅 are independently enabled adapters; every configured source is an independently enabled Item. Disabling an adapter unregisters and drains its active Items without changing their enabled flags, and re-enabling it restores only enabled Items. Adapter state is persisted in reserved records in the permissive v1 source-settings table, so existing domains require no migration. Categories are the original `news`, `githubTrending`, `paper`, `socialMedia`, and `rss` values. Source-type defaults are 25/50/10/20 respectively; omitted AI Search and Follow categories default to `news` and `paper`.

Dashboard source writes use explicit create/update semantics. Create refuses an existing identity; update is conditional on both the immutable settings ID and the exact `updatedAt` revision returned by the last read, preventing a stale browser tab from overwriting a newer edit.

Credential slots are deployment-owned. The browser receives only opaque `id`, `name`, `usage`, configured/source/writable facts, and the Dashboard-write policy—never `credentialRef` or a value. When `allowDashboardWrite: true`, the local same-origin Dashboard may set, rotate, or remove that predefined slot through DSH Credentials; the password input is cleared after commit. Values are stored by `$DSH_HOME/.credentials.yaml` (or a higher-priority provider), resolved on every Follow fetch, and never stored in the source-settings domain. A read-only environment-supplied credential remains visible as configured but cannot be overwritten. Slots without Dashboard write permission can instead be populated by the deployer, for example:

```yaml
# $DSH_HOME/.credentials.yaml
PRISMFLOW_FOLLOW_COOKIE: your-follow-cookie
```

Follow resolves the chosen slot on every fetch and fails closed when a selected credential is absent. Follow is fixed to `https://api.folo.is/entries`; GitHub Trending to `https://github.com/trending`; managed AI Search to the current DSH Chat Agent → `spawn` → `web_search`. Arbitrary endpoints, proxies, `useProxy`, and executor IDs are intentionally unavailable; networking belongs to the DSH Host/deployment.

Fetched rows are admitted independently. RSS, Follow, GitHub Trending, and AI Search skip a malformed field variant or an entry with no meaningful description/content and continue with later rows. Content Store batch admission also isolates non-object, non-serializable, missing-required-field, and empty-content rows and reports them in `skipped`; duplicate rows remain `skipped` as before. Whole-source transport/parser failures, cancellation, storage failure, and deployment/configuration errors still fail closed rather than being misreported as item omissions.

Managed RSS accepts credential-free HTTP(S) URLs only. Each request and bounded redirect resolves and validates all DNS answers, rejects private/loopback/link-local/reserved/multicast targets, pins the socket to a validated address while preserving HTTPS SNI/certificate checks, and enforces a 2 MiB response bound. Egress policy remains recommended defense in depth.

Static source rows remain available for deployment configuration. A static and managed source may coexist only when their complete source IDs differ.

## Publisher configuration

Destinations are deployment-owned. Configure each channel by overriding its bundle row once at the top level of the Profile patch; do not put publisher plugins in a Profile-local `insert`. `artifactFileNamePattern` is used for approved drafts:

```yaml
- id: prismflow-publisher-local-markdown
  disabled: false
  config:
    destinations:
      - id: daily
        name: Daily Markdown
        root: /absolute/path/to/publications
        artifactFileNamePattern: prismflow-brief-{date}.md
        overwrite: if-changed
        maxBytes: 1000000
```

GitHub destinations additionally own repository, branch, path prefix, API root, commit message, and a DSH token Credential Ref. R2 destinations own account, bucket, key prefix, optional public URL prefix, and DSH access-key Credential Refs. Publisher Credential Refs are system-generated for every new/replacement destination and hidden from editable forms; operators cannot type or alter them. The Dashboard renders only write-only real-secret fields, allowing operators to save, rotate, remove, and refresh GitHub, R2, and WeChat credentials without editing files. Values are written directly through `ctx.credentials.set()`, cleared from browser state after commit, resolved per publication operation, and never read back or projected to browser/model output. The credential APIs accept only exact slots derived from the currently persisted Profile row/config revision. Legacy Profile rows containing literal secret-like GitHub tokens are exported only as `MIGRATION_REQUIRED` placeholders; replacement automatically allocates new hidden Credential Refs.

Local publishing rejects symlinked/missing/non-absolute roots and uses guarded writes. GitHub uses Contents API SHA optimistic concurrency with bounded conflict re-observation and rejects redirects. R2 uses fixed Cloudflare origins and conditional create/update (`If-None-Match`/`If-Match`) with bounded conflict re-observation.

## Receipts and failure truth

All approved Artifact publications pass through the central publisher registry and optional Receipt sink. The registry has no raw-record publication method: every Provider implements only `publishArtifact`, and every call must match the exact persisted Draft Store body, version/hash, and ordered provenance under an active Production Store publication claim. Receipts include allowlisted destination facts plus `draftId`, `draftVersion`, and `artifactSha256`; they never include Markdown, request/response bodies, credential values/references, or arbitrary Provider fields.

If an external write commits but receipt persistence fails, the result reports `publicationCommitted: true` and `receiptPersistence: failed`; both Dashboard and Chat explicitly block further publication until privileged Receipt repair/reconciliation succeeds. Successful remote writes without usable revision metadata are retained as `verification: unverified` rather than misreported as failed.

## Current limitations

- The DSH target remains pinned to `0.1.0-rc.6` while DSH is in developer preview.
- Storage Domain v1 has no secondary indexes or batch transaction; queries scan the in-memory domain snapshot, and failed content batches can leave an idempotently retryable prefix. SQLite avoids whole-file rewrites but does not add query indexes to the Domain API.
- Production-operation overlap prevention is process-local; providers must honor abort signals during shutdown.
- GitHub/R2 production acceptance still requires narrowly scoped real test credentials and test resources.
- Public RSS/Follow access remains subject to remote availability and deployment egress policy.
