import { readFile } from 'node:fs/promises';
import { listCommandFamilies } from '../commandCatalog.js';
import { createEnvelope, maskApiKey } from '../output.js';

export async function readPackageVersion() {
  const packageJsonPath = new URL('../../package.json', import.meta.url);
  const raw = await readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  return String(parsed?.version || '0.0.0');
}

export function buildHelpText(version = '0.0.0') {
  const familyLines = listCommandFamilies().map(
    (family) => `  ${family.family.padEnd(8)} ${family.description} (${family.actions.join(', ')})`
  );
  return `
ktrace ${version}

Usage:
  ktrace <family> <action> [command-options]

Families:
${familyLines.join('\n')}

Global flags:
  --json                 Output the standard JSON envelope
  --profile <name>       Select a named local profile
  --base-url <url>       Override backend base URL
  --wallet <address>     Override wallet identity hint
  --chain <name>         Override chain label
  --session-strategy <managed|external>
                         Control whether ktrace may create/renew backend sessions
  --api-key <key>        Override transport auth key
  --config <path>        Override local config file path
  -h, --help             Show help
  -v, --version          Show version

Implemented:
  config show            Inspect resolved runtime config
  auth login             Save wallet/baseUrl/apiKey locally and verify backend auth
  auth whoami            Show backend auth role and current AA session readiness
  auth session           Ensure AA wallet + session runtime on the backend
  session authorize      Record a user EOA grant for backend-managed session execution
  buy request            Resolve a service and invoke the negotiated-buy lane
  buy direct             Buy from a published template without renegotiation (capability id or action)
  template list          List reusable templates
  template resolve       Resolve the active template for a provider/capability pair
  template show          Show template detail
  template publish       Create or update a reusable template
  template revoke        Mark a template inactive
  template activate      Mark a template active
  template expire        Mark a template expired immediately
  provider list          List versioned provider records
  provider register      Create or update a versioned provider record
  provider show          Show provider detail
  provider identity-challenge
                         Request a public identity-verification challenge for provider onboarding
  provider register-identity
                         Register a provider using an ERC-8004 challenge signature
  provider import-identity
                         Create or update a provider from an ERC-8004 identity
  provider approve       Approve a provider for discovery
  provider suspend       Suspend a provider from discovery
  capability list        List versioned capability records
  capability publish     Create or update a versioned capability record
  capability show        Show capability detail
  discovery select       Return ranked provider-capability candidates
  discovery compare      Compare ranked provider-capability candidates
  discovery recommend-buy
                         Return the top direct-buy-ready candidate with an active template
  job create             Create a minimal ERC-8183-aware job record
  job fund               Mark a job funded after AA session preflight
  job submit             Submit a funded job into the backend service lane
  job show               Inspect a job lane record
  job complete           Mark a funded/submitted job completed with evaluator output
  job reject             Reject a funded/submitted job with evaluator output
  job expire             Expire a non-terminal job
  flow status            Show a short trace-first workflow summary
  flow show              Show workflow detail, audit timeline, receipt, and evidence refs
  flow history           List prior service-backed flow runs
  artifact receipt       Retrieve a receipt by trace/request reference
  artifact evidence      Retrieve evidence by trace/request reference
  evidence get           Retrieve public evidence by trace id without platform auth
  trust reputation       Inspect accumulated trust signals by agent or lane
  trust validations      Inspect validation/evaluator records
  trust publish          Prepare a trust publication record for a future registry anchor
  trust publications     List trust publication records and statuses
  system start-fresh     Kill stale listeners on a target port and launch a fresh backend process

Examples:
  ktrace --base-url http://127.0.0.1:3102 auth session
  ktrace --base-url http://127.0.0.1:3102 session authorize --eoa 0x1234...abcd --single-limit 7 --daily-limit 21
  ktrace --base-url http://127.0.0.1:3102 provider list --role provider --verified true --q external
  ktrace --base-url http://127.0.0.1:3102 provider identity-challenge --input data/provider-identity-challenge.json
  ktrace --base-url http://127.0.0.1:3102 provider register-identity --input data/provider-register-identity.json
  ktrace --base-url http://127.0.0.1:3102 provider import-identity --input data/provider-import.json
  ktrace --base-url http://127.0.0.1:3102 provider approve external-agent
  ktrace --base-url http://127.0.0.1:3102 capability list --provider price-agent
  ktrace --base-url http://127.0.0.1:3102 capability list --provider-discoverable true --q external
  ktrace --base-url http://127.0.0.1:3102 discovery select --capability cap-listing-alert --discoverable true
  ktrace --base-url http://127.0.0.1:3102 discovery compare --capability cap-listing-alert --discoverable true --limit 3
  ktrace --base-url http://127.0.0.1:3102 discovery recommend-buy --capability cap-listing-alert --discoverable true
  ktrace --base-url http://127.0.0.1:3102 evidence get trace_demo_123 --public
  ktrace --base-url http://127.0.0.1:3102 buy request --provider fundamental-agent-real --capability cap-listing-alert --input data/ktrace-job-input.json
  ktrace --base-url http://127.0.0.1:3102 template list --active true
  ktrace --base-url http://127.0.0.1:3102 template resolve --provider fundamental-agent-real --capability cap-listing-alert
  ktrace --base-url http://127.0.0.1:3102 buy direct --provider fundamental-agent-real --capability cap-listing-alert --input data/ktrace-job-input.json
  ktrace --base-url http://127.0.0.1:3102 job create --provider 2 --capability btc-price-feed --budget 0.00015 --expires-at 2026-03-16T12:00:00Z --input data/ktrace-job-input.json
  ktrace --base-url http://127.0.0.1:3102 --session-strategy external job submit <job-id> --input data/ktrace-job-input.json
  ktrace --base-url http://127.0.0.1:3102 job reject <job-id> --input '{\"reason\":\"quality check failed\",\"evaluator\":\"risk-agent\"}'
  ktrace --base-url http://127.0.0.1:3102 trust reputation --agent price-agent
  ktrace --base-url http://127.0.0.1:3102 trust publish --input data/trust-publication.json
  ktrace system start-fresh --port 3399 --dry-run
`;
}

