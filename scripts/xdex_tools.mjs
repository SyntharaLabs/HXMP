#!/usr/bin/env node
// Safe read-only / dry-run XDEX tools for X1 Agent Protocol.
// No keypair loading. No signing. No transaction submission.

import process from 'node:process';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import fs from 'node:fs';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const XDEX_PROGRAM = 'sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN';
const WXNT_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOC_PROG = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SPL_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const TOKEN_2022_PROG = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const METADATA_PROG = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const XDEX_CREATE_POOL_FEE = 'SKc6b6zAv2kkB9EtitjppbzPVR48bCMfRtE5B8KDuF1';
const XDEX_DEPOSIT_IX = [242,35,198,137,82,225,242,182];
const XDEX_WITHDRAW_IX = [183,18,70,156,148,109,161,34];
const XDEX_INITIALIZE_IX = [175,175,109,31,13,152,155,237];
const XNT_GAS_BUFFER = 5000000n;
const XDEX_MAX_CONFIG_INDEX = 16;

function usage() {
  console.log(`XDEX X1 tool\n\nSafe/read-only:\n  rpc-health\n  wallet-tokens --wallet <pubkey>\n  pool-info --pool <poolState>\n  quote-add-liquidity --pool <poolState> --xnt <amount>\n  quote-remove-liquidity --pool <poolState> --lp <amount>\n  dry-run-token-metadata --name <name> --symbol <symbol> [--description <desc>]\n  dry-run-create-pool --wallet <pubkey> --token-mint <mint> --xnt <amount> --token <amount> [--config-index n]\n\nApproval-gated execution:\n  create-token --wallet <pubkey> --name <name> --symbol <symbol> --decimals <n> --supply <ui> [--description <desc>|--uri <uri>]\n  create-token --keypair <id.json> --name <name> --symbol <symbol> --decimals <n> --supply <ui> [--description <desc>|--uri <uri>] --execute --confirm-execute [--hxmp-receipt]\n  create-pool --keypair <id.json> --token-mint <mint> --xnt <amount> --token <amount> [--config-index n] --execute --confirm-execute [--hxmp-receipt]\n  add-liquidity --keypair <id.json> --pool <poolState> --xnt <amount> [--slippage-bps 300] --execute --confirm-execute [--hxmp-receipt]\n  remove-liquidity --keypair <id.json> --pool <poolState> --lp <amount> [--slippage-bps 300] --execute --confirm-execute [--hxmp-receipt]\n\nWithout --execute --confirm-execute, execution commands return a dry-run preview only.`);
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i += 1; }
  }
  return out;
}
function need(args, k) { if (!args[k]) throw new Error(`Missing --${k}`); return args[k]; }
function conn() { return new Connection(X1_RPC, 'confirmed'); }
function pk(s) { return new PublicKey(s); }
function readU64LE(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true); }
function readPubkey(bytes, offset) { return new PublicKey(bytes.slice(offset, offset + 32)); }
function toUiAmount(raw, decimals) { return Number(raw) / Math.pow(10, decimals || 0); }
function uiAmountToRaw(amount, decimals) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) throw new Error('Invalid amount');
  return BigInt(Math.round(num * Math.pow(10, decimals || 0)));
}
function writeU16BE(value) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, Number(value) || 0, false); return out; }
function writeU16LE(value) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, Number(value) || 0, true); return out; }
function writeU32LE(value) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, Number(value) || 0, true); return out; }
function writeU64LE(value) { const out = new Uint8Array(8); const big = typeof value === 'bigint' ? value : BigInt(Math.round(Number(value) || 0)); new DataView(out.buffer).setBigUint64(0, big, true); return out; }
function concatBytes(...arrays) { const total = arrays.reduce((sum, arr) => sum + arr.length, 0); const out = new Uint8Array(total); let o = 0; for (const arr of arrays) { out.set(arr, o); o += arr.length; } return out; }
function encodeBorshString(value, maxBytes, fallback = '') { const text = trimUtf8(value, maxBytes, fallback); const bytes = new TextEncoder().encode(text); return { text, bytes: concatBytes(writeU32LE(bytes.length), bytes) }; }
function applySlippageUp(raw, bps) { return (raw * (10000n + BigInt(Math.max(0, Number(bps) || 0))) + 9999n) / 10000n; }
function applySlippageDown(raw, bps) { return raw * (10000n - BigInt(Math.max(0, Number(bps) || 0))) / 10000n; }
function ensureExecute(args) { return args.execute === 'true' || args.execute === true || args.execute === ''; }
function ensureConfirm(args) { return args['confirm-execute'] === 'true' || args['confirm-execute'] === true || args['confirm-execute'] === ''; }
function executionApproved(args) { return ensureExecute(args) && ensureConfirm(args); }
function loadKeypair(path) { const raw = JSON.parse(fs.readFileSync(path, 'utf8')); return Keypair.fromSecretKey(Uint8Array.from(raw)); }
function explorer(sig) { return `https://explorer.x1.xyz/tx/${sig}`; }
function createAtaInstruction(payer, ata, owner, mint, assocProgram, tokenProgram, idempotent = true) { return new TransactionInstruction({ programId: assocProgram, keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tokenProgram, isSigner: false, isWritable: false }], data: new Uint8Array(idempotent ? [1] : []) }); }
function createSyncNativeInstruction(wsolAta) { return new TransactionInstruction({ programId: pk(TOKEN_PROG), keys: [{ pubkey: wsolAta, isSigner: false, isWritable: true }], data: new Uint8Array([17]) }); }
function createInitializeMintInstruction(mint, decimals, mintAuthority, freezeAuthority = mintAuthority) { return new TransactionInstruction({ programId: pk(TOKEN_PROG), keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: pk('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false }], data: concatBytes(new Uint8Array([0, Number(decimals)]), mintAuthority.toBytes(), new Uint8Array([freezeAuthority ? 1 : 0]), freezeAuthority ? freezeAuthority.toBytes() : new Uint8Array(32)) }); }
function createMintToInstruction(mint, destAta, authority, rawAmount) { return new TransactionInstruction({ programId: pk(TOKEN_PROG), keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: destAta, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false }], data: concatBytes(new Uint8Array([7]), writeU64LE(rawAmount)) }); }
async function sendSignedTx(c, tx, signers) { const latest = await c.getLatestBlockhash(); tx.recentBlockhash = latest.blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers); const raw = tx.serialize(); const sig = await c.sendRawTransaction(raw); await c.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed'); return sig; }
async function maybeHxmpReceipt(c, walletKeypair, action, primarySig, body) { if (!body) return null; const receipt = { p: 'HXMP', v: 1, t: 'defi.receipt', app: 'XDEX', net: 'X1', a: action, w: walletKeypair.publicKey.toBase58(), tx: primarySig, ts: new Date().toISOString(), ...body };
  const text = JSON.stringify(receipt); if (new TextEncoder().encode(text).length > 900) throw new Error('HXMP receipt too large');
  const tx = new Transaction().add(new TransactionInstruction({ programId: pk(SPL_MEMO_PROGRAM), keys: [{ pubkey: walletKeypair.publicKey, isSigner: true, isWritable: false }], data: new TextEncoder().encode(text) }));
  const sig = await sendSignedTx(c, tx, [walletKeypair]); return { signature: sig, explorer: explorer(sig), receipt };
}
function trimUtf8(str, maxBytes, fallback = '') {
  const enc = new TextEncoder();
  if (enc.encode(str).length <= maxBytes) return str;
  let out = str;
  while (out && enc.encode(out).length > maxBytes) out = out.slice(0, -1);
  return out || fallback;
}
function getXdexAuthority(programId = XDEX_PROGRAM) {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('vault_and_lp_mint_auth_seed')], pk(programId))[0];
}
function getAtaForProgram(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], pk('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0];
}
function getMetadataPda(mintPubkey) {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('metadata'), pk(METADATA_PROG).toBuffer(), mintPubkey.toBuffer()], pk(METADATA_PROG))[0];
}
function buildTokenMetadataUri(name, symbol, description) {
  const payload = { name, symbol };
  if (description) payload.description = description;
  return trimUtf8('data:application/json,' + encodeURIComponent(JSON.stringify(payload)), 200, '');
}
function parseXdexPoolState(poolPk, data) {
  let o = 8;
  const ammConfigPk = readPubkey(data, o); o += 32;
  const poolCreatorPk = readPubkey(data, o); o += 32;
  const token0VaultPk = readPubkey(data, o); o += 32;
  const token1VaultPk = readPubkey(data, o); o += 32;
  const lpMintPk = readPubkey(data, o); o += 32;
  const token0MintPk = readPubkey(data, o); o += 32;
  const token1MintPk = readPubkey(data, o); o += 32;
  const token0ProgramPk = readPubkey(data, o); o += 32;
  const token1ProgramPk = readPubkey(data, o); o += 32;
  const observationPk = readPubkey(data, o); o += 32;
  const authBump = data[o], status = data[o + 1], lpMintDecimals = data[o + 2], mint0Decimals = data[o + 3], mint1Decimals = data[o + 4]; o += 5;
  const lpSupply = readU64LE(data, o); o += 8;
  const protocolFeesToken0 = readU64LE(data, o); o += 8;
  const protocolFeesToken1 = readU64LE(data, o); o += 8;
  const fundFeesToken0 = readU64LE(data, o); o += 8;
  const fundFeesToken1 = readU64LE(data, o); o += 8;
  const openTime = readU64LE(data, o); o += 8;
  const recentEpoch = readU64LE(data, o);
  return { poolStatePk: poolPk, ammConfigPk, poolCreatorPk, token0VaultPk, token1VaultPk, lpMintPk, token0MintPk, token1MintPk, token0ProgramPk, token1ProgramPk, observationPk, authBump, status, lpMintDecimals, mint0Decimals, mint1Decimals, lpSupply, protocolFeesToken0, protocolFeesToken1, fundFeesToken0, fundFeesToken1, openTime, recentEpoch };
}
async function getMintProgramAndDecimals(c, mint) {
  const mintPk = mint instanceof PublicKey ? mint : pk(mint);
  const info = await c.getParsedAccountInfo(mintPk);
  if (!info.value) throw new Error(`Mint not found: ${mintPk.toBase58()}`);
  const owner = info.value.owner;
  const decimals = info.value.data?.parsed?.info?.decimals;
  if (decimals == null) throw new Error(`Could not parse mint decimals: ${mintPk.toBase58()}`);
  return { mint: mintPk.toBase58(), program: owner.toBase58(), decimals };
}
async function getXdexPoolInfo(c, poolState) {
  const poolPk = pk(poolState);
  const poolInfo = await c.getAccountInfo(poolPk);
  if (!poolInfo?.data) throw new Error(`XDEX pool unavailable: ${poolPk.toBase58()}`);
  const state = parseXdexPoolState(poolPk, poolInfo.data);
  const [vault0, vault1] = await Promise.all([c.getTokenAccountBalance(state.token0VaultPk), c.getTokenAccountBalance(state.token1VaultPk)]);
  const vault0Raw = BigInt(vault0.value.amount), vault1Raw = BigInt(vault1.value.amount);
  const reserve0Raw = vault0Raw - state.protocolFeesToken0 - state.fundFeesToken0;
  const reserve1Raw = vault1Raw - state.protocolFeesToken1 - state.fundFeesToken1;
  const wsolPk = pk(WXNT_MINT);
  const xntIsToken0 = state.token0MintPk.equals(wsolPk), xntIsToken1 = state.token1MintPk.equals(wsolPk);
  const xntIndex = xntIsToken0 ? 0 : (xntIsToken1 ? 1 : null);
  const tokenIndex = xntIndex === 0 ? 1 : (xntIndex === 1 ? 0 : null);
  const xntReserveRaw = xntIndex === 0 ? reserve0Raw : (xntIndex === 1 ? reserve1Raw : null);
  const tokenReserveRaw = xntIndex === 0 ? reserve1Raw : (xntIndex === 1 ? reserve0Raw : null);
  const xntDecimals = xntIndex === 0 ? state.mint0Decimals : (xntIndex === 1 ? state.mint1Decimals : null);
  const tokenDecimals = tokenIndex === 0 ? state.mint0Decimals : (tokenIndex === 1 ? state.mint1Decimals : null);
  return {
    poolState: poolPk.toBase58(),
    ammConfig: state.ammConfigPk.toBase58(), poolCreator: state.poolCreatorPk.toBase58(), authority: getXdexAuthority().toBase58(), observation: state.observationPk.toBase58(),
    status: state.status, authBump: state.authBump,
    lpMint: state.lpMintPk.toBase58(), lpDecimals: state.lpMintDecimals, lpSupply: state.lpSupply, lpSupplyUi: toUiAmount(state.lpSupply, state.lpMintDecimals),
    token0Mint: state.token0MintPk.toBase58(), token1Mint: state.token1MintPk.toBase58(), token0Program: state.token0ProgramPk.toBase58(), token1Program: state.token1ProgramPk.toBase58(),
    token0Vault: state.token0VaultPk.toBase58(), token1Vault: state.token1VaultPk.toBase58(), mint0Decimals: state.mint0Decimals, mint1Decimals: state.mint1Decimals,
    reserve0Raw, reserve1Raw, reserve0Ui: toUiAmount(reserve0Raw, state.mint0Decimals), reserve1Ui: toUiAmount(reserve1Raw, state.mint1Decimals),
    protocolFeesToken0: state.protocolFeesToken0, protocolFeesToken1: state.protocolFeesToken1, fundFeesToken0: state.fundFeesToken0, fundFeesToken1: state.fundFeesToken1,
    isXntPool: xntIndex != null, xntIndex, tokenIndex,
    xntMint: xntIndex === 0 ? state.token0MintPk.toBase58() : (xntIndex === 1 ? state.token1MintPk.toBase58() : null),
    tokenMint: tokenIndex === 0 ? state.token0MintPk.toBase58() : (tokenIndex === 1 ? state.token1MintPk.toBase58() : null),
    xntDecimals, tokenDecimals, xntReserveRaw, tokenReserveRaw,
    xntReserveUi: xntReserveRaw == null ? null : toUiAmount(xntReserveRaw, xntDecimals), tokenReserveUi: tokenReserveRaw == null ? null : toUiAmount(tokenReserveRaw, tokenDecimals),
    openTime: state.openTime, recentEpoch: state.recentEpoch,
  };
}
function computeLpTokenAmounts(lpAmount, reserve0Raw, reserve1Raw, lpSupply, roundUp) {
  let token0 = lpAmount * reserve0Raw / lpSupply;
  let token1 = lpAmount * reserve1Raw / lpSupply;
  if (roundUp) {
    if (lpAmount * reserve0Raw % lpSupply > 0n && token0 > 0n) token0 += 1n;
    if (lpAmount * reserve1Raw % lpSupply > 0n && token1 > 0n) token1 += 1n;
  }
  return { token0Raw: token0, token1Raw: token1 };
}
async function quoteAddLiquidity(args) {
  const c = conn();
  const info = await getXdexPoolInfo(c, need(args, 'pool'));
  if (!info.isXntPool) throw new Error('Pool is not an XNT/token pool');
  const desiredXntRaw = uiAmountToRaw(need(args, 'xnt'), info.xntDecimals);
  if (desiredXntRaw <= 0n || info.lpSupply <= 0n || info.xntReserveRaw <= 0n) throw new Error('Pool/deposit amount unusable');
  const lpRaw = desiredXntRaw * info.lpSupply / info.xntReserveRaw;
  const amounts = computeLpTokenAmounts(lpRaw, info.reserve0Raw, info.reserve1Raw, info.lpSupply, true);
  const xntRaw = info.xntIndex === 0 ? amounts.token0Raw : amounts.token1Raw;
  const tokenRaw = info.xntIndex === 0 ? amounts.token1Raw : amounts.token0Raw;
  return { dry_run: true, state_changing: false, poolState: info.poolState, xntInput: Number(args.xnt), requiredXnt: toUiAmount(xntRaw, info.xntDecimals), requiredToken: toUiAmount(tokenRaw, info.tokenDecimals), estimatedLp: toUiAmount(lpRaw, info.lpDecimals), xntRaw, tokenRaw, lpRaw, poolSummary: { reserveXnt: info.xntReserveUi, reserveToken: info.tokenReserveUi, lpSupply: info.lpSupplyUi }, note: 'Quote only. No signing or transaction submission.' };
}
async function quoteRemoveLiquidity(args) {
  const c = conn();
  const info = await getXdexPoolInfo(c, need(args, 'pool'));
  if (!info.isXntPool) throw new Error('Pool is not an XNT/token pool');
  const lpRaw = uiAmountToRaw(need(args, 'lp'), info.lpDecimals);
  const amounts = computeLpTokenAmounts(lpRaw, info.reserve0Raw, info.reserve1Raw, info.lpSupply, false);
  const xntRaw = info.xntIndex === 0 ? amounts.token0Raw : amounts.token1Raw;
  const tokenRaw = info.xntIndex === 0 ? amounts.token1Raw : amounts.token0Raw;
  return { dry_run: true, state_changing: false, poolState: info.poolState, lpInput: Number(args.lp), estimatedXnt: toUiAmount(xntRaw, info.xntDecimals), estimatedToken: toUiAmount(tokenRaw, info.tokenDecimals), xntRaw, tokenRaw, lpRaw, poolSummary: { reserveXnt: info.xntReserveUi, reserveToken: info.tokenReserveUi, lpSupply: info.lpSupplyUi }, note: 'Quote only. No signing or transaction submission.' };
}
async function dryRunCreatePool(args) {
  const c = conn();
  const wallet = pk(need(args, 'wallet'));
  const tokenMint = pk(need(args, 'token-mint'));
  const tokenInfo = await getMintProgramAndDecimals(c, tokenMint);
  const rawXnt = uiAmountToRaw(need(args, 'xnt'), 9);
  const rawToken = uiAmountToRaw(need(args, 'token'), tokenInfo.decimals);
  const wsolMint = pk(WXNT_MINT);
  let mint0, mint1, raw0, raw1, prog0, prog1;
  if (Buffer.compare(wsolMint.toBuffer(), tokenMint.toBuffer()) < 0) { mint0 = wsolMint; mint1 = tokenMint; raw0 = rawXnt; raw1 = rawToken; prog0 = pk(TOKEN_PROG); prog1 = pk(tokenInfo.program); }
  else { mint0 = tokenMint; mint1 = wsolMint; raw0 = rawToken; raw1 = rawXnt; prog0 = pk(tokenInfo.program); prog1 = pk(TOKEN_PROG); }
  const programPk = pk(XDEX_PROGRAM);
  const configIndex = args['config-index'] ? Number(args['config-index']) : null;
  let resolvedConfigIndex = configIndex;
  if (!resolvedConfigIndex) {
    for (let idx = 1; idx <= XDEX_MAX_CONFIG_INDEX; idx++) {
      const amm = PublicKey.findProgramAddressSync([new TextEncoder().encode('amm_config'), writeU16BE(idx)], programPk)[0];
      const pool = PublicKey.findProgramAddressSync([new TextEncoder().encode('pool'), amm.toBuffer(), mint0.toBuffer(), mint1.toBuffer()], programPk)[0];
      const info = await c.getAccountInfo(pool);
      if (!info) { resolvedConfigIndex = idx; break; }
    }
  }
  if (!resolvedConfigIndex) throw new Error('No available config index found');
  const ammConfig = PublicKey.findProgramAddressSync([new TextEncoder().encode('amm_config'), writeU16BE(resolvedConfigIndex)], programPk)[0];
  const poolState = PublicKey.findProgramAddressSync([new TextEncoder().encode('pool'), ammConfig.toBuffer(), mint0.toBuffer(), mint1.toBuffer()], programPk)[0];
  const lpMint = PublicKey.findProgramAddressSync([new TextEncoder().encode('pool_lp_mint'), poolState.toBuffer()], programPk)[0];
  const vault0 = PublicKey.findProgramAddressSync([new TextEncoder().encode('pool_vault'), poolState.toBuffer(), mint0.toBuffer()], programPk)[0];
  const vault1 = PublicKey.findProgramAddressSync([new TextEncoder().encode('pool_vault'), poolState.toBuffer(), mint1.toBuffer()], programPk)[0];
  const observation = PublicKey.findProgramAddressSync([new TextEncoder().encode('observation'), poolState.toBuffer()], programPk)[0];
  return { dry_run: true, state_changing: false, action: 'create_pool_preview', wallet: wallet.toBase58(), tokenMint: tokenMint.toBase58(), tokenProgram: tokenInfo.program, tokenDecimals: tokenInfo.decimals, xntAmount: Number(args.xnt), tokenAmount: Number(args.token), rawXnt, rawToken, mint0: mint0.toBase58(), mint1: mint1.toBase58(), raw0, raw1, program0: prog0.toBase58(), program1: prog1.toBase58(), configIndex: resolvedConfigIndex, ammConfig: ammConfig.toBase58(), poolState: poolState.toBase58(), authority: getXdexAuthority().toBase58(), lpMint: lpMint.toBase58(), vault0: vault0.toBase58(), vault1: vault1.toBase58(), observation: observation.toBase58(), createPoolFee: XDEX_CREATE_POOL_FEE, note: 'Dry-run/PDA preview only. No signing or transaction submission.' };
}
async function walletTokens(args) {
  const c = conn();
  const wallet = pk(need(args, 'wallet'));
  const [native, parsed] = await Promise.all([c.getBalance(wallet), c.getParsedTokenAccountsByOwner(wallet, { programId: pk(TOKEN_PROG) })]);
  return { wallet: wallet.toBase58(), native_xnt: native / 1e9, lamports: native, spl_tokens: parsed.value.map(x => ({ account: x.pubkey.toBase58(), mint: x.account.data.parsed.info.mint, owner: x.account.data.parsed.info.owner, amount: x.account.data.parsed.info.tokenAmount.amount, uiAmount: x.account.data.parsed.info.tokenAmount.uiAmount, decimals: x.account.data.parsed.info.tokenAmount.decimals })) };
}

