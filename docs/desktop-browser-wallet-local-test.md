# Desktop Browser Wallet Local Test

This is the recommended first-pass local test for the agent-first approval flow. It does not require WalletConnect.

## Services

Start these two local services:

```powershell
cd E:\CODEX\kite-trace-platform\backend
npm run start:one
```

```powershell
cd E:\CODEX\kite-trace-platform\agent-network
npm run start
```

Expected local URLs:

- Backend: `http://127.0.0.1:3399`
- Frontend: `http://127.0.0.1:3000`

## Browser Setup

Use Chrome, Brave, or Edge with a wallet extension installed.

Recommended extensions:

- MetaMask
- OKX Wallet

The extension wallet must control the same EOA that the approval request targets.

## Create An Approval Request

Run this from the backend directory:

```powershell
cd E:\CODEX\kite-trace-platform\backend
npm run ktrace -- --base-url http://127.0.0.1:3399 --session-strategy external session request --eoa 0xYOUR_EOA --single-limit 1 --daily-limit 5
```

If your local profile already has auth saved, this returns:

- `approvalRequestId`
- `approvalUrl`
- `qrText`

Open the `approvalUrl` in the same browser where the wallet extension is installed.

## Complete Approval In The Browser

On the approval page:

1. Verify the target `User EOA`
2. Click `Desktop Browser Wallet`
3. Approve the wallet connection
4. Approve Kite Testnet network add/switch if requested
5. Click `Approve Session`
6. Confirm AA deployment if the account does not exist yet
7. Confirm session creation
8. Confirm the final signature

Success state on the page should show:

- `Approval Complete`
- `AA Wallet`
- `Session Address`
- `Session Id`
- `Agent Next Command`

## Finish On The Agent Side

Run the command shown on the success page:

```powershell
ktrace session wait <approvalRequestId> --token <approvalToken>
```

This syncs the completed local session runtime so the agent can use it for local AA session pay.

## Common Issues

- No wallet found in browser:
  Install or enable the extension, then refresh the page.

- Wrong wallet address:
  Switch the extension account to the `User EOA` shown on the approval page.

- WalletConnect confusion:
  Ignore it for this test. The desktop extension path does not require a WalletConnect project id.

- Backend link opens but page fails:
  Confirm backend is on `3399` and frontend is on `3000`.
