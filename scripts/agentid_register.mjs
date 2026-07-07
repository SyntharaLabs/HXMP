#!/usr/bin/env node
// AgentID v2 transaction-builder for X1.
//
// Safety model:
// - Dry-run/build commands never read a secret key, sign, or submit.
// - State-changing register-flow requires BOTH --execute and --confirm-execute.
// - The script prints public keys, tx signatures, and API responses; it never prints secret-key bytes.
//
// Source alignment: mirrors the live AgentID website JS from
// https://agentid-app.vercel.app and /api/docs as of 2026-07-06.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  sendAndConfirmRawTransaction,
} from '@solana/web3.js';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const X1_EXPLORER = 'https://explorer.x1.xyz';
const AGENTID_API = 'https://agentid-app.vercel.app/api';
const AGI_MINT = '7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER';
const WXNT_MINT = 'So11111111111111111111111111111111111111112';
const AGENTID_V2_PROGRAM_ID = '7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2';
const REGISTER_AGENT_DISCRIMINATOR = new Uint8Array([135, 157, 66, 195, 2, 113, 175, 30]);
const ATTACH_AGENT_NFT_DISCRIMINATOR = new Uint8Array([192, 90, 217, 51, 218, 237, 60, 40]);
const XDEX_PROGRAM = 'sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN';
const XDEX_POOL = '4sn8oCQWPikDxBkyRdd1S6bJ24oYjGF16aR7ZqCSXy4v';
const XDEX_AMM = '2eFPWosizV6nSAGeSvi5tRgXLoqhjnSesra23ALA248c';
const XDEX_XNT_VAULT = 'FSxoLLMasBzDnqPDU7VzKXDmfp34cKJxXQsoXQEvwECf';
const XDEX_AGI_VAULT = 'ELG1JmpJETYxZCwFBesCrpJDukfrMmND3gKtVnsKtMgi';
const XDEX_OBS = 'CHobHjvibk3Tja3MfWEkVdzbJg8pDxFqh8qJ7WSUUXM4';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const BURN_AMOUNT_RAW = 100_000_000n; // 0.1 AGI, 9 decimals
const SWAP_FEE_NUM = 9975n;
const SWAP_FEE_DEN = 10000n;
const XNT_GAS_BUFFER = 5_000_000n;
const AGENTID_API_NAME_MAX = 32;
const AGENTID_API_DESCRIPTION_MAX = 256;
const AGENTID_CARD_NAME_MAX = 18;
const AGENTID_CARD_TAGLINE_MAX = 52;