export function buildDisplayName(family = '', action = '') {
  return ['ktrace', family, action].filter(Boolean).join(' ');
}

export function createHelpEnvelope(runtime, helpText) {
  return createEnvelope({
    ok: true,
    exitCode: 0,
    command: { kind: 'help', display: 'ktrace help' },
    runtime,
    data: { helpText },
    message: 'ktrace CLI is ready.'
  });
}

export function createVersionEnvelope(version, runtime) {
  return createEnvelope({
    ok: true,
    exitCode: 0,
    command: { kind: 'version', display: 'ktrace --version' },
    runtime,
    data: { version },
    message: version
  });
}

export function createConfigEnvelope(runtimeBundle) {
  const { config, meta } = runtimeBundle;
  return createEnvelope({
    ok: true,
    exitCode: 0,
    command: { family: 'config', action: 'show', display: 'ktrace config show' },
    runtime: config,
    data: {
      config: {
        profile: config.profile,
        baseUrl: config.baseUrl,
        chain: config.chain,
        walletAddress: config.wallet,
        defaultOutputMode: config.outputMode,
        authMode: config.authMode,
        sessionMode: config.sessionMode,
        sessionStrategy: config.sessionStrategy,
        apiKeyConfigured: config.apiKeyConfigured,
        apiKeyMasked: maskApiKey(config.apiKey)
      },
      meta
    }
  });
}

export function createNotImplementedEnvelope(commandMeta, runtime) {
  const display = buildDisplayName(commandMeta.family, commandMeta.action);
  return createEnvelope({
    ok: false,
    exitCode: 2,
    command: {
      family: commandMeta.family,
      action: commandMeta.action,
      display
    },
    runtime,
    error: 'not_implemented',
    message: `${display} is reserved for ${commandMeta.batch}.`
  });
}
