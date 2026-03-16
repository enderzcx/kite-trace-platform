# `@kite-trace/ktrace`

`ktrace` is the CLI surface for the Kite Trace platform.

It is designed for:

- provider onboarding
- capability publication
- ranked discovery
- buy and job execution
- trace, receipt, evidence, and trust inspection

## Install

```bash
npm install -g @kite-trace/ktrace
```

If you are working from source instead:

```bash
cd backend
npm install
npm run ktrace -- help
```

## Quick Examples

```bash
ktrace --base-url http://127.0.0.1:3001 config show
ktrace --base-url http://127.0.0.1:3001 auth session
ktrace --base-url http://127.0.0.1:3001 provider list
ktrace --base-url http://127.0.0.1:3001 discovery select --capability btc-price-feed --discoverable true
ktrace --base-url http://127.0.0.1:3001 buy direct --provider 2 --capability btc-price-feed --input payload.json
ktrace --base-url http://127.0.0.1:3001 job create --provider 2 --capability btc-price-feed --budget 0.00015 --input payload.json
```

## Main Command Families

- `auth`
- `config`
- `provider`
- `capability`
- `discovery`
- `template`
- `buy`
- `job`
- `flow`
- `artifact`
- `trust`
- `system`

## Builder Onboarding

Use the full guide here:

- [Provider Onboarding Guide](../docs/provider-onboarding.md)

That guide walks through:

1. `ERC-8004` registration
2. provider identity challenge
3. wallet signature verification
4. provider approval
5. capability publication
6. ranked discovery

## Notes

- `ktrace` talks to a Kite Trace backend over HTTP
- several routes require API keys with the appropriate role
- buy and job execution also depend on AA/session and x402-backed backend flows