async function createToken(args) {
  const c = conn();
  const walletPreview = executionApproved(args) ? null : (args.wallet || null);
  const finalName = trimUtf8(need(args, 'name'), 32, 'X1 Token');
  const finalSymbol = trimUtf8(need(args, 'symbol'), 10, 'TOKEN');
  const decimals = args.decimals == null ? 9 : Number(args.decimals);
  const supply = args.supply == null ? 1000000 : Number(args.supply);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) throw new Error('Invalid --decimals; use integer 0..9');
  if (!Number.isFinite(supply) || supply <= 0) throw new Error('Invalid --supply');
  const finalUri = trimUtf8(args.uri || buildTokenMetadataUri(finalName, finalSymbol, trimUtf8(args.description || '', 120, '')), 200, '');
  const rawSupply = uiAmountToRaw(supply, decimals);
  const preview = { dry_run: !executionApproved(args), state_changing: true, action: 'create_token', wallet: walletPreview, name: finalName, symbol: finalSymbol, decimals, supply, rawSupply, metadata_uri: finalUri, requires: ['--execute', '--confirm-execute'], note: 'Creates SPL mint, owner ATA, mints initial supply, and writes on-chain metadata.' };
  if (!executionApproved(args)) return { ...preview, dry_run_secret_access: false };
  const kp = loadKeypair(need(args, 'keypair'));
  preview.wallet = kp.publicKey.toBase58();
  const mint = Keypair.generate();
  const lamports = await c.getMinimumBalanceForRentExemption(82);
  const ownerAta = getAtaForProgram(kp.publicKey, mint.publicKey, pk(TOKEN_PROG));
  const tx = new Transaction();
  tx.add(SystemProgram.createAccount({ fromPubkey: kp.publicKey, newAccountPubkey: mint.publicKey, space: 82, lamports, programId: pk(TOKEN_PROG) }));
  tx.add(createInitializeMintInstruction(mint.publicKey, decimals, kp.publicKey, kp.publicKey));
  tx.add(createAtaInstruction(kp.publicKey, ownerAta, kp.publicKey, mint.publicKey, pk(ASSOC_PROG), pk(TOKEN_PROG), false));
  tx.add(createMintToInstruction(mint.publicKey, ownerAta, kp.publicKey, rawSupply));
  tx.add(createTokenMetadataInstruction(mint.publicKey, kp.publicKey, finalName, finalSymbol, finalUri));
  const sig = await sendSignedTx(c, tx, [kp, mint]);
  const receipt = args['hxmp-receipt'] !== undefined ? await maybeHxmpReceipt(c, kp, 'token.create', sig, { mint: mint.publicKey.toBase58(), sym: finalSymbol }) : null;
  return { ...preview, dry_run: false, executed: true, signature: sig, explorer: explorer(sig), mint: mint.publicKey.toBase58(), ownerAta: ownerAta.toBase58(), metadataPda: getMetadataPda(mint.publicKey).toBase58(), hxmp_receipt: receipt };
}

