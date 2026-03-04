# AGENTS.md

## Scope

These instructions apply to all work under `G:\KKK\KITE GASLESS`.

## Default Goal

- Build an agent-network demo using local Ollama models:
  - `qwen3.5:2b`
  - `qwen3.5:4b`
  - `qwen3.5:9b`
- Keep model-to-service mapping configurable because final role assignment is still under discussion.
- Prefer small, safe, incremental implementation slices.

## Communication Style

- Default to concise Chinese responses unless the user requests another language.
- Provide short progress updates during exploration and edits.
- If user says `continue` / `split it` / `next step`, continue with the next smallest safe slice automatically.
- Avoid long theory unless explicitly requested.

## Files To Read First

1. `backend/server.js`
2. `backend/app.js`
3. `backend/services/*.js` (provider/model adapter and orchestration related)
4. `backend/routes/*.js` (runtime/task dispatch related)
5. `backend/.env` and `backend/.env.example` (model/provider config)
6. `backend/package.json`

## Demo Build Strategy

- Keep a pluggable role map, for example `planner/analyst/executor`, and bind each role to a model via config.
- Do not hardcode one fixed model assignment until user confirms the mapping.
- Build vertical slices: provider wiring -> role routing -> task execution -> observable logs.
- Keep call signatures stable while adding model selection support.

## Validation Baseline

Run from `G:\KKK\KITE GASLESS` after meaningful edits:

- `ollama list`
- `ollama show qwen3.5:2b`
- `ollama show qwen3.5:4b`
- `ollama show qwen3.5:9b`
- `node --check backend/app.js`
- `node --check <each touched helper file>`
- `node -e "import('file:///G:/KKK/KITE%20GASLESS/backend/app.js').then(()=>console.log('import-ok')).catch((e)=>{console.error(e);process.exit(1)})"`
- `node -e "import('file:///G:/KKK/KITE%20GASLESS/backend/app.js').then(async (m)=>{await m.startServer(); await new Promise(r=>setTimeout(r,1200)); await m.shutdownServer(); console.log('smoke-ok');}).catch((e)=>{console.error(e);process.exit(1);})"`

## Safety Guardrails

- Never use destructive git commands (for example: `reset --hard`, `checkout --`), unless explicitly requested.
- Never revert unrelated dirty changes.
- Treat `backend/data/*.json` changes as runtime artifacts unless user asks to manage them.
- Keep edits localized and reversible.

## Completion Criteria Per Slice

- Targeted demo capability is implemented (model routing, agent handoff, or execution path).
- Required checks pass.
- Next smallest demo slice is identified.
