#!/usr/bin/env node

import process from 'node:process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { fileURLToPath } from 'node:url';

export const X1_RPC = 'https://rpc.mainnet.x1.xyz';
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const U64_MAX = 18_446_744_073_709_551_615n;

function usage() {
  console.log(`HXMP X1 wallet transfer tool

Read-only / no signing:
  transfer-preview --wallet <sender> --to <recipient-wallet> --amount <ui> [--mint <spl-mint>]

Approval-gated execution:
  transfer --keypair <id.json> --to <recipient-wallet> --amount <ui> [--mint <spl-mint>] \\
    --expected-preview-sha256 <sha256:...> --execute --confirm-transfer

Rules:
  - Omit --mint for native XNT.
  - Amounts must be exact decimal strings; exponent and grouped notation are rejected.
  - transfer-preview builds and simulates the transaction but never loads a keypair.
  - transfer signs and broadcasts only when both execution flags and the exact preview hash match.`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) out[arg.slice(2)] = true;
    else { out[arg.slice(2)] = next; i += 1; }
  }
  return out;
}

function need(args, name) {
  if (args[name] == null || args[name] === '') throw new Error(`Missing --${name}`);
  return args[name];
}

function flagEnabled(value) {
  return value === true || value === '' || value === 'true';
}

export function parseUiAmount(amount, decimals) {
  if (typeof amount !== 'string' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Invalid amount or decimals');
  }
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)) throw new Error('Invalid amount format');
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > decimals) throw new Error('Invalid amount precision');
  const rawText = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  const raw = BigInt(rawText || '0');
  if (raw <= 0n || raw > U64_MAX) throw new Error('Invalid amount range');
  return raw;
}