function createTokenMetadataInstruction(mintPubkey, authorityPubkey, name, symbol, uri) {
  const nameField = encodeBorshString(name, 32, 'X1 Token');
  const symbolField = encodeBorshString(symbol, 10, 'TOKEN');
  const uriField = encodeBorshString(uri, 200, '');
  const data = concatBytes(new Uint8Array([33]), nameField.bytes, symbolField.bytes, uriField.bytes, writeU16LE(0), new Uint8Array([0]), new Uint8Array([0]), new Uint8Array([0]), new Uint8Array([1]), new Uint8Array([0]));
  return new TransactionInstruction({ programId: pk(METADATA_PROG), keys: [{ pubkey: getMetadataPda(mintPubkey), isSigner: false, isWritable: true }, { pubkey: mintPubkey, isSigner: false, isWritable: false }, { pubkey: authorityPubkey, isSigner: true, isWritable: false }, { pubkey: authorityPubkey, isSigner: true, isWritable: true }, { pubkey: authorityPubkey, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }], data });
}

async function createPool(args) {
  if (!executionApproved(args) && !args.wallet) throw new Error('Dry-run create-pool requires --wallet and never reads --keypair.');
  const kpForExecution = executionApproved(args) ? loadKeypair(need(args, 'keypair')) : null;
  const previewWallet = args.wallet || kpForExecution.publicKey.toBase58();
  const preview = await dryRunCreatePool({ ...args, wallet: previewWallet });
  if (!executionApproved(args)) return { ...preview, dry_run: true, state_changing: true, action: 'create_pool', requires: ['--execute', '--confirm-execute'], dry_run_secret_access: false };
  const c = conn(); const kp = kpForExecution;
  const tokenMint = pk(need(args, 'token-mint')); const tokenInfo = await getMintProgramAndDecimals(c, tokenMint);
  const wsolMint = pk(WXNT_MINT); const tokenProgramPk = pk(TOKEN_PROG); const assocProgramPk = pk(ASSOC_PROG); const xdexProgramPk = pk(XDEX_PROGRAM); const createPoolFeePk = pk(XDEX_CREATE_POOL_FEE);
  const rawXnt = uiAmountToRaw(need(args, 'xnt'), 9); const rawToken = uiAmountToRaw(need(args, 'token'), tokenInfo.decimals);
  let mint0, mint1, raw0, raw1, prog0, prog1;
  if (Buffer.compare(wsolMint.toBuffer(), tokenMint.toBuffer()) < 0) { mint0=wsolMint; mint1=tokenMint; raw0=rawXnt; raw1=rawToken; prog0=tokenProgramPk; prog1=pk(tokenInfo.program); }
  else { mint0=tokenMint; mint1=wsolMint; raw0=rawToken; raw1=rawXnt; prog0=pk(tokenInfo.program); prog1=tokenProgramPk; }
  const idx = preview.configIndex;
  const ammConfig = pk(preview.ammConfig), poolState = pk(preview.poolState), authority = pk(preview.authority), lpMint = pk(preview.lpMint), vault0 = pk(preview.vault0), vault1 = pk(preview.vault1), observation = pk(preview.observation);
  const wsolAta = getAtaForProgram(kp.publicKey, wsolMint, tokenProgramPk); const newTokenAta = getAtaForProgram(kp.publicKey, tokenMint, pk(tokenInfo.program));
  const creatorToken0 = mint0.equals(wsolMint) ? wsolAta : newTokenAta; const creatorToken1 = mint0.equals(wsolMint) ? newTokenAta : wsolAta; const creatorLpToken = getAtaForProgram(kp.publicKey, lpMint, tokenProgramPk);
  const tx = new Transaction();
  tx.add(createAtaInstruction(kp.publicKey, wsolAta, kp.publicKey, wsolMint, assocProgramPk, tokenProgramPk));
  tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: wsolAta, lamports: Number(rawXnt) }));
  tx.add(createSyncNativeInstruction(wsolAta));
  tx.add(createAtaInstruction(kp.publicKey, newTokenAta, kp.publicKey, tokenMint, assocProgramPk, pk(tokenInfo.program)));
  const initData = new Uint8Array(32); XDEX_INITIALIZE_IX.forEach((b,i)=>initData[i]=b); const dv = new DataView(initData.buffer); dv.setBigUint64(8, raw0, true); dv.setBigUint64(16, raw1, true); dv.setBigUint64(24, BigInt(Math.floor(Date.now()/1000)), true);
  tx.add(new TransactionInstruction({ programId: xdexProgramPk, data: initData, keys: [{pubkey:kp.publicKey,isSigner:true,isWritable:true},{pubkey:ammConfig,isSigner:false,isWritable:false},{pubkey:authority,isSigner:false,isWritable:false},{pubkey:poolState,isSigner:false,isWritable:true},{pubkey:mint0,isSigner:false,isWritable:false},{pubkey:mint1,isSigner:false,isWritable:false},{pubkey:lpMint,isSigner:false,isWritable:true},{pubkey:creatorToken0,isSigner:false,isWritable:true},{pubkey:creatorToken1,isSigner:false,isWritable:true},{pubkey:creatorLpToken,isSigner:false,isWritable:true},{pubkey:vault0,isSigner:false,isWritable:true},{pubkey:vault1,isSigner:false,isWritable:true},{pubkey:createPoolFeePk,isSigner:false,isWritable:true},{pubkey:observation,isSigner:false,isWritable:true},{pubkey:tokenProgramPk,isSigner:false,isWritable:false},{pubkey:prog0,isSigner:false,isWritable:false},{pubkey:prog1,isSigner:false,isWritable:false},{pubkey:assocProgramPk,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:pk('SysvarRent111111111111111111111111111111111'),isSigner:false,isWritable:false}] }));
  const sig = await sendSignedTx(c, tx, [kp]);
  const receipt = args['hxmp-receipt'] !== undefined ? await maybeHxmpReceipt(c, kp, 'liquidity.create_pool', sig, { pool: poolState.toBase58(), mint: tokenMint.toBase58() }) : null;
  return { ...preview, dry_run: false, executed: true, action: 'create_pool', signature: sig, explorer: explorer(sig), hxmp_receipt: receipt };
}

