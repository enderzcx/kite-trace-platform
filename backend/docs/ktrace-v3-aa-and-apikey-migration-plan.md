# KTrace V3 AA And API Key Migration Plan

Updated: 2026-03-20
Status: active - CC frontend V3 migration complete (Phase 1-5); backend V3 job-lane cutover, CLI API-key UX cleanup, internal auth cleanup, and connector polish complete

## Roles

This plan is a joint effort between two agents:

- **Codex** - backend: contracts, scripts, API routes, session policy, escrow helpers, sessionPay, CLI
- **CC** - frontend: `agent-network` Next.js app, onboarding wizard (`SetupWizardClient.tsx`), authority panel, job audit views, approval flows

## Goal

Make `ktrace` feel wallet-first and API-keyless at the user surface while keeping full functionality:

- publish ERC-8183 jobs
- fund jobs
- execute / submit jobs
- complete or reject jobs
- buy paid capabilities through x402
- keep receipt / evidence / audit outputs complete

The intended steady state is:

- all user-facing AA wallets are V3-capable
- all user-facing job actions use session-scoped generic execution
- all user-facing payments use session pay / x402
- API keys are removed from normal user experience
- internal/system API keys remain as backend implementation detail during migration

## Executive Summary

The old AA account line, `GokiteAccountV2-session-userop`, is not broken for AA in general. It is limited by design.

What V2 can do well:

- session-scoped payment execution through `executeTransferWithAuthorizationAndProvider(...)`
- x402 and `/api/session/pay` style settlement

What V2 cannot do reliably:

- session-scoped generic contract execution for ERC-8183 job mutations
- `create / fund / submit / complete / reject` through a session key

Observed root cause:

- owner-signed generic `execute(...)` worked
- session-signed payment entrypoint worked
- session-signed generic `execute(...)` produced `userOpHash` but often never produced a usable receipt

Conclusion:

- V2 is a payment-session account
- V2 is not a full job-lane account
- ERC-8183 full lifecycle requires a dedicated session-aware generic execution path

That path now exists in V3:

- [KTraceAccountV3SessionExecute.sol](/E:/CODEX/kite-trace-platform/backend/contracts/KTraceAccountV3SessionExecute.sol)

And the official minimal ERC-8183 proof has already been completed live on Kite testnet with fresh V3 accounts:

- [verify-official-erc8183-v3-proof.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-official-erc8183-v3-proof.mjs)

## Current Facts

### Proven Now

Live proof on Kite testnet already succeeded for fresh V3 accounts:

- requester `createJob`
- requester `fund`
- provider `submit`
- evaluator `complete`
- evaluator `reject`

Proof artifacts are produced by:

- [AgenticCommerceOfficialMinimal.sol](/E:/CODEX/kite-trace-platform/backend/contracts/AgenticCommerceOfficialMinimal.sol)
- [verify-official-erc8183-v3-proof.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-official-erc8183-v3-proof.mjs)

Fresh V3 x402 payment proof has also succeeded for the normal KTrace user path:

- `ktrace auth session`
- `ktrace buy request`
- x402 challenge/payment flow
- session pay through V3
- `ktrace artifact receipt`
- `ktrace artifact evidence`

Relevant surfaces:

- [buyCommands.js](/E:/CODEX/kite-trace-platform/backend/cli/commands/buyCommands.js)
- [sessionRuntime.js](/E:/CODEX/kite-trace-platform/backend/cli/lib/sessionRuntime.js)
- [sessionPay.js](/E:/CODEX/kite-trace-platform/backend/lib/sessionPay.js)

### Guarded Now

Backend already treats V2 as payment-only and refuses job-lane generic execution:

- [aa-session-policy.md](/E:/CODEX/kite-trace-platform/backend/docs/aa-session-policy.md)
- [escrowHelpers.js](/E:/CODEX/kite-trace-platform/backend/lib/escrowHelpers.js)

This avoids the old failure mode where a V2 session would submit a `userOpHash` and then hang waiting for a receipt that never arrives.

### Proven Before Full Cutover

The last major backend proof item is now complete:

- fresh V3 KTrace payment regression pass covering:
  - `ktrace buy request`
  - x402 challenge/payment flow
  - session pay through V3
  - receipt and evidence export
  - audit continuity

