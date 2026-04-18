/**
 * Test script: simulate a real x402 payment using the backend SDK locally.
 * Uses the same session key as the local signing proxy.
 */
import { ethers } from 'ethers';
import { GokiteAASDK } from './backend/lib/gokite-aa-sdk.js';

const SESSION_PRIVATE_KEY = '0x34f3fd4d65141e126fd399c452221eafcb8d5e9852f7ac5e7955397e0d02b321';
const AA_WALLET = '0xbb090aa089d7564449ff3e7961b3529ee561f807';
const SESSION_ID = '0x8a523687b292e25983ddb21f2823f6208d10a7a2d5ed8f6742b8499e9821ebbb';
const OWNER_EOA = '0x0309dc91bB89750C317Ec69566bAF1613b57e6bB';

const RPC_URL = 'https://rpc-testnet.gokite.ai/';
const BUNDLER_URL = 'https://bundler-service.staging.gokite.ai/rpc/';
const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const AA_FACTORY = '0xAba80c4c8748c114Ba8b61cda3b0112333C3b96E';
const AA_IMPLEMENTATION = '0xF7681F4f70a2F2d114D03e6B93189cb549B8A503';

const TOKEN_ADDRESS = '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const RECIPIENT = '0x4724f75bde8576f29f23b6b8a19fa52cc60c58f2';
const AMOUNT = '0.00015';

async function main() {
  const sessionWallet = new ethers.Wallet(SESSION_PRIVATE_KEY);
  console.log('Session signer:', sessionWallet.address);

  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRY_POINT,
    accountFactoryAddress: AA_FACTORY,
    accountImplementationAddress: AA_IMPLEMENTATION,
    proxyAddress: AA_WALLET,
    bundlerRpcTimeoutMs: 35000,
    bundlerRpcRetries: 3
  });
  sdk.config.ownerAddress = OWNER_EOA;

  // Step 1: Build auth payload
  const amountRaw = ethers.parseUnits(AMOUNT, 18);
  const nowSec = Math.floor(Date.now() / 1000);
  const authPayload = {
    from: AA_WALLET,
    to: RECIPIENT,
    token: TOKEN_ADDRESS,
    value: amountRaw,
    validAfter: BigInt(Math.max(0, nowSec - 30)),
    validBefore: BigInt(nowSec + 10 * 60),
    nonce: ethers.hexlify(ethers.randomBytes(32))
  };
  console.log('Auth payload:', JSON.stringify(authPayload, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  // Step 2: EIP-712 sign
  const authSignature = await sdk.buildTransferAuthorizationSignature(sessionWallet, authPayload);
  console.log('Auth signature:', authSignature);

  // Step 3: Build serviceProvider
  const serviceProvider = ethers.keccak256(ethers.toUtf8Bytes(`x402_payment:requester:${TOKEN_ADDRESS}`));

  // Step 4: Sign function for UserOp
  const signFunction = async (userOpHash) => {
    console.log('Signing userOpHash:', userOpHash);
    return sessionWallet.signMessage(ethers.getBytes(userOpHash));
  };

  // Step 5: Send
  console.log('Sending payment...');
  const result = await sdk.sendSessionTransferWithAuthorizationAndProvider(
    {
      sessionId: SESSION_ID,
      auth: authPayload,
      authSignature,
      serviceProvider,
      metadata: '0x'
    },
    signFunction,
    {
      callGasLimit: 320000n,
      verificationGasLimit: 450000n,
      preVerificationGas: 120000n
    }
  );

  console.log('Result:', JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