async function addLiquidity(args) {
  const c = conn(); const info = await getXdexPoolInfo(c, need(args, 'pool')); const quote = await quoteAddLiquidity({ pool: info.poolState, xnt: need(args, 'xnt') });
  const slip = Math.max(0, Math.round(Number(args['slippage-bps'] ?? 300) || 0));
  if (!executionApproved(args)) return { ...quote, state_changing: true, action: 'add_liquidity', slippageBps: slip, requires: ['--execute', '--confirm-execute'] };
  const kp = loadKeypair(need(args, 'keypair')); const tokenProgramPk = pk(TOKEN_PROG), token2022Pk = pk(TOKEN_2022_PROG), assocProgramPk = pk(ASSOC_PROG);
  const xntAta = getAtaForProgram(kp.publicKey, pk(info.xntMint), tokenProgramPk), tokenAta = getAtaForProgram(kp.publicKey, pk(info.tokenMint), pk(info.tokenProgram)), lpAta = getAtaForProgram(kp.publicKey, pk(info.lpMint), tokenProgramPk);
  const [xntAcc, tokenAcc, lpAcc] = await Promise.all([c.getAccountInfo(xntAta), c.getAccountInfo(tokenAta), c.getAccountInfo(lpAta)]);
  const xntBal = xntAcc ? BigInt((await c.getTokenAccountBalance(xntAta)).value.amount) : 0n; const tokenBal = tokenAcc ? BigInt((await c.getTokenAccountBalance(tokenAta)).value.amount) : 0n;
  const maxToken0 = applySlippageUp(quote.token0Raw, slip), maxToken1 = applySlippageUp(quote.token1Raw, slip), requiredTokenRaw = info.xntIndex === 0 ? maxToken1 : maxToken0;
  if (tokenBal < requiredTokenRaw) throw new Error(`Not enough paired token; need ${toUiAmount(requiredTokenRaw, info.tokenDecimals)}`);
  const xntMaxRaw = info.xntIndex === 0 ? maxToken0 : maxToken1; const topUpXnt = xntMaxRaw > xntBal ? xntMaxRaw - xntBal : 0n;
  const tx = new Transaction(); if (!xntAcc) tx.add(createAtaInstruction(kp.publicKey, xntAta, kp.publicKey, pk(info.xntMint), assocProgramPk, tokenProgramPk)); if (!tokenAcc) tx.add(createAtaInstruction(kp.publicKey, tokenAta, kp.publicKey, pk(info.tokenMint), assocProgramPk, pk(info.tokenProgram))); if (!lpAcc) tx.add(createAtaInstruction(kp.publicKey, lpAta, kp.publicKey, pk(info.lpMint), assocProgramPk, tokenProgramPk)); if (topUpXnt > 0n) { tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: xntAta, lamports: Number(topUpXnt) })); tx.add(createSyncNativeInstruction(xntAta)); }
  const data = new Uint8Array(32); XDEX_DEPOSIT_IX.forEach((b,i)=>data[i]=b); const dv = new DataView(data.buffer); dv.setBigUint64(8, quote.lpRaw, true); dv.setBigUint64(16, maxToken0, true); dv.setBigUint64(24, maxToken1, true);
  const userToken0 = info.xntIndex === 0 ? xntAta : tokenAta, userToken1 = info.xntIndex === 0 ? tokenAta : xntAta;
  tx.add(new TransactionInstruction({ programId: pk(XDEX_PROGRAM), keys: [{pubkey:kp.publicKey,isSigner:true,isWritable:false},{pubkey:pk(info.authority),isSigner:false,isWritable:false},{pubkey:pk(info.poolState),isSigner:false,isWritable:true},{pubkey:lpAta,isSigner:false,isWritable:true},{pubkey:userToken0,isSigner:false,isWritable:true},{pubkey:userToken1,isSigner:false,isWritable:true},{pubkey:pk(info.token0Vault),isSigner:false,isWritable:true},{pubkey:pk(info.token1Vault),isSigner:false,isWritable:true},{pubkey:tokenProgramPk,isSigner:false,isWritable:false},{pubkey:token2022Pk,isSigner:false,isWritable:false},{pubkey:pk(info.token0Mint),isSigner:false,isWritable:false},{pubkey:pk(info.token1Mint),isSigner:false,isWritable:false},{pubkey:pk(info.lpMint),isSigner:false,isWritable:true}], data }));
  const sig = await sendSignedTx(c, tx, [kp]); const receipt = args['hxmp-receipt'] !== undefined ? await maybeHxmpReceipt(c, kp, 'liquidity.add', sig, { pool: info.poolState, xnt: quote.requiredXnt, token: quote.requiredToken }) : null;
  return { ...quote, dry_run: false, executed: true, action: 'add_liquidity', signature: sig, explorer: explorer(sig), slippageBps: slip, hxmp_receipt: receipt };
}