function formatUiAmount(raw, decimals) {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  if (decimals === 0) return `${negative ? '-' : ''}${value}`;
  const padded = value.toString().padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function writeU64LE(value) {
  if (value < 0n || value > U64_MAX) throw new Error('Invalid u64 amount');
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function buildIntentHash(intent) {
  const canonical = JSON.stringify(canonicalize(intent));
  return `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

export function buildNativeTransferInstruction(sender, recipient, amountRaw) {
  const data = Buffer.concat([Buffer.from([2, 0, 0, 0]), writeU64LE(amountRaw)]);
  return new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
    ],
    data,
  });
}

export function buildTokenTransferCheckedInstruction({ source, mint, destination, owner, amountRaw, decimals, tokenProgram }) {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([12]), writeU64LE(amountRaw), Buffer.from([decimals])]),
  });
}

function buildCreateAtaInstruction(payer, ata, owner, mint, tokenProgram) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function deriveAta(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

function connection() {
  return new Connection(X1_RPC, 'confirmed');
}

function isSupportedTokenProgram(program) {
  return program.equals(TOKEN_PROGRAM) || program.equals(TOKEN_2022_PROGRAM);
}

async function getMintDetails(c, mint) {
  const response = await c.getParsedAccountInfo(mint, 'confirmed');
  if (!response.value) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (!isSupportedTokenProgram(response.value.owner)) throw new Error(`Unsupported mint program: ${response.value.owner.toBase58()}`);
  const parsed = response.value.data?.parsed;
  if (parsed?.type !== 'mint') throw new Error('Address is not a parsed SPL mint');
  const decimals = parsed.info?.decimals;
  if (!Number.isInteger(decimals)) throw new Error('Mint decimals unavailable');
  return { decimals, tokenProgram: response.value.owner };
}

async function getTokenAccountDetails(c, account) {
  const response = await c.getParsedAccountInfo(account, 'confirmed');
  if (!response.value) return null;
  const parsed = response.value.data?.parsed;
  if (parsed?.type !== 'account') throw new Error(`Not a parsed token account: ${account.toBase58()}`);
  return {
    account,
    program: response.value.owner,
    owner: new PublicKey(parsed.info.owner),
    mint: new PublicKey(parsed.info.mint),
    amountRaw: BigInt(parsed.info.tokenAmount.amount),
  };
}

async function findSourceTokenAccount(c, owner, mint, tokenProgram, requiredRaw) {
  const ata = deriveAta(owner, mint, tokenProgram);
  const ataDetails = await getTokenAccountDetails(c, ata);
  if (ataDetails && ataDetails.amountRaw >= requiredRaw) return ataDetails;
  const accounts = await c.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed');
  const candidates = accounts.value.map(entry => ({
    account: entry.pubkey,
    program: entry.account.owner,
    owner: new PublicKey(entry.account.data.parsed.info.owner),
    mint: new PublicKey(entry.account.data.parsed.info.mint),
    amountRaw: BigInt(entry.account.data.parsed.info.tokenAmount.amount),
  })).filter(item => item.program.equals(tokenProgram) && item.amountRaw >= requiredRaw)
    .sort((a, b) => a.account.toBase58().localeCompare(b.account.toBase58()));
  if (!candidates.length) throw new Error(`Insufficient token balance; need ${requiredRaw} base units`);
  return candidates[0];
}

async function simulateUnsigned(c, transaction) {
  const raw = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const response = await fetch(X1_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
      params: [raw, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }],
    }),
  });
  if (!response.ok) throw new Error(`Simulation RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`Simulation RPC error: ${body.error.message}`);
  return body.result.value;
}

async function prepareTransfer(args, senderOverride = null) {
  const c = connection();
  const sender = senderOverride || new PublicKey(need(args, 'wallet'));
  const recipient = new PublicKey(need(args, 'to'));
  if (sender.equals(recipient)) throw new Error('Sender and recipient must differ');
  const amount = need(args, 'amount');
  const mintArg = args.mint || null;
  const transaction = new Transaction();
  let intent;
  let before;

  if (!mintArg) {
    const decimals = 9;
    const amountRaw = parseUiAmount(amount, decimals);
    const senderBalance = BigInt(await c.getBalance(sender, 'confirmed'));
    const recipientBalance = BigInt(await c.getBalance(recipient, 'confirmed'));
    transaction.add(buildNativeTransferInstruction(sender, recipient, amountRaw));
    intent = {
      network: 'X1 mainnet', rpc: X1_RPC, sender: sender.toBase58(), recipient: recipient.toBase58(),
      asset: 'XNT', mint: null, amount: formatUiAmount(amountRaw, decimals), amount_raw: amountRaw.toString(), decimals,
      source_token_account: null, recipient_token_account: null, creates_recipient_token_account: false,
    };
    before = { sender_xnt_raw: senderBalance.toString(), recipient_xnt_raw: recipientBalance.toString() };
  } else {
    const mint = new PublicKey(mintArg);
    const { decimals, tokenProgram } = await getMintDetails(c, mint);
    const amountRaw = parseUiAmount(amount, decimals);
    const source = await findSourceTokenAccount(c, sender, mint, tokenProgram, amountRaw);
    if (!source.owner.equals(sender) || !source.mint.equals(mint) || !source.program.equals(tokenProgram)) throw new Error('Source token account relationship mismatch');
    const destination = deriveAta(recipient, mint, tokenProgram);
    const destinationDetails = await getTokenAccountDetails(c, destination);
    if (destinationDetails && (!destinationDetails.owner.equals(recipient) || !destinationDetails.mint.equals(mint) || !destinationDetails.program.equals(tokenProgram))) {
      throw new Error('Recipient token account relationship mismatch');
    }
    const createsRecipientTokenAccount = destinationDetails == null;
    if (createsRecipientTokenAccount) transaction.add(buildCreateAtaInstruction(sender, destination, recipient, mint, tokenProgram));
    transaction.add(buildTokenTransferCheckedInstruction({ source: source.account, mint, destination, owner: sender, amountRaw, decimals, tokenProgram }));
    const senderXnt = BigInt(await c.getBalance(sender, 'confirmed'));
    intent = {
      network: 'X1 mainnet', rpc: X1_RPC, sender: sender.toBase58(), recipient: recipient.toBase58(), asset: 'SPL token',
      mint: mint.toBase58(), token_program: tokenProgram.toBase58(), amount: formatUiAmount(amountRaw, decimals),
      amount_raw: amountRaw.toString(), decimals, source_token_account: source.account.toBase58(),
      recipient_token_account: destination.toBase58(), creates_recipient_token_account: createsRecipientTokenAccount,
    };
    before = {
      sender_xnt_raw: senderXnt.toString(), source_token_raw: source.amountRaw.toString(),
      recipient_token_raw: (destinationDetails?.amountRaw || 0n).toString(),
    };
  }

  const latest = await c.getLatestBlockhash('confirmed');
  transaction.feePayer = sender;
  transaction.recentBlockhash = latest.blockhash;
  const feeResponse = await c.getFeeForMessage(transaction.compileMessage(), 'confirmed');
  const feeRaw = BigInt(feeResponse.value || 0);
  const simulation = await simulateUnsigned(c, transaction);
  const previewSha256 = buildIntentHash(intent);
  return {
    c, sender, recipient, transaction, latest, intent, before, feeRaw, simulation,
    preview: {
      success: simulation.err == null,
      dry_run: true,
      signed: false,
      broadcast: false,
      state_changing: false,
      intent,
      preview_sha256: previewSha256,
      estimated_network_fee_xnt: formatUiAmount(feeRaw, 9),
      simulation: { err: simulation.err, units_consumed: simulation.unitsConsumed ?? null, logs: simulation.err ? simulation.logs : undefined },
      approval_required: `Approve this exact intent with expected_preview_sha256=${previewSha256}`,
    },
  };
}

export function executionApproved(args, actualPreviewHash) {
  return flagEnabled(args.execute)
    && flagEnabled(args['confirm-transfer'])
    && typeof args['expected-preview-sha256'] === 'string'
    && args['expected-preview-sha256'] === actualPreviewHash;
}

async function transferPreview(args) {
  return (await prepareTransfer(args)).preview;
}

function loadKeypair(keypairPath) {
  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  if (!Array.isArray(secret)) throw new Error('Keypair file must be a Solana JSON byte array');
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function executeTransfer(args) {
  if (!flagEnabled(args.execute) || !flagEnabled(args['confirm-transfer'])) {
    throw new Error('Execution blocked: call transfer-preview first, obtain explicit user approval, then pass --execute --confirm-transfer and the exact --expected-preview-sha256');
  }
  need(args, 'expected-preview-sha256');
  const keypair = loadKeypair(need(args, 'keypair'));
  const prepared = await prepareTransfer(args, keypair.publicKey);
  if (!executionApproved(args, prepared.preview.preview_sha256)) {
    throw new Error(`Execution blocked: preview hash mismatch; current preview is ${prepared.preview.preview_sha256}`);
  }
  if (prepared.simulation.err != null) throw new Error(`Execution blocked: simulation failed: ${JSON.stringify(prepared.simulation.err)}`);

  prepared.transaction.sign(keypair);
  const signature = await prepared.c.sendRawTransaction(prepared.transaction.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
  const confirmation = await prepared.c.confirmTransaction({
    signature,
    blockhash: prepared.latest.blockhash,
    lastValidBlockHeight: prepared.latest.lastValidBlockHeight,
  }, 'confirmed');
  if (confirmation.value.err) throw new Error(`Transfer confirmation failed: ${JSON.stringify(confirmation.value.err)}`);

  let verification;
  if (prepared.intent.asset === 'XNT') {
    const senderAfter = BigInt(await prepared.c.getBalance(prepared.sender, 'confirmed'));
    const recipientAfter = BigInt(await prepared.c.getBalance(prepared.recipient, 'confirmed'));
    const expectedRecipient = BigInt(prepared.before.recipient_xnt_raw) + BigInt(prepared.intent.amount_raw);
    verification = {
      sender_xnt_raw_after: senderAfter.toString(), recipient_xnt_raw_after: recipientAfter.toString(),
      recipient_delta_verified: recipientAfter >= expectedRecipient,
    };
  } else {
    const sourceAfter = BigInt((await prepared.c.getTokenAccountBalance(new PublicKey(prepared.intent.source_token_account), 'confirmed')).value.amount);
    const destinationAfter = BigInt((await prepared.c.getTokenAccountBalance(new PublicKey(prepared.intent.recipient_token_account), 'confirmed')).value.amount);
    const amountRaw = BigInt(prepared.intent.amount_raw);
    verification = {
      source_token_raw_after: sourceAfter.toString(), recipient_token_raw_after: destinationAfter.toString(),
      source_delta_verified: sourceAfter + amountRaw <= BigInt(prepared.before.source_token_raw),
      recipient_delta_verified: destinationAfter >= BigInt(prepared.before.recipient_token_raw) + amountRaw,
    };
  }

  return {
    success: Object.values(verification).filter(value => typeof value === 'boolean').every(Boolean),
    dry_run: false, signed: true, broadcast: true, state_changing: true,
    intent: prepared.intent, preview_sha256: prepared.preview.preview_sha256,
    signature, explorer: `https://explorer.mainnet.x1.xyz/tx/${signature}`,
    confirmation: 'confirmed', verification,
  };
}

function printJson(value) {
  console.log(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === 'help' || args.help) { usage(); return; }
  if (command === 'transfer-preview') printJson(await transferPreview(args));
  else if (command === 'transfer') printJson(await executeTransfer(args));
  else throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMain) {
  main().catch(error => {
    console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
