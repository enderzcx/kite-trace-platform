/**
 * KTrace Relay Bundler — lightweight ERC-4337 bundler for hackathon demos.
 *
 * Instead of running the full eth-infinitism bundler (heavy monorepo),
 * this relay directly calls EntryPoint.handleOps() on-chain.
 *
 * Supported RPC methods:
 *   - eth_chainId
 *   - eth_supportedEntryPoints
 *   - eth_sendUserOperation
 *   - eth_estimateUserOperationGas
 *   - eth_getUserOperationReceipt
 *   - eth_getUserOperationByHash
 */

import { ethers } from 'ethers';
import http from 'http';

const ENTRYPOINT_ABI = [
  'function handleOps((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes)[] calldata ops, address payable beneficiary) external',
  'function getNonce(address account, uint192 key) view returns (uint256)',
  'function getUserOpHash((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes) calldata op) view returns (bytes32)'
];

const ENTRYPOINT_V0_7_ABI = [
  'function handleOps(tuple(address sender,uint256 nonce,bytes initCode,bytes callData,uint256 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address payable beneficiary) external',
  'function getNonce(address,uint192) view returns (uint256)',
  'function getUserOpHash(tuple(address sender,uint256 nonce,bytes initCode,bytes callData,uint256 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)) view returns (bytes32)'
];

const RECEIPT_TOPIC = '0x4b2c8e4a7f4f5b3e2d1a0c9b8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8';

function parseUserOp(obj) {
  return {
    sender: obj.sender,
    nonce: ethers.getBigInt(obj.nonce || '0'),
    initCode: obj.initCode || '0x',
    callData: obj.callData || '0x',
    callGasLimit: ethers.getBigInt(obj.callGasLimit || '0'),
    verificationGasLimit: ethers.getBigInt(obj.verificationGasLimit || '0'),
    preVerificationGas: ethers.getBigInt(obj.preVerificationGas || '0'),
    maxFeePerGas: ethers.getBigInt(obj.maxFeePerGas || '0'),
    maxPriorityFeePerGas: ethers.getBigInt(obj.maxPriorityFeePerGas || '0'),
    paymasterAndData: obj.paymasterAndData || '0x',
    signature: obj.signature || '0x'
  };
}

function userOpToTuple(op) {
  // EntryPoint v0.7 PackedUserOperation: accountGasLimits and gasFees are packed
  const accountGasLimits = ethers.solidityPacked(
    ['uint128', 'uint128'],
    [op.verificationGasLimit || 0n, op.callGasLimit || 0n]
  );
  const gasFees = ethers.solidityPacked(
    ['uint128', 'uint128'],
    [op.maxPriorityFeePerGas || 0n, op.maxFeePerGas || 0n]
  );
  return [
    op.sender,
    op.nonce,
    op.initCode,
    op.callData,
    BigInt(accountGasLimits),
    op.preVerificationGas,
    gasFees,
    op.paymasterAndData,
    op.signature
  ];
}

function getUserOpHash(op, entryPointAddr, chainId) {
  // ERC-4337 v0.7 PackedUserOperation hash
  // hash(op) = keccak256(abiEncode(
  //   sender, nonce, hash(initCode), callData, callGasLimit,
  //   verificationGasLimit, preVerificationGas, maxFeePerGas,
  //   maxPriorityFeePerGas, hash(paymasterAndData), signature
  // ))
  const initCodeHash = ethers.keccak256(op.initCode || '0x');
  const paymasterHash = ethers.keccak256(op.paymasterAndData || '0x');
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'bytes', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes'],
    [op.sender, op.nonce, initCodeHash, op.callData, op.callGasLimit,
     op.verificationGasLimit, op.preVerificationGas, op.maxFeePerGas,
     op.maxPriorityFeePerGas, paymasterHash, op.signature]
  );
  const userOpHash = ethers.keccak256(packed);
  const domainHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'address', 'uint256'],
    [ethers.id('EIP712Domain(address verifyingContract,uint256 chainId)'), entryPointAddr, chainId]
  ));
  return ethers.keccak256(ethers.concat([domainHash, userOpHash]));
}

export class RelayBundler {
  constructor(config) {
    this.rpcUrl = config.rpcUrl;
    this.entryPointAddress = config.entryPointAddress;
    this.beneficiary = config.beneficiary;
    this.signer = config.signer;
    this.chainId = config.chainId;
    this.port = config.port || 4337;

    this.provider = new ethers.JsonRpcProvider(this.rpcUrl, {
      chainId: this.chainId,
      name: 'relay-target'
    });
    this.pendingOps = new Map();
    this.receipts = new Map();
  }