async function removeLiquidity(args) {
  const c = conn(); const info = await getXdexPoolInfo(c, need(args, 'pool')); const quote = await quoteRemoveLiquidity({ pool: info.poolState, lp: need(args, 'lp') }); const slip = Math.max(0, Math.round(Number(args['slippage-bps'] ?? 300) || 0));
  if (!executionApproved(args)) return { ...quote, state_changing: true, action: 'remove_liquidity', slippageBps: slip, requires: ['--execute', '--confirm-execute'] };
  const kp = loadKeypair(need(args, 'keypair')); const tokenProgramPk = pk(TOKEN_PROG), token2022Pk = pk(TOKEN_2022_PROG), assocProgramPk = pk(ASSOC_PROG);
  const xntAta = getAtaForProgram(kp.publicKey, pk(info.xntMint), tokenProgramPk), tokenAta = getAtaForProgram(kp.publicKey, pk(info.tokenMint), pk(info.tokenProgram)), lpAta = getAtaForProgram(kp.publicKey, pk(info.lpMint), tokenProgramPk);
  const [xntAcc, tokenAcc, lpAcc] = await Promise.all([c.getAccountInfo(xntAta), c.getAccountInfo(tokenAta), c.getAccountInfo(lpAta)]); if (!lpAcc) throw new Error('No LP token account found'); const lpBal = BigInt((await c.getTokenAccountBalance(lpAta)).value.amount); if (lpBal < quote.lpRaw) throw new Error('Not enough LP tokens');
  const tx = new Transaction(); if (!xntAcc) tx.add(createAtaInstruction(kp.publicKey, xntAta, kp.publicKey, pk(info.xntMint), assocProgramPk, tokenProgramPk)); if (!tokenAcc) tx.add(createAtaInstruction(kp.publicKey, tokenAta, kp.publicKey, pk(info.tokenMint), assocProgramPk, pk(info.tokenProgram)));
  const minToken0 = applySlippageDown(quote.token0Raw, slip), minToken1 = applySlippageDown(quote.token1Raw, slip); const data = new Uint8Array(32); XDEX_WITHDRAW_IX.forEach((b,i)=>data[i]=b); const dv = new DataView(data.buffer); dv.setBigUint64(8, quote.lpRaw, true); dv.setBigUint64(16, minToken0, true); dv.setBigUint64(24, minToken1, true);
  const userToken0 = info.xntIndex === 0 ? xntAta : tokenAta, userToken1 = info.xntIndex === 0 ? tokenAta : xntAta;
  tx.add(new TransactionInstruction({ programId: pk(XDEX_PROGRAM), keys: [{pubkey:kp.publicKey,isSigner:true,isWritable:false},{pubkey:pk(info.authority),isSigner:false,isWritable:false},{pubkey:pk(info.poolState),isSigner:false,isWritable:true},{pubkey:lpAta,isSigner:false,isWritable:true},{pubkey:userToken0,isSigner:false,isWritable:true},{pubkey:userToken1,isSigner:false,isWritable:true},{pubkey:pk(info.token0Vault),isSigner:false,isWritable:true},{pubkey:pk(info.token1Vault),isSigner:false,isWritable:true},{pubkey:tokenProgramPk,isSigner:false,isWritable:false},{pubkey:token2022Pk,isSigner:false,isWritable:false},{pubkey:pk(info.token0Mint),isSigner:false,isWritable:false},{pubkey:pk(info.token1Mint),isSigner:false,isWritable:false},{pubkey:pk(info.lpMint),isSigner:false,isWritable:true},{pubkey:pk(SPL_MEMO_PROGRAM),isSigner:false,isWritable:false}], data }));
  const sig = await sendSignedTx(c, tx, [kp]); const receipt = args['hxmp-receipt'] !== undefined ? await maybeHxmpReceipt(c, kp, 'liquidity.remove', sig, { pool: info.poolState, lp: quote.lpInput }) : null;
  return { ...quote, dry_run: false, executed: true, action: 'remove_liquidity', signature: sig, explorer: explorer(sig), slippageBps: slip, hxmp_receipt: receipt };
}