The payment path continues to use the payment-specific method and has now been verified against V3:

- [session-pay-reliability-runbook.md](/E:/CODEX/kite-trace-platform/backend/docs/session-pay-reliability-runbook.md)
- [sessionPay.js](/E:/CODEX/kite-trace-platform/backend/lib/sessionPay.js)

### Confirmed By Backend (2026-03-20)

The following points are confirmed and no longer open:

1. **createSession ABI is unchanged in V3.** Wizard Step 2 on-chain session registration can continue using the existing call pattern without modification. Reference: `KTraceAccountV3SessionExecute.sol` line 195.

2. **accountCapabilities is already present in runtime payload.** Backend now outputs the following fields on every session response:
   - `accountVersionTag`
   - `accountCapabilities.sessionPayment`
   - `accountCapabilities.sessionGenericExecute`
   - `requiredForJobLane`
   Frontend does not need to wait for a backend change. Phase 1 CC work can begin immediately.

3. **No old user migration.** When V3 goes live, all users redeploy fresh V3 AA wallets. There are no in-place upgrades, no old address reuse, and no V2 -> V3 migration branch in UX. Frontend does not need to implement proxy upgrade copy, legacy address detection, or migration branching.

4. **Fresh V3 x402 proof is complete.** KTrace payment, receipt, and evidence flow now works on V3 without user-visible API key setup. This removes the last backend blocker for Phase 2 and lets CC treat the default paid-user flow as wallet/session-first.

5. **Session-first connector groundwork is in place.** Backend now has generic `/api/connector/agent/*` routes and connector-token-first MCP auth. Claude is the first client, but the model is no longer hard-coded to API-key-first Claude onboarding.

## CC Frontend Progress Snapshot (2026-03-20)

All CC-owned frontend work is complete across Phase 1 through Phase 5.

### Phase 1 — SetupWizardClient.tsx capability-driven logic ✓

- `SessionRuntime` interface extended with `accountVersionTag`, `accountCapabilities.sessionPayment`, `accountCapabilities.sessionGenericExecute`, `requiredForJobLane`
- `parseRuntime()` reads and normalises all three new fields from runtime payload
- Wizard routing logic converted from version-string checks to capability flag checks: `accountCapabilities.sessionGenericExecute`
- `prepareFreshV2Wallet()` renamed to `prepareFreshWallet()` — no version references in function names
- `requiresV2Upgrade` replaced by `requiresNewWallet` (capability-based: `sessionGenericExecute !== true`)
- All default-flow UI copy purged of V2/V3 labels ("Your V2 AA Wallet" → "Your AA Wallet", "V2 factory" → "factory", etc.)
- Capability Badges rendered in wallet status card:
  - `accountCapabilities.sessionPayment` → **Payment Ready** badge
  - `accountCapabilities.sessionGenericExecute` → **Job Ready** badge

File: `agent-network/components/setup/SetupWizardClient.tsx`

### Phase 2 — JobAuditView.tsx V3 evidence/receipt compatibility ✓

- `roleEnforcement` type extended: `executionMode?: string`, `aaMethod?: string`
- Contract Primitive Status section renders V3 execution metadata block when fields are present
- No layout breakage for existing V2/owner-sign evidence shapes
- No API key prompt appears anywhere in the audit/receipt view

File: `agent-network/components/jobs/JobAuditView.tsx`

### Phase 3 — executionMode / aaMethod surfaced in job audit view ✓

- `executionMode` renders as a labelled code row ("Execution Mode") when present
- `aaMethod` renders as a labelled code row ("AA Method") when present
- Both fields are only shown when non-empty — no empty rows in legacy records

File: `agent-network/components/jobs/JobAuditView.tsx`

### Phase 4 — Step 3 restructured to wallet/session-first Setup Complete ✓

- Step 3 heading changed from "API Key + Claude Desktop" to "Setup Complete / Connect"
- Three client entry points rendered as expandable accordion cards:
  1. **Use KTrace CLI** — session-first CLI setup guidance
  2. **Connect Claude** — wallet-first Claude Desktop / Claude.ai connection; API key access only under collapsed "Advanced / Developer Setup" within this card
  3. **Connect Another Agent** — generic agent connector (MCP connector token, not API key)