function usage() {
  console.log(`AgentID v2 X1 tool

Commands:
  status --wallet <pubkey>
  quote
  build-swap --wallet <pubkey> [--out tx.b64]
  build-register --wallet <pubkey> --name <name> --description <desc> [--moltbook <handle>] [--out tx.b64]
  build-attach --wallet <pubkey> --nft-mint <mint> [--out tx.b64]
  register-flow --wallet <pubkey> --name <name> --description <desc> [--moltbook <handle>] [--photo-url <url>] [--keypair <id.json> --execute --confirm-execute]

Notes:
  - build-* commands are read-only dry-runs: no signing/submission.
  - register-flow without --execute prints the exact plan only.
  - register-flow with --execute spends XNT/AGI and posts AgentID API calls.
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    if (['execute', 'confirm-execute', 'json'].includes(k)) out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
}

function requireArg(args, name) {
  const v = args[name];
  if (!v) throw new Error(`Missing --${name}`);
  return v;
}
function visibleLength(s) { return Array.from((s || '').trim()).length; }
function normalizeCardText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function validateAgentCardText(nameIn, descriptionIn) {
  const name = normalizeCardText(nameIn);
  const description = normalizeCardText(descriptionIn);
  const errors = [];
  const nameLen = visibleLength(name);
  const descLen = visibleLength(description);
  if (!name) errors.push('AgentID name is required.');
  if (!description) errors.push('AgentID description/tagline is required.');
  if (nameLen > AGENTID_API_NAME_MAX) errors.push(`AgentID API name max is ${AGENTID_API_NAME_MAX} chars; got ${nameLen}.`);
  if (descLen > AGENTID_API_DESCRIPTION_MAX) errors.push(`AgentID API description max is ${AGENTID_API_DESCRIPTION_MAX} chars; got ${descLen}.`);
  if (nameLen > AGENTID_CARD_NAME_MAX) errors.push(`AgentID card-safe name max is ${AGENTID_CARD_NAME_MAX} chars; got ${nameLen}. Shorten it so the NFT card does not clip.`);
  if (descLen > AGENTID_CARD_TAGLINE_MAX) errors.push(`AgentID card-safe tagline max is ${AGENTID_CARD_TAGLINE_MAX} chars; got ${descLen}. Shorten it so the NFT card does not clip.`);
  if (errors.length) throw new Error(errors.join(' '));
  return { name, description, card_limits: { name_max: AGENTID_CARD_NAME_MAX, tagline_max: AGENTID_CARD_TAGLINE_MAX }, lengths: { name: nameLen, description: descLen } };
}

function conn() { return new Connection(X1_RPC, 'confirmed'); }
function pk(s) { return new PublicKey(s); }
function ceilDiv(a, b) { return (a + b - 1n) / b; }

function encodeU32LE(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
function encodeStringField(value) {
  const encoded = new TextEncoder().encode(value || '');
  const len = encodeU32LE(encoded.length);
  const out = new Uint8Array(4 + encoded.length);
  out.set(len, 0); out.set(encoded, 4);
  return out;
}
function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { out.set(arr, offset); offset += arr.length; }
  return out;
}
function encodeRegisterAgentArgs(name, description, moltbook) {
  return concatBytes(
    REGISTER_AGENT_DISCRIMINATOR,
    encodeStringField(name),
    encodeStringField(description),
    encodeStringField(moltbook || '')
  );
}
function encodeAttachAgentNftArgs(nftMintPubkey) {
  return concatBytes(ATTACH_AGENT_NFT_DISCRIMINATOR, nftMintPubkey.toBytes());
}
function getATA(owner, mint) {
  const tokenProgram = pk(TOKEN_PROGRAM_ID);
  const associatedTokenProgram = pk(ASSOCIATED_TOKEN_PROGRAM_ID);
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram
  )[0];
}
function getAgentPda(ownerPubkey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('agent'), ownerPubkey.toBuffer()],
    pk(AGENTID_V2_PROGRAM_ID)
  )[0];
}
function getXdexAuthority(programId) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('vault_and_lp_mint_auth_seed')],
    programId instanceof PublicKey ? programId : pk(programId)
  )[0];
}
function createAtaInstruction(payer, ata, owner, mint, assocProgram, tokenProgram) {
  return new TransactionInstruction({
    programId: assocProgram,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array(0),
  });
}
function txToBase64(tx) {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}
async function finishTx(tx, feePayer) {
  const { blockhash, lastValidBlockHeight } = await conn().getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  return { tx, blockhash, lastValidBlockHeight };
}
async function httpJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) throw new Error(`${url} failed ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
async function downloadBinary(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf, { mode: 0o600 });
  return { path: outPath, bytes: buf.length };
}
async function tokenRaw(connection, owner, mint) {
  const resp = await connection.getTokenAccountsByOwner(owner, { mint });
  let total = 0n;
  for (const item of resp.value) {
    const bal = await connection.getTokenAccountBalance(item.pubkey);
    total += BigInt(bal.value.amount || '0');
  }
  return { raw: total, accounts: resp.value.length };
}
async function quoteXntForAgi(targetOutRaw = BURN_AMOUNT_RAW) {
  const c = conn();
  const [xntBal, agiBal] = await Promise.all([
    c.getTokenAccountBalance(pk(XDEX_XNT_VAULT)),
    c.getTokenAccountBalance(pk(XDEX_AGI_VAULT)),
  ]);
  const reserveIn = BigInt(xntBal.value.amount);
  const reserveOut = BigInt(agiBal.value.amount);
  if (reserveOut <= targetOutRaw) throw new Error('XDEX AGI liquidity too low for quote');
  const amtInFee = ceilDiv(reserveIn * targetOutRaw, reserveOut - targetOutRaw);
  const rawIn = ceilDiv(amtInFee * SWAP_FEE_DEN, SWAP_FEE_NUM);
  return { lamports: rawIn, minOut: targetOutRaw, estimatedXnt: Number(rawIn) / 1e9 };
}
async function buildXntToAgiSwapTransaction(walletPubkey, quote = null) {
  const c = conn();
  const wk = walletPubkey instanceof PublicKey ? walletPubkey : pk(walletPubkey);
  const params = quote || await quoteXntForAgi();
  const lamports = (params.lamports * 102n) / 100n + 1000n;
  const xntBalance = BigInt(await c.getBalance(wk));
  if (xntBalance < lamports + XNT_GAS_BUFFER) {
    throw new Error(`Not enough XNT. Have ${Number(xntBalance) / 1e9}, need about ${Number(lamports + XNT_GAS_BUFFER) / 1e9}.`);
  }
  const XDEX_PROGRAM_PK = pk(XDEX_PROGRAM);
  const WXNT_MINT_PK = pk(WXNT_MINT);
  const AGI_MINT_PK = pk(AGI_MINT);
  const TOKEN_PROGRAM_PK = pk(TOKEN_PROGRAM_ID);
  const ASSOC_TOKEN_PK = pk(ASSOCIATED_TOKEN_PROGRAM_ID);
  const wxntATA = getATA(wk, WXNT_MINT_PK);
  const agiATA = getATA(wk, AGI_MINT_PK);
  const authority = getXdexAuthority(XDEX_PROGRAM_PK);
  const tx = new Transaction();
  const [wxntInfo, agiInfo] = await Promise.all([c.getAccountInfo(wxntATA), c.getAccountInfo(agiATA)]);
  if (!wxntInfo) tx.add(createAtaInstruction(wk, wxntATA, wk, WXNT_MINT_PK, ASSOC_TOKEN_PK, TOKEN_PROGRAM_PK));
  if (!agiInfo) tx.add(createAtaInstruction(wk, agiATA, wk, AGI_MINT_PK, ASSOC_TOKEN_PK, TOKEN_PROGRAM_PK));
  tx.add(SystemProgram.transfer({ fromPubkey: wk, toPubkey: wxntATA, lamports: Number(lamports) }));
  tx.add(new TransactionInstruction({
    programId: TOKEN_PROGRAM_PK,
    keys: [{ pubkey: wxntATA, isSigner: false, isWritable: true }],
    data: new Uint8Array([17]), // SPL Token SyncNative
  }));
  const swapData = new Uint8Array(24);
  [143, 190, 90, 218, 196, 30, 51, 222].forEach((b, i) => swapData[i] = b);
  new DataView(swapData.buffer).setBigUint64(8, lamports, true);
  new DataView(swapData.buffer).setBigUint64(16, params.minOut, true);
  tx.add(new TransactionInstruction({
    programId: XDEX_PROGRAM_PK,
    keys: [
      { pubkey: wk, isSigner: true, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: pk(XDEX_AMM), isSigner: false, isWritable: false },
      { pubkey: pk(XDEX_POOL), isSigner: false, isWritable: true },
      { pubkey: wxntATA, isSigner: false, isWritable: true },
      { pubkey: agiATA, isSigner: false, isWritable: true },
      { pubkey: pk(XDEX_XNT_VAULT), isSigner: false, isWritable: true },
      { pubkey: pk(XDEX_AGI_VAULT), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: WXNT_MINT_PK, isSigner: false, isWritable: false },
      { pubkey: AGI_MINT_PK, isSigner: false, isWritable: false },
      { pubkey: pk(XDEX_OBS), isSigner: false, isWritable: true },
    ],
    data: swapData,
  }));
  await finishTx(tx, wk);
  return { tx, quote: params, lamports, wxntATA, agiATA };
}
async function buildRegisterAgentTransaction(walletPubkey, { name, description, moltbook = '' }) {
  ({ name, description } = validateAgentCardText(name, description));
  const wk = walletPubkey instanceof PublicKey ? walletPubkey : pk(walletPubkey);
  const agiMintPubkey = pk(AGI_MINT);
  const registrantAgiAta = getATA(wk, agiMintPubkey);
  const agentPda = getAgentPda(wk);
  const ix = new TransactionInstruction({
    programId: pk(AGENTID_V2_PROGRAM_ID),
    keys: [
      { pubkey: wk, isSigner: true, isWritable: true },
      { pubkey: agentPda, isSigner: false, isWritable: true },
      { pubkey: agiMintPubkey, isSigner: false, isWritable: true },
      { pubkey: registrantAgiAta, isSigner: false, isWritable: true },
      { pubkey: pk(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: pk(ASSOCIATED_TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeRegisterAgentArgs(name, description, moltbook),
  });
  const tx = new Transaction().add(ix);
  await finishTx(tx, wk);
  return { tx, agentPda, registrantAgiAta };
}
async function buildAttachAgentNftTransaction(walletPubkey, nftMint) {
  const wk = walletPubkey instanceof PublicKey ? walletPubkey : pk(walletPubkey);
  const agentPda = getAgentPda(wk);
  const ix = new TransactionInstruction({
    programId: pk(AGENTID_V2_PROGRAM_ID),
    keys: [
      { pubkey: wk, isSigner: true, isWritable: true },
      { pubkey: agentPda, isSigner: false, isWritable: true },
    ],
    data: encodeAttachAgentNftArgs(pk(nftMint)),
  });
  const tx = new Transaction().add(ix);
  await finishTx(tx, wk);
  return { tx, agentPda };
}
function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Keypair file must be a Solana id.json array');
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
async function sendSigned(tx, keypair, label) {
  tx.sign(keypair);
  const sig = await sendAndConfirmRawTransaction(conn(), tx.serialize(), { commitment: 'confirmed' });
  console.log(`${label}: ${sig}`);
  console.log(`${label}_explorer: ${X1_EXPLORER}/tx/${sig}`);
  return sig;
}
async function status(wallet) {
  const c = conn();
  const owner = pk(wallet);
  const [balance, agi, wxnt, verify, quote] = await Promise.all([
    c.getBalance(owner),
    tokenRaw(c, owner, pk(AGI_MINT)),
    tokenRaw(c, owner, pk(WXNT_MINT)),
    httpJson(`${AGENTID_API}/verify?wallet=${encodeURIComponent(wallet)}`).catch(e => ({ error: String(e) })),
    quoteXntForAgi().catch(e => ({ error: String(e) })),
  ]);
  return {
    wallet,
    native_xnt: balance / 1e9,
    agi: { raw: agi.raw.toString(), amount: Number(agi.raw) / 1e9, accounts: agi.accounts, has_required_0_1: agi.raw >= BURN_AMOUNT_RAW },
    wxnt: { raw: wxnt.raw.toString(), accounts: wxnt.accounts, required_by_agentid: false },
    agentid_verify: verify,
    quote,
    next: verify?.verified ? 'already verified' : (agi.raw >= BURN_AMOUNT_RAW ? 'build/register register_agent then register-v2' : 'swap native XNT to AGI, then register_agent'),
  };
}
async function cmdRegisterFlow(args) {
  let name = requireArg(args, 'name');
  let description = requireArg(args, 'description');
  const cardText = validateAgentCardText(name, description);
  name = cardText.name;
  description = cardText.description;
  const moltbook = args.moltbook || '';
  const photoUrl = args['photo-url'] || null;
  const executing = !!args.execute;
  const wallet = executing ? null : requireArg(args, 'wallet');
  const kp = executing ? loadKeypair(requireArg(args, 'keypair')) : null;
  const effectiveWallet = executing ? kp.publicKey.toBase58() : wallet;
  const st = await status(effectiveWallet);
  printJson({ plan: 'AgentID v2 registration', wallet: effectiveWallet, name, description, card_text: cardText, moltbook, photoUrl, status: st, dry_run_secret_access: false });
  if (!executing) {
    console.log('\nDRY RUN ONLY. No keypair was read. To execute, rerun with --keypair <id.json> --execute --confirm-execute.');
    return;
  }
  if (!args['confirm-execute']) throw new Error('Execution requires --confirm-execute');
  if (st.agentid_verify?.verified) throw new Error('Wallet already verifies as AgentID; refusing duplicate registration.');

  let preRegistrationTxSignature = null;
  if (!st.agi.has_required_0_1) {
    console.log('Step 1: swap native XNT -> AGI');
    const { tx } = await buildXntToAgiSwapTransaction(kp.publicKey);
    preRegistrationTxSignature = await sendSigned(tx, kp, 'swap_tx');
  } else {
    console.log('Step 1: AGI balance already sufficient; skipping swap');
  }

  console.log('Step 2: register_agent on-chain');
  const reg = await buildRegisterAgentTransaction(kp.publicKey, { name, description, moltbook });
  const registrationTxSignature = await sendSigned(reg.tx, kp, 'register_agent_tx');

  console.log('Step 3: POST /api/register-v2');
  const mintResult = await httpJson(`${AGENTID_API}/register-v2`, {
    method: 'POST',
    body: JSON.stringify({ name, description, wallet: effectiveWallet, registrationTxSignature, moltbook, photoUrl }),
  });
  console.log('register_v2_response:', JSON.stringify(mintResult, null, 2));
  const nftMint = mintResult?.nft?.mint;
  if (!nftMint) throw new Error('register-v2 response did not include nft.mint');

  console.log('Step 4: attach_agent_nft on-chain');
  const attach = await buildAttachAgentNftTransaction(kp.publicKey, nftMint);
  const attachTxSignature = await sendSigned(attach.tx, kp, 'attach_agent_nft_tx');

  console.log('Step 5: POST /api/register-v2-finalize');
  const finalResult = await httpJson(`${AGENTID_API}/register-v2-finalize`, {
    method: 'POST',
    body: JSON.stringify({ name, description, wallet: effectiveWallet, moltbook, photoUrl, registrationTxSignature, attachTxSignature, nftMint, preRegistrationTxSignature }),
  });
  console.log('finalize_response:', JSON.stringify(finalResult, null, 2));

  const verify = await httpJson(`${AGENTID_API}/verify?wallet=${encodeURIComponent(effectiveWallet)}`);
  console.log('verify_response:', JSON.stringify(verify, null, 2));
  const metadataUri = verify?.nft?.metadataUri;
  if (metadataUri) {
    const metadata = await httpJson(metadataUri).catch(e => ({ error: String(e) }));
    console.log('nft_metadata_response:', JSON.stringify(metadata, null, 2));
    if (metadata?.image) {
      const defaultCardOut = `agentid-card-${effectiveWallet}.png`;
      const cardOut = args['card-out'] || defaultCardOut;
      const downloaded = await downloadBinary(metadata.image, cardOut).catch(e => ({ error: String(e), path: cardOut }));
      console.log('nft_image_url:', metadata.image);
      console.log('nft_card_file:', JSON.stringify(downloaded));
      console.log('delivery_action_required: send this AgentID NFT/card image file to the user as part of the registration receipt');
    }
  }
}
async function writeTxMaybe(path, tx) {
  const b64 = txToBase64(tx);
  if (path) fs.writeFileSync(path, b64 + '\n', { mode: 0o600 });
  return b64;
}
function printJson(value) {
  console.log(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) { usage(); return; }
  if (cmd === 'status') printJson(await status(requireArg(args, 'wallet')));
  else if (cmd === 'quote') printJson(await quoteXntForAgi());
  else if (cmd === 'build-swap') {
    const r = await buildXntToAgiSwapTransaction(requireArg(args, 'wallet'));
    const b64 = await writeTxMaybe(args.out, r.tx);
    console.log(JSON.stringify({ wallet: args.wallet, tx_base64: args.out ? `(written to ${args.out})` : b64, lamports: r.lamports.toString(), estimatedXnt: Number(r.lamports)/1e9, minOut: r.quote.minOut.toString(), wxntATA: r.wxntATA.toBase58(), agiATA: r.agiATA.toBase58() }, null, 2));
  } else if (cmd === 'build-register') {
    const cardText = validateAgentCardText(requireArg(args, 'name'), requireArg(args, 'description'));
    const r = await buildRegisterAgentTransaction(requireArg(args, 'wallet'), { name: cardText.name, description: cardText.description, moltbook: args.moltbook || '' });
    const b64 = await writeTxMaybe(args.out, r.tx);
    console.log(JSON.stringify({ wallet: args.wallet, card_text: cardText, agentPda: r.agentPda.toBase58(), agiATA: r.registrantAgiAta.toBase58(), tx_base64: args.out ? `(written to ${args.out})` : b64 }, null, 2));
  } else if (cmd === 'build-attach') {
    const r = await buildAttachAgentNftTransaction(requireArg(args, 'wallet'), requireArg(args, 'nft-mint'));
    const b64 = await writeTxMaybe(args.out, r.tx);
    console.log(JSON.stringify({ wallet: args.wallet, agentPda: r.agentPda.toBase58(), nftMint: args['nft-mint'], tx_base64: args.out ? `(written to ${args.out})` : b64 }, null, 2));
  } else if (cmd === 'register-flow') await cmdRegisterFlow(args);
  else throw new Error(`Unknown command: ${cmd}`);
}

main().catch(err => { console.error(`ERROR: ${err.message}`); process.exit(1); });