function dryRunTokenMetadata(args) {
  const name = need(args, 'name');
  const symbol = need(args, 'symbol');
  const description = args.description || '';
  const uri = buildTokenMetadataUri(name, symbol, description);
  return { dry_run: true, state_changing: false, name: trimUtf8(name, 32, 'X1 Token'), symbol: trimUtf8(symbol, 10, 'TOKEN'), description, metadata_uri: uri, metadata_uri_bytes: new TextEncoder().encode(uri).length, warning: 'Preview only. Token mint/metadata creation is not implemented in this safe tool.' };
}
async function rpcHealth() { const c = conn(); return { ok: true, rpc: X1_RPC, slot: await c.getSlot(), version: await c.getVersion() }; }
function printJson(x) { console.log(JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)); }
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) { usage(); return; }
  if (cmd === 'rpc-health') printJson(await rpcHealth());
  else if (cmd === 'wallet-tokens') printJson(await walletTokens(args));
  else if (cmd === 'pool-info') printJson(await getXdexPoolInfo(conn(), need(args, 'pool')));
  else if (cmd === 'quote-add-liquidity') printJson(await quoteAddLiquidity(args));
  else if (cmd === 'quote-remove-liquidity') printJson(await quoteRemoveLiquidity(args));
  else if (cmd === 'dry-run-token-metadata') printJson(dryRunTokenMetadata(args));
  else if (cmd === 'dry-run-create-pool') printJson(await dryRunCreatePool(args));
  else if (cmd === 'create-token') printJson(await createToken(args));
  else if (cmd === 'create-pool') printJson(await createPool(args));
  else if (cmd === 'add-liquidity') printJson(await addLiquidity(args));
  else if (cmd === 'remove-liquidity') printJson(await removeLiquidity(args));
  else throw new Error(`Unknown command: ${cmd}`);
}
main().catch(err => { console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2)); process.exit(1); });