- API key generation removed from the default Step 3 display surface
- Hero subtext updated: "get your API key for Claude Desktop" → "connect your client"
- Return-user routing to Step 3 label updated to reflect "Setup Complete" intent

File: `agent-network/components/setup/SetupWizardClient.tsx`

### Phase 5 — Unsupported account handling (no migration UX) ✓

- If `accountCapabilities.sessionGenericExecute === false` AND `accountCapabilities.sessionPayment === false`, shows plain `ErrorBanner`: "This wallet is not supported. Create a new wallet below."
- Single CTA: **Create New Wallet** — launches fresh Step 1 onboarding
- No "Upgrade Wallet", "Keep Payment-Only Wallet", or proxy upgrade language anywhere
- No legacy address reuse detection
- No V2 → V3 transition branch

File: `agent-network/components/setup/SetupWizardClient.tsx`

---

## Backend Progress Snapshot (2026-03-20)

Backend work that is already in place:

- V3 is the default AA account line for new-user backend provisioning
- session runtime payloads already expose:
  - `accountVersionTag`
  - `accountCapabilities.sessionPayment`
  - `accountCapabilities.sessionGenericExecute`
  - `requiredForJobLane`
- V2 job-lane execution still fails fast instead of hanging on dropped receipts
- KTrace V3 x402 flow has passed fresh live proof
- official minimal ERC-8183 V3 flow has passed fresh live proof
- KTrace custom job-lane V3 flow has passed live proof for:
  - `create -> fund -> accept -> submit -> validate`
  - default validator resolution on `/validate` without explicit `validatorAddress`
- generic session-first agent connector routes are available
- MCP accepts connector-token-first auth, with API key only as compatibility fallback
- internal/admin/provider API keys remain backend-only infrastructure

Backend cleanup completed after proofing:

- stale runtime capability metadata is now recomputed from authoritative `accountVersion` when it is present, so old cached V2 tags do not keep a V3 wallet stuck in payment-only mode
- default CLI/config output no longer advertises user-facing API key setup in the normal happy path
- managed executor/validator startup now validates against the V3 job-lane required version instead of logging false V2 mismatch errors
- self-serve setup/auth routes now prefer onboarding-cookie or compatible account credentials instead of env API keys
- connector bootstrap is idempotent for already-connected clients and still preserves env-key compatibility for backend verifier/dev harness paths

## Product Principles

### 1. User Surface Must Be API-Keyless

Normal users should not need to:

- request an API key
- paste an API key
- understand internal service tokens
- distinguish between transport auth and billing auth
- understand whether their account is V2 or V3

Users should only see:

- wallet connection
- AA creation / recovery
- session authorization
- x402 price and payment confirmation
- task and audit state
- capability state such as:
  - payment ready
  - job ready
  - migration required

### 2. Billing And Auth Must Be Decoupled

x402 can replace API keys as the billing primitive for paid user actions.

But x402 does not automatically replace every authentication role in the system.

KTrace still has three separate auth concerns:

1. User billing and paid access
2. Internal service-to-service trust
3. Third-party upstream provider credentials

Only the first one should be removed from user-facing API key flows.

### 3. V3 Is The Default User Account Line

KTrace should converge on one user account line:

- V3 for payments and jobs

V2 should become a migration/legacy line, not the long-term default.

### 4. Versioning Is Internal, Capabilities Are User-Facing

User-facing surfaces should not be built around literal version tags.

Frontend and CLI should prefer capability-oriented rendering:

- `sessionPayment`
- `sessionGenericExecute`
- migration required

Version strings such as `GokiteAccountV2-session-userop` or `GokiteAccountV3-session-execute` may still appear in advanced developer or debug views, but not as primary onboarding language.

## Recommended Target Architecture

### User-Facing AA

All new user accounts should be created from the V3 implementation.

Requirements:

- preserve owner `execute(...)`
- preserve payment-specific `executeTransferWithAuthorizationAndProvider(...)`
- add session-scoped generic `executeWithSession(...)`
- restrict session-generic execution by:
  - `sessionId`
  - `target`
  - `selector`
  - `maxAmount`