  async start() {
    if (this.signer && typeof this.signer === 'string') {
      this.signer = new ethers.Wallet(this.signer, this.provider);
    }
    const address = await this.signer.getAddress();
    const balance = await this.provider.getBalance(address);
    console.log(`[relay-bundler] Signer: ${address}, balance: ${ethers.formatEther(balance)} HSK`);
    console.log(`[relay-bundler] EntryPoint: ${this.entryPointAddress}`);
    console.log(`[relay-bundler] RPC: ${this.rpcUrl}`);
    console.log(`[relay-bundler] Chain ID: ${this.chainId}`);

    this.entryPoint = new ethers.Contract(this.entryPointAddress, ENTRYPOINT_V0_7_ABI, this.signer);

    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        return res.end('Method Not Allowed');
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => this._handleRpc(body, res));
    });

    server.listen(this.port, '0.0.0.0', () => {
      console.log(`[relay-bundler] Listening on http://0.0.0.0:${this.port}/rpc`);
    });

    this.server = server;
  }

  async _handleRpc(body, res) {
    let rpcReq;
    try {
      rpcReq = JSON.parse(body);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
    }

    const { id, method, params } = rpcReq;
    let result;
    try {
      switch (method) {
        case 'eth_chainId':
          result = '0x' + this.chainId.toString(16);
          break;
        case 'eth_supportedEntryPoints':
          result = [this.entryPointAddress];
          break;
        case 'eth_sendUserOperation':
          result = await this._sendUserOp(params);
          break;
        case 'eth_estimateUserOperationGas':
          result = await this._estimateGas(params);
          break;
        case 'eth_getUserOperationReceipt':
          result = this._getReceipt(params);
          break;
        case 'eth_getUserOperationByHash':
          result = this._getOpByHash(params);
          break;
        default:
          throw { code: -32601, message: `Method not found: ${method}` };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    } catch (e) {
      console.error(`[relay-bundler] RPC error for ${method}:`, e.message || e);
      const error = e.code ? e : { code: -32500, message: e.message || String(e) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error }));
    }
  }

  async _sendUserOp(params) {
    const userOp = parseUserOp(params[0]);
    const entryPointAddr = params[1] || this.entryPointAddress;
    const opHash = getUserOpHash(userOp, entryPointAddr, this.chainId);

    console.log(`[relay-bundler] Sending UserOp hash=${opHash.slice(0, 18)}... sender=${userOp.sender}`);

    this.pendingOps.set(opHash, { ...userOp, entryPoint: entryPointAddr, submittedAt: Date.now() });

    try {
      const tx = await this.entryPoint.handleOps(
        [userOpToTuple(userOp)],
        this.beneficiary || await this.signer.getAddress(),
        { gasLimit: 2000000n }
      );
      console.log(`[relay-bundler] TX sent: ${tx.hash}`);

      const receipt = await tx.wait(1, 120000);
      const success = receipt.status === 1;
      console.log(`[relay-bundler] TX ${success ? 'confirmed' : 'FAILED'}: ${tx.hash} block=${receipt.blockNumber}`);

      this.receipts.set(opHash, {
        userOpHash: opHash,
        sender: userOp.sender,
        nonce: userOp.nonce,
        actualGasCost: receipt.gasUsed * receipt.gasPrice,
        actualGasUsed: receipt.gasUsed,
        success,
        txHash: tx.hash,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
        logs: receipt.logs.map((l) => ({
          address: l.address,
          topics: l.topics,
          data: l.data,
          logIndex: l.index
        })),
        receipt: {
          status: receipt.status,
          gasUsed: receipt.gasUsed,
          gasPrice: receipt.gasPrice,
          blockNumber: receipt.blockNumber,
          transactionHash: tx.hash
        }
      });

      this.pendingOps.delete(opHash);
      return opHash;
    } catch (err) {
      this.pendingOps.delete(opHash);
      console.error(`[relay-bundler] handleOps failed:`, err.message);
      throw new Error(`UserOp submission failed: ${err.message}`);
    }
  }

  async _estimateGas(params) {
    const userOp = parseUserOp(params[0]);
    return {
      preVerificationGas: userOp.preVerificationGas.toString() || '50000',
      verificationGasLimit: userOp.verificationGasLimit.toString() || '150000',
      callGasLimit: userOp.callGasLimit.toString() || '200000'
    };
  }

  _getReceipt(params) {
    const opHash = params[0];
    const receipt = this.receipts.get(opHash);
    if (!receipt) return null;
    return receipt;
  }

  _getOpByHash(params) {
    const opHash = params[0];
    const pending = this.pendingOps.get(opHash);
    if (pending) {
      return {
        userOpHash: opHash,
        sender: pending.sender,
        nonce: pending.nonce.toString(),
        status: 'pending'
      };
    }
    const receipt = this.receipts.get(opHash);
    if (receipt) {
      return {
        userOpHash: opHash,
        sender: receipt.sender,
        nonce: receipt.nonce.toString(),
        status: receipt.success ? 'included' : 'failed',
        transactionHash: receipt.txHash,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber
      };
    }
    return null;
  }
}

// CLI entry point
if (process.argv[1] && (process.argv[1].includes('relay-bundler') || process.argv[1].includes('relay-bundler.mjs'))) {
  const config = {
    rpcUrl: process.env.KITEAI_RPC_URL || 'https://testnet.hsk.xyz',
    entryPointAddress: process.env.KITE_ENTRYPOINT_ADDRESS || '0x5FF137D4b0FCDd83d469EB4F01b52EDc6ff5A2B3',
    beneficiary: process.env.RELAY_BENEFICIARY || '',
    signer: process.env.RELAY_SIGNER_PRIVATE_KEY || '',
    chainId: Number(process.env.KITE_CHAIN_ID) || 133,
    port: Number(process.env.RELAY_BUNDLER_PORT) || 4337
  };

  if (!config.signer) {
    console.error('[relay-bundler] RELAY_SIGNER_PRIVATE_KEY is required');
    process.exit(1);
  }

  const bundler = new RelayBundler(config);
  bundler.start().catch((e) => {
    console.error('[relay-bundler] Failed to start:', e);
    process.exit(1);
  });
}