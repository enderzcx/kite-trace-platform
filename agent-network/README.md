This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, create an env file if you want the approval page and backend proxy to resolve correctly:

```bash
cp .env.example .env.local
```

Important vars:

- `NEXT_PUBLIC_BACKEND_URL`: backend base URL, for example `http://127.0.0.1:3399`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: enables WalletConnect QR on `/approval/[approvalRequestId]`

## Local Desktop Wallet Approval

For the first local pass, do not use WalletConnect. Open the approval page on the same desktop browser where your
wallet extension is installed.

Recommended flow:

1. Start the backend on `http://127.0.0.1:3399`
2. Start the frontend on `http://127.0.0.1:3000`
3. Generate an approval request from the CLI:

```bash
cd ../backend
npm run ktrace -- --base-url http://127.0.0.1:3399 --session-strategy external session request --eoa 0xYOUR_EOA --single-limit 1 --daily-limit 5
```

4. Open the returned `approvalUrl` in Chrome, Brave, or Edge
5. Click `Desktop Browser Wallet`
6. Switch the extension wallet to the target EOA shown on the page
7. Click `Approve Session`
8. Back in the agent terminal, run the `ktrace session wait ... --token ...` command shown after approval

WalletConnect is optional and only needed later if you want a phone-wallet QR path.

Then run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