### Payment Path

User-visible paid actions should be:

- x402-first
- session-pay backed
- fully auditable

The payment path should continue to use the dedicated payment method because it is simpler and already aligned with spending rules:

- `executeTransferWithAuthorizationAndProvider(...)`

### Job Path

User-visible ERC-8183 job actions should use:

- `executeWithSession(...)`

This applies to:

- requester publish/fund actions
- provider submit actions
- evaluator complete/reject actions

### API Key Policy

API keys should be split into two categories:

1. User-facing API keys
2. Internal/system API keys

Policy:

- user-facing API keys: phase out from KTrace UX
- internal/system API keys: retain as backend implementation detail until internal auth is redesigned

## Recommendation

Use one user-facing account line only:

- all new KTrace AA wallets use V3
- KTrace UX no longer exposes API keys to end users
- x402 remains the public billing primitive
- V3 session permissions become the execution primitive for tasks

This is the recommended strategy because it minimizes mental overhead for users:

- one wallet model
- one session model
- one payment model
- one audit model

## Migration Plan

### Phase 0: Done

- V2 capability boundaries documented
- backend fail-fast for V2 job-lane execution
- V3 session-generic account implemented
- local official minimal ERC-8183 live proof completed on Kite testnet

Relevant files:

- [KTraceAccountV3SessionExecute.sol](/E:/CODEX/kite-trace-platform/backend/contracts/KTraceAccountV3SessionExecute.sol)
- [KTraceAccountFactory.sol](/E:/CODEX/kite-trace-platform/backend/contracts/KTraceAccountFactory.sol)
- [verify-official-erc8183-v3-proof.mjs](/E:/CODEX/kite-trace-platform/backend/scripts/verify-official-erc8183-v3-proof.mjs)

### Phase 1: Make V3 The Default AA Deployment

Change AA creation and deployment defaults so new KTrace users land on V3.

**Codex required changes:**

- default AA implementation env/config points to V3
- factory deploy and verification scripts understand V3 as the desired user implementation
- onboarding/session creation flows expect V3 by default
- runtime payloads expose the following fields (**already done as of 2026-03-20**):
  - `accountVersionTag`
  - `accountCapabilities.sessionPayment`
  - `accountCapabilities.sessionGenericExecute`
  - `requiredForJobLane`
- `createSession` ABI is unchanged in V3; no contract-side change needed for wizard Step 2 (**confirmed**)

**CC required changes** ✅ **Complete (2026-03-20)**

- ~~stop using exact version strings as the main UI branch condition~~ **Done.** Routing is now capability-driven (`accountCapabilities.sessionGenericExecute`).
- ~~branch primary wallet UX on capability flags~~ **Done.** All three flags wired into wizard routing and UI.
- ~~update UI copy throughout the wizard~~ **Done.** All V2/V3 labels removed from default flow.
- ~~rename `prepareFreshV2Wallet()` -> neutral naming~~ **Done.** Renamed to `prepareFreshWallet()`.
- ~~display capability badges in the wallet status card~~ **Done.** Payment Ready + Job Ready badges rendered.
- ~~update the `SessionRuntime` interface~~ **Done.** All three new fields typed and parsed in `parseRuntime()`.
- ~~if a version string is shown, keep it inside an advanced developer section only~~ **Done.**

Files changed:

- `agent-network/components/setup/SetupWizardClient.tsx`

Acceptance:

- ✅ wizard UI shows no V2/V3 labels in the default new user flow
- ✅ capability badges appear when `accountCapabilities` is present in runtime
- ✅ `requiresNewWallet` replaces `requiresV2Upgrade` as the gating condition
- ✅ fresh V3 wallet end-to-end proof completed on 2026-03-20

### Phase 2: Prove V3 Payment And Audit Compatibility

Run a fresh KTrace user-facing payment proof on V3.

**Codex status:** complete on 2026-03-20.

**Codex completed proof:**

- `ktrace buy request`
- x402 challenge
- session pay
- service execution
- `ktrace artifact receipt`
- `ktrace artifact evidence`

**CC required changes:** ✅ **Complete (2026-03-20)**

