# Full-Stack AA Frontend Handoff

Updated: 2026-03-18
Audience: CC / frontend
Status: active

## Read This First

Frontend source of truth:

- [ktrace-full-stack-aa-plan.md](/E:/CODEX/kite-trace-platform/docs/ktrace-full-stack-aa-plan.md)

## What Changed

Kite Trace now treats AA as the canonical execution identity.

Use these rules in UI:

- owner EOA:
  - setup
  - session grant
  - session revoke
  - recovery
- AA account:
  - payment
  - MCP execution
  - job funding
  - job accept / submit / validate

Do not present owner EOA as the normal requester / executor / validator in product execution UI.

## UI Mapping Rules

### Setup

- wallet connection and authorization screens may show owner EOA
- generated runtime / account key screens should emphasize the resulting AA wallet and MCP key

### MCP

- MCP onboarding UI should describe account API key + AA runtime
- do not imply that MCP paid calls execute from owner EOA

### Jobs and Demo

For job cards, audit pages, and `/demo`:

- `payer` / `requester` display: AA address
- `executor` display: AA address
- `validator` display: AA address
- `executionMode` label: `aa_account_role_enforced`

### Public Audit

Prefer these fields:

- `audit.requester`
- `audit.executor`
- `audit.validator`
- `audit.contractPrimitives.roleEnforcement.executionMode`
- `audit.contractPrimitives.roleEnforcement.roleRuntimeSummary`

Ignore legacy signer wording in old records unless you are explicitly rendering historical compatibility data.

## Current Backend Fields

AA-native job views now expose:

- `executionMode`
- `requesterRuntimeAddress`
- `executorRuntimeAddress`
- `validatorRuntimeAddress`

Public audit now exposes:

- `contractPrimitives.roleEnforcement.executionMode`
- `contractPrimitives.roleEnforcement.roleRuntimeSummary`

## Copy Guidance

Preferred:

- "consumer AA wallet"
- "executor AA wallet"
- "validator AA wallet"
- "owner EOA (authorization only)"

Avoid:

- "requester signer"
- "executor owner signer"
- "validator owner signer"
- "backend signer funded this job"
