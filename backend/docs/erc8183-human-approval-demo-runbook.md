# ERC-8183 Human Approval Demo Runbook

Updated: 2026-03-18

## Goal

Show the two job-funding paths side by side:

1. Small job
- funds directly inside the authorized session scope

2. Large job
- pauses at `pending_approval`
- resumes after human approval

This runbook assumes:

- backend is already running
- the operator has a usable session/runtime
- `KTRACE_JOB_APPROVAL_THRESHOLD` is configured
- optional:
  - `KTRACE_AUTO_JOB_EXPIRY_ENABLED=1`
  - `KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS=30000`

## Suggested Demo Setup

Use a threshold lower than the "large" job and higher than the "small" job.

Example:

- `KTRACE_JOB_APPROVAL_THRESHOLD=0.001`

Then use:

- small job budget: `0.00015`
- large job budget: `0.01`

## 1. Verify session readiness

```powershell
cd backend
npm run ktrace -- --json auth whoami
npm run ktrace -- --json auth session
```

Optional:

```powershell
npm run ktrace -- --json session authorize --eoa <owner-eoa> --single-limit 7 --daily-limit 21 --allowed-capabilities btc-price-feed
```

## 2. Small job path

Create:

```powershell
npm run ktrace -- --json job create --provider fundamental-agent-real --capability btc-price-feed --budget 0.00015 --executor 0xExecutor --validator 0xValidator --escrow-amount 0.00015 --input data/ktrace-job-input.json
```

Fund:

```powershell
npm run ktrace -- --json job fund <small-job-id>
```

Expected:

- `state = funded`
- no approval URL

Continue:

```powershell
npm run ktrace -- --json job accept <small-job-id>
npm run ktrace -- --json --session-strategy external job submit <small-job-id> --input data/ktrace-job-input.json
npm run ktrace -- --json job validate <small-job-id> --approve
```

Audit:

```powershell
npm run ktrace -- --json job audit <small-job-id>
npm run ktrace -- --json job audit <small-job-id> --public
npm run ktrace -- --json job show <small-job-id>
```

## 3. Large job path

Create:

```powershell
npm run ktrace -- --json job create --provider fundamental-agent-real --capability btc-price-feed --budget 0.01 --executor 0xExecutor --validator 0xValidator --escrow-amount 0.01 --input data/ktrace-job-input.json
```

Fund:

```powershell
npm run ktrace -- --json job fund <large-job-id>
```

Expected:

- `state = pending_approval`
- `approvalId` present
- `approvalUrl` present
- `approvalExpiresAt` present

Review:

```powershell
npm run ktrace -- --json job audit <large-job-id>
```

Approve from operator flow:

- open the returned `approvalUrl`
- or call the approval API from an authenticated operator surface

After approval, confirm resume:

```powershell
npm run ktrace -- --json job show <large-job-id>
npm run ktrace -- --json job audit <large-job-id>
npm run ktrace -- --json job audit <large-job-id> --public
```

Expected:

- `state = funded`
- approval state no longer pending

Continue:

```powershell
npm run ktrace -- --json job accept <large-job-id>
npm run ktrace -- --json --session-strategy external job submit <large-job-id> --input data/ktrace-job-input.json
npm run ktrace -- --json job validate <large-job-id> --approve
```

## 4. Evidence / receipt checks

Once submit and validate are complete:

```powershell
npm run ktrace -- --json job show <job-id>
npm run ktrace -- --json artifact receipt <job-id>
npm run ktrace -- --json artifact evidence <job-id>
npm run ktrace -- --json evidence get <trace-id> --public
```

Look for:

- `authorizationId`
- `authorizedBy`
- `authorizationMode`
- `approvalState`
- `approvalDecidedBy`
- `approvalPolicy.threshold`
- `approvalPolicy.ttlMs`
- `deadline.onchainEnforced = true`
- `contractPrimitives.roleEnforcement.onchainEnforced = true`
- `contractPrimitives.staking.present`
- `contractPrimitives.slashing.present`
- `deliveryStandard.satisfied = true`
- `resultHash`
- lifecycle anchor tx hashes
- escrow tx hashes

## 5. Role signer preparation

Before demoing escrow-backed jobs with onchain role enforcement enabled, ensure the role signers have settlement-token allowance:

```powershell
cd backend
npm run erc8183:approve:escrow
```

Expected:

- output contains an `approvals` array
- requester allowance is prepared
- executor allowance is also prepared when executor stake is enabled

## 6. Optional deadline watcher check

When auto expiry is enabled, backend health now exposes watcher state:

```powershell
curl http://127.0.0.1:3001/api/public/health
```

Look for:

- `autoJobExpiry.enabled`
- `autoJobExpiry.intervalMs`
- `autoJobExpiry.lastStatus`

## 7. Approval rejection variant

Create another large job and fund it until it pauses, then reject instead of approve.

Expected:

- job enters `approval_rejected`
- audit view shows:
  - `approvalState = rejected`
  - decision note if provided

## 8. Recommended demo order

1. Show session is authorized
2. Run a small job to show automatic flow
3. Run a large job to show `pending_approval`
4. Open approval page
5. Resume and finish the job
6. Show `job audit`
7. Show receipt + evidence