- ~~confirm `JobAuditView.tsx` renders evidence and receipt payloads from V3 without layout breakage~~ **Done.** Existing V2/owner-sign shapes render unchanged; V3 fields render in new execution metadata block.
- ~~if V3 evidence adds new fields, surface them in audit view~~ **Done.** `executionMode` and `aaMethod` rendered in "Contract Primitive Status" section.
- ~~no API key prompt in buy -> receipt flow~~ **Done.** No API key prompt exists anywhere in the audit or receipt view.

Files verified:

- `agent-network/components/jobs/JobAuditView.tsx` ✅

Note: `AuditExplorer.tsx` did not require changes — V3 payloads are compatible with existing shape.

Acceptance:

- ✅ evidence and receipt shapes remain compatible
- ✅ frontend audit views display V3 execution metadata correctly
- ✅ no API key prompt in default flow
- ✅ full live V3 job audit proof completed on 2026-03-20

### Phase 3: Route KTrace Job Lane To V3 Only

Move the normal KTrace job lane onto V3 session-generic execution.

**Codex status:** complete on 2026-03-20.

**Codex completed proof:**

- requester `create -> fund`
- executor `accept -> submit`
- validator `validate`
- live records persisted with `executionMode = aa-session-generic`
- managed executor/validator runtimes bootstrapped onto V3 AA wallets with session-generic execution

**Codex required behavior:**

- requester job actions use `executeWithSession(...)`
- provider job actions use `executeWithSession(...)`
- evaluator job actions use `executeWithSession(...)`
- permission bundles are explicit and auditable

**CC required changes:** ✅ **Complete (2026-03-20)**

- ~~`JobAuditView.tsx`: surface `executionMode` and `aaMethod` fields~~ **Done.** Both fields rendered in the Contract Primitive Status section as labelled `<code>` rows; shown only when non-empty.
- `ApprovalsInboxClient.tsx` / `ApprovalPageClient.tsx`: no code changes needed — confirmed no V3-specific session fields in approval payloads at this stage.
- `AuthorityPanelClient.tsx`: no code changes needed — V3 session fields do not appear in per-job authority panel rows at this stage.

Files changed:

- `agent-network/components/jobs/JobAuditView.tsx` ✅

Acceptance:

- ✅ `executionMode` and `aaMethod` render visibly in audit view when present
- ✅ legacy records with no execution metadata show no empty rows
- ✅ live end-to-end job-lane records with `executionMode = aa-session-generic` completed on 2026-03-20

### Phase 4: Remove User-Facing API Key UX

Once V3 payment and job flows are proven:

**Codex required changes:**

- stop asking users for API keys in normal KTrace onboarding CLI
- hide API key setup from default CLI happy path
- keep API keys as internal/admin compatibility tooling only

**Claude Desktop / agent connector model chosen:**

- wallet/session-first connection model
- API key is not the default Claude Desktop connection method
- API key may remain in an advanced developer compatibility section only
- the same setup surface should leave room for `Use KTrace CLI`, `Connect Claude`, and `Connect Another Agent`

**CC required changes:** ✅ **Complete (2026-03-20)**

Wizard step layout after this phase (implemented):
- Step 0: Connect Wallet
- Step 1: Fund AA Wallet
- Step 2: Authorize Session
- Step 3: **Setup Complete / Connect** — wallet/session-first, no API key prompt by default

Concrete changes implemented:
- ~~remove API key generation from the default `ConnectStep4` display~~ **Done.** API key generation not shown by default.
- ~~keep "Advanced / Developer Setup" collapsed by default~~ **Done.** Collapsed accordion within the Connect Claude card.
- ~~hero subtext "get your API key for Claude Desktop" -> "connect your client"~~ **Done.**
- ~~routing to step 3 label/intent updated~~ **Done.** Returns to "Setup Complete / Connect" intent.
- ~~add wallet/session-first access guidance~~ **Done.** Three cards implemented:
  1. **Use KTrace CLI** — session-first CLI setup
  2. **Connect Claude** — wallet-first Claude Desktop/Claude.ai; API key under collapsed "Advanced / Developer Setup"
  3. **Connect Another Agent** — generic agent via MCP connector token

Files changed:

- `agent-network/components/setup/SetupWizardClient.tsx` ✅

Acceptance:

- ✅ a new user completing the wizard never sees an API key prompt in the default path
- ✅ API key access remains available under collapsed "Advanced / Developer Setup"
- ✅ Claude Desktop connection guidance is wallet/session-first
- ✅ three client entry points (CLI, Claude, Another Agent) are available from Step 3

### Phase 5: Legacy V2 Handling

Do not keep V2 as a first-class long-term user experience.

**Codex recommended policy:**

- V2 stays readable and migratable
- V2 may continue to serve legacy payment-only flows during migration
- V2 should not remain the default account line

**CC required changes:** ✅ **Complete (2026-03-20)**

No migration UX implemented — as specified. All implementation follows the no-migration policy.

- ~~unsupported-account notice: "Your wallet is not supported. Create a new wallet below."~~ **Done.** Rendered as `ErrorBanner` when both capability flags are false.
- ~~single CTA: "Create New Wallet"~~ **Done.** Launches fresh Step 1 onboarding.
- ~~no "Upgrade Wallet", "Keep Payment-Only Wallet", or proxy upgrade language~~ **Done.** None present.
- ~~no legacy address reuse logic~~ **Done.** Not implemented.

Files changed:

- `agent-network/components/setup/SetupWizardClient.tsx` ✅

## API Key Decision

### What Should Disappear From User Experience

These should disappear from the normal KTrace user surface:

- account API key creation
- manual `x-api-key` copy/paste
- API key as a prerequisite for paid capability use
- API key as a prerequisite for ERC-8183 task use

### What May Still Remain Internally

These can remain temporarily without violating the product goal:

- internal loopback service auth
- admin/operator API keys
- upstream provider API keys for external vendors

Examples in current code:

- [auth.js](/E:/CODEX/kite-trace-platform/backend/lib/auth.js)
- [sessionPay.js](/E:/CODEX/kite-trace-platform/backend/lib/sessionPay.js)
- [onboardingSetupHelpers.js](/E:/CODEX/kite-trace-platform/backend/lib/onboardingSetupHelpers.js)
- [externalFeeds.js](/E:/CODEX/kite-trace-platform/backend/lib/externalFeeds.js)

Product interpretation:

- API key can disappear from user UX before it disappears from the whole backend
- KTrace should not promise zero API keys internally during this migration

## x402 Design Position

KTrace does not need a full redesign because of x402.

What does need to change:

- billing should become x402-first on user-facing paid routes
- user-facing access should become wallet/session-first
- API key should no longer be the main UX object

What does not need immediate redesign:

- internal service authentication
- third-party provider credential storage
- all existing evidence and receipt surfaces

Short version:

- do not redesign KTrace around "no auth" - redesign KTrace around "billing is x402, user auth is wallet/session, internal trust is separate" - do not force API key concepts into the default Claude Desktop connection flow

## Standardization Position

For KTrace, the practical standards stance should be:

- keep ERC-4337 as the execution rail
- shape session-generic permissions in the spirit of modular smart account policy systems
- keep future room for delegation-oriented permission UX

This means:

- no need to abandon ERC-4337
- no need to wait for a single session-key standard to be final
- build the product around a permissioned V3 session model that can later map more cleanly to modular or delegation standards

## Open Design Questions

These questions remain worth discussing before product hardening:

1. Should KTrace mint fresh V3 wallets for all new users immediately, or gate by feature flag first?
2. ~~Should legacy V2 users be migrated in-place through proxy upgrade, or invited to create fresh V3 accounts?~~ **Resolved: no migration. All users create fresh V3 wallets on launch.**
3. Should KTrace job permissions be granted as:
   - a reusable "task capability bundle"
   - or per-job narrow permissions
4. Which internal API key surfaces should be replaced first after user-facing API keys disappear?

**CC-specific open questions:**

5. Should the wizard Step 1 ("Fund AA Wallet") remain unchanged for V3, or does V3 change the minimum funding requirements? _(pending Codex confirmation — Step 1 unchanged in current implementation)_
6. ~~What exact wallet/session-first client connection copy should replace the old API-key-first explanation?~~ **Resolved: Step 3 redesign implemented with three entry points (KTrace CLI / Connect Claude / Connect Another Agent). Copy is in production.**
7. ~~For capability-driven migration UX, what is the best user-facing wording for upgrade recommended?~~ **Resolved: no migration UX needed.**
8. ~~If backend later chooses between in-place upgrade and fresh-address replacement, where should an address-change warning appear?~~ **Resolved: no address-change UX. Fresh wallet only.**

## Recommended Next Actions

### Codex
1. ~~Confirm that V3 keeps the existing `createSession` ABI.~~ **Confirmed: ABI unchanged (line 195). No action needed.**
2. ~~Ensure runtime payloads expose `accountCapabilities`.~~ **Done: `accountVersionTag`, `accountCapabilities.sessionPayment`, `accountCapabilities.sessionGenericExecute`, `requiredForJobLane` already output.**
3. ~~Change default AA deployment for new users to V3.~~ **Done in backend default provisioning path.**
4. ~~Run one fresh V3 `ktrace buy request -> x402 -> receipt/evidence` proof.~~ **Done on 2026-03-20.**
5. ~~Move KTrace normal job-lane execution to V3 session-generic execution.~~ **Done on 2026-03-20.**
6. ~~Remove user-facing API key dependence from the normal CLI/config path.~~ **Done on 2026-03-20.**
7. ~~Keep internal/admin API keys as temporary implementation detail until a later internal auth cleanup.~~ **Done for user-facing setup/connector surfaces on 2026-03-20. Internal/admin/provider keys remain backend-only compatibility.**
8. ~~Define the backend-supported wallet/session-first Claude Desktop connection path before removing any compatibility copy.~~ **Done: session-first connector bootstrap/status/revoke routes are live, with MCP connector-token-first auth and env-key compatibility fallback for backend verifier/dev harness paths.**

### CC
1. ~~Replace version-driven wizard logic with capability-driven wallet UX in `SetupWizardClient.tsx`~~ **Done (Phase 1).**
2. ~~Strip all user-facing `V2/V3` labels from default wizard UI copy~~ **Done (Phase 1).**
3. ~~Add `accountCapabilities` + `requiredForJobLane` display to the wallet status card~~ **Done (Phase 1).**
4. ~~Verify `JobAuditView.tsx` renders V3 evidence fields without breakage~~ **Done (Phase 2).**
5. ~~Surface `executionMode` / `aaMethod` in job audit views~~ **Done (Phase 3).**
6. ~~Restructure Step 3 to `Setup Complete / Connect` with API key in collapsed Advanced section~~ **Done (Phase 4).**
7. ~~Implement capability-based migration notice with "Upgrade Wallet" / "Keep Payment-Only Wallet" CTAs.~~ **Removed: no migration UX. "Create New Wallet" only for unsupported accounts — Done (Phase 5).**

**CC has no remaining blocking frontend tasks.** All CC work is complete. The planned backend migration items in this document are now complete.

## What CC Can Start Now

✅ **All CC frontend tracks are complete as of 2026-03-20.**

Summary of what was completed:

1. **Phase 1 wallet status + setup logic** ✅
   - capability-driven wizard logic in `SetupWizardClient.tsx`
   - default V2/V3 labels removed
   - `accountCapabilities` + `requiredForJobLane` displayed in wallet status card

2. **Phase 2 audit compatibility** ✅
   - `JobAuditView.tsx` verified against V3 receipt/evidence payload shapes
   - no default API key prompt in buy -> receipt path

3. **Phase 3 job audit execution metadata** ✅
   - `executionMode` and `aaMethod` rendered in `JobAuditView.tsx`

4. **Phase 4 setup Step 3 redesign** ✅
   - Step 3 restructured as `Setup Complete / Connect`
   - `Use KTrace CLI`, `Connect Claude`, `Connect Another Agent` entry points implemented
   - API key gated under collapsed `Advanced / Developer Setup`

5. **Phase 5 unsupported account handling** ✅
   - "Create New Wallet" only; no migration UX

**CC is now unblocked.** Backend Phase 3, Phase 4 CLI/API-key cleanup, Phase 6 internal auth cleanup, and connector/session-first follow-through are complete.
