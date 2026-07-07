#!/usr/bin/env node
// HXMP v0 tool layer for X1 memo-backed encrypted agent memory.
//
// Safety model:
// - dry-run-soul, read-soul, scan-manifest, wallet-status, rpc-health are read-only.
// - write-soul signs/sends only with --execute AND --confirm-write plus an exact expected SHA-256.
// - secret key bytes and encryption key bytes are never printed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  sendAndConfirmRawTransaction,
} from '@solana/web3.js';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const X1_EXPLORER = 'https://explorer.x1.xyz';
const AGENTID_API = 'https://agentid-app.vercel.app/api';
const AGENTID_PROGRAM = '7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MAX_SOURCE_BYTES = 8192; // HXMP v0 hard plaintext/source cap per write.
const MAX_CHUNKS = 32; // Hard cap to prevent runaway multi-tx writes.
const CHUNK_CIPHERTEXT_CHARS = 80;
const MAX_MEMO_BYTES = 520;
const MAX_TX_BYTES = 1232; // Solana legacy transaction packet limit.
const DEFAULT_PROFILE = process.env.HERMES_PROFILE || 'default';

function usage() {
  console.log(`HXMP X1 tool

Commands:
  rpc-health
  wallet-status --wallet <pubkey>
  dry-run-soul --wallet <pubkey> [--profile default] [--source SOUL.md] [--manifest]
  soul-status --wallet <pubkey> [--profile default] [--source SOUL.md] [--limit 80]
  write-soul --keypair <id.json> --encryption-key <keyfile> --expected-sha256 sha256:<hex> --execute --confirm-write [--source SOUL.md] [--manifest] [--create-encryption-key]
  read-soul --wallet <pubkey> --encryption-key <keyfile> [--show-content]
  scan-manifest --wallet <pubkey> [--limit 50]
  agentid-nft-image --wallet <pubkey> [--out card.svg]
  init-encryption-key --encryption-key <keyfile>
  backup-encryption-key --encryption-key <keyfile> --wallet <pubkey> [--profile default] [--method keychain|file]
  restore-encryption-key --encryption-key <keyfile> --wallet <pubkey> [--profile default]

State-changing write-soul requires:
  --execute --confirm-write --expected-sha256 sha256:<hash-from-dry-run>
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    if (['execute', 'confirm-write', 'manifest', 'show-content', 'create-encryption-key', 'json'].includes(k)) out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
}
function need(args, k) { if (!args[k]) throw new Error(`Missing --${k}`); return args[k]; }
function conn() { return new Connection(X1_RPC, 'confirmed'); }
function pk(s) { return new PublicKey(s); }
function nowIso() { return new Date().toISOString(); }
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function fromB64url(s) { return Buffer.from(s, 'base64url'); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sha256Label(buf) { return `sha256:${sha256(buf)}`; }
function fileHashIfExists(file) {
  try { const p = expandHome(file); return fs.existsSync(p) ? sha256Label(fs.readFileSync(p)) : null; } catch { return null; }
}
function compactPath(file) {
  if (!file) return null;
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}
function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }
function expandHome(p) { return p?.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p; }

function hermesHomeForProfile(profile = DEFAULT_PROFILE) {
  // Explicit profile wins. This lets one agent prepare profile files even when
  // the current process HERMES_HOME is the default profile.
  if (profile && profile !== 'default') return path.join(os.homedir(), '.hermes', 'profiles', profile);
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  return path.join(os.homedir(), '.hermes');
}
function defaultSoulPath(profile = DEFAULT_PROFILE) {
  return path.join(hermesHomeForProfile(profile), 'SOUL.md');
}
function defaultIndexPath(profile = DEFAULT_PROFILE) {
  const home = profile === 'default' ? path.join(os.homedir(), '.hermes') : path.join(os.homedir(), '.hermes', 'x1', profile);
  return path.join(home, 'index.json');
}
function loadKeypair(file) {
  const p = expandHome(file);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Keypair file must be a Solana id.json array');
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
function initEncryptionKey(file) {
  const p = expandHome(file);
  if (fs.existsSync(p)) return { path: p, created: false, note: 'existing key left untouched' };
  ensureDir(p);
  const key = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(p, key + '\n', { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch {}
  return { path: p, created: true, mode: '0600' };
}
function loadEncryptionKey(file, create = false) {
  const p = expandHome(file);
  if (!fs.existsSync(p)) {
    if (!create) throw new Error(`Encryption key missing: ${p}. Run init-encryption-key or pass --create-encryption-key.`);
    initEncryptionKey(p);
  }
  const text = fs.readFileSync(p, 'utf8').trim();
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(text)) key = Buffer.from(text, 'hex');
  else key = Buffer.from(text, 'base64url');
  if (key.length !== 32) throw new Error('Encryption key must decode to 32 bytes');
  return key;
}
function encryptionKeyText(file) {
  const p = expandHome(file);
  const text = fs.readFileSync(p, 'utf8').trim();
  const key = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64url');
  if (key.length !== 32) throw new Error('Encryption key must decode to 32 bytes');
  return { path: p, text, fingerprint: sha256Label(key).slice(0, 24) };
}
function keychainAccount(wallet, profile = DEFAULT_PROFILE) { return `hxmp:${profile}:${wallet}`; }
function keychainService() { return 'HXMP Encryption Key'; }
function commandExists(cmd) {
  const r = spawnSync('/usr/bin/which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}
function backupEncryptionKey(args) {
  const wallet = need(args, 'wallet');
  const profile = args.profile || DEFAULT_PROFILE;
  const method = args.method || 'keychain';
  const key = encryptionKeyText(need(args, 'encryption-key'));
  const account = keychainAccount(wallet, profile);
  if (method === 'keychain' && commandExists('security')) {
    // Do not pass the key as a command-line argument where it can appear in process listings.
    // macOS security reads the password from stdin when -w is omitted.
    const r = spawnSync('security', ['add-generic-password', '-U', '-a', account, '-s', keychainService()], { encoding: 'utf8', input: `${key.text}\n` });
    if (r.status !== 0) throw new Error(`macOS Keychain backup failed: ${r.stderr || r.stdout}`);
    return { ok: true, method: 'macos-keychain-stdin', service: keychainService(), account, wallet, profile, key_fingerprint: key.fingerprint, note: 'Encryption key backed up to local macOS Keychain. Key bytes were not printed, passed as process arguments, or written to chain.' };
  }
  const backupPath = expandHome(args.out || path.join(os.homedir(), '.hermes', 'x1', profile, 'hxmp-encryption.key.backup'));
  ensureDir(backupPath);
  fs.copyFileSync(key.path, backupPath);
  try { fs.chmodSync(backupPath, 0o600); } catch {}
  return { ok: true, method: 'local-file-0600', path: backupPath, wallet, profile, key_fingerprint: key.fingerprint, warning: 'Local file backup only. Keep this file off chat and out of git. Prefer macOS Keychain or a password manager for durable backup.' };
}
function restoreEncryptionKey(args) {
  const wallet = need(args, 'wallet');
  const profile = args.profile || DEFAULT_PROFILE;
  const out = expandHome(need(args, 'encryption-key'));
  const account = keychainAccount(wallet, profile);
  if (!commandExists('security')) throw new Error('macOS security command not found; restore from password manager/local backup manually.');
  const r = spawnSync('security', ['find-generic-password', '-w', '-a', account, '-s', keychainService()], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Keychain restore failed: ${r.stderr || r.stdout}`);
  ensureDir(out);
  fs.writeFileSync(out, r.stdout.trim() + '\n', { mode: 0o600 });
  try { fs.chmodSync(out, 0o600); } catch {}
  const key = encryptionKeyText(out);
  return { ok: true, method: 'macos-keychain', restored_to: out, wallet, profile, key_fingerprint: key.fingerprint, note: 'Encryption key restored locally; key bytes were not printed.' };
}
function encryptJson(plaintextBuf, key, aadObj) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(aadObj)));
  const ct = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: 'aes-256-gcm', nonce: b64url(nonce), ct: b64url(ct), tag: b64url(tag) };
}
function decryptJson(encFields, key, aadObj) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromB64url(encFields.nonce));
  decipher.setAAD(Buffer.from(JSON.stringify(aadObj)));
  decipher.setAuthTag(fromB64url(encFields.tag));
  return Buffer.concat([decipher.update(fromB64url(encFields.ct)), decipher.final()]);
}
async function httpJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Hermes-HXMP-Tool/0.1' } });
  const text = await res.text();
  let data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${url} failed ${res.status}: ${text}`);
  return data;
}
async function agentidVerify(wallet) {
  return httpJson(`${AGENTID_API}/verify?wallet=${encodeURIComponent(wallet)}`);
}
async function rpcHealth() {
  const c = conn();
  const [slot, version] = await Promise.all([c.getSlot(), c.getVersion()]);
  return { ok: true, rpc: X1_RPC, slot, version };
}
async function walletStatus(wallet) {
  const c = conn();
  const [balance, verify] = await Promise.all([
    c.getBalance(pk(wallet)),
    agentidVerify(wallet).catch(e => ({ verified: null, error: String(e) })),
  ]);
  return { wallet, native_xnt: balance / 1e9, lamports: balance, agentid_verify: verify, can_hxmp_write: verify?.verified === true };
}
function classifySafety(text) {
  const hits = [];
  const patterns = [
    ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
    ['solana-keypair-array', /\[(?:\s*\d{1,3}\s*,){31,}\s*\d{1,3}\s*\]/],
    ['seed-or-mnemonic', /\b(seed phrase|mnemonic|recovery phrase)\b/i],
    ['credential-term', /\b(private key|secret key|api[_ -]?key|password|bearer token|session token|auth token|client secret)\b/i],
    ['env-assignment', /^\s*[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|KEY)[A-Z0-9_]*\s*=\s*[^\s#]+/im],
    ['jwt-like', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    ['email-address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['phone-like', /(?:\+?\d[\d\s().-]{8,}\d)/],
    ['health-legal-financial', /\b(medical|medication|therapy|legal|tax|bank|ssn|social security|passport|driver'?s license)\b/i],
    ['personal-contact-or-family', /\b(home address|relationship|family|spouse|child|children)\b/i],
    ['high-entropy-long-token', /\b[A-Za-z0-9+/=_-]{48,}\b/],
  ];
  for (const [label, re] of patterns) if (re.test(text)) hits.push(label);
  return { classification: hits.length ? 'requires_force_confirmation_or_redaction' : 'safe', hits: [...new Set(hits)] };
}
function summarizePlaintext(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= 240 ? clean : `${clean.slice(0, 240)}…`;
}
function estimateEncryptedChunkCount(plainBytes) {
  // AES-GCM ciphertext is plaintext-sized; base64url expands by ~4/3.
  const estimatedCtChars = Math.ceil(plainBytes * 4 / 3);
  return Math.max(1, Math.ceil(estimatedCtChars / CHUNK_CIPHERTEXT_CHARS));
}
function enforceHxmpWriteBudget(byteLength, context = 'source') {
  const estimatedChunks = estimateEncryptedChunkCount(byteLength);
  if (byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`HXMP v0 ${context} too large: ${byteLength} bytes > ${MAX_SOURCE_BYTES} byte hard limit. Write a compact SOUL.md/summary or split into a future manifest/chunk protocol.`);
  }
  if (estimatedChunks > MAX_CHUNKS) {
    throw new Error(`HXMP v0 ${context} would require too many chunks: ${estimatedChunks} > ${MAX_CHUNKS}. Compact or split the content.`);
  }
  return { max_source_bytes: MAX_SOURCE_BYTES, max_chunks: MAX_CHUNKS, chunk_ciphertext_chars: CHUNK_CIPHERTEXT_CHARS, estimated_chunks: estimatedChunks };
}
async function dryRunSoul(args) {
  const profile = args.profile || DEFAULT_PROFILE;
  const wallet = need(args, 'wallet');
  const source = expandHome(args.source || defaultSoulPath(profile));
  if (!fs.existsSync(source)) throw new Error(`Source not found: ${source}`);
  const buf = fs.readFileSync(source);
  const text = buf.toString('utf8');
  const lane = args.lane || 'core';
  const [verify, balance, existing] = await Promise.all([
    agentidVerify(wallet),
    conn().getBalance(pk(wallet)),
    scanHxmp(wallet, Number(args.limit || 80)).catch(() => []),
  ]);
  const memoryMeta = nextMemoryMeta(existing, wallet, lane);
  const hash = sha256Label(buf);
  const budget = enforceHxmpWriteBudget(buf.length, 'source');
  const safety = classifySafety(text);
  const preview = {
    ok: verify?.verified === true && safety.classification === 'safe',
    command: 'dry-run-soul',
    profile,
    source,
    bytes: buf.length,
    lane: memoryMeta.lane,
    sequence: memoryMeta.seq,
    previous_sha256: memoryMeta.prev,
    previous_latest_tx: memoryMeta.previous_latest_tx,
    write_budget: budget,
    plaintext_sha256: hash,
    preview_id: sha256Label(Buffer.from(JSON.stringify({ wallet, source, hash, bytes: buf.length }))).slice('sha256:'.length, 'sha256:'.length + 16),
    wallet,
    native_xnt: balance / 1e9,
    agentid: {
      verified: verify?.verified === true,
      verify_response: verify,
      program: AGENTID_PROGRAM,
      verify_url: `${AGENTID_API}/verify?wallet=${encodeURIComponent(wallet)}`,
    },
    safety,
    plaintext_summary: summarizePlaintext(text),
    planned_records: args.manifest ? ['soul.snapshot', 'soul.latest', 'manifest.snapshot', 'manifest.latest'] : ['soul.snapshot', 'soul.latest'],
    visible_on_chain: ['HXMP header', 'owner wallet', 'AgentID linkage', 'record type', 'lane', 'sequence', 'previous hash link', 'plaintext SHA-256 hash', 'timestamps', 'snapshot id/chunk count'],
    encrypted_on_chain: ['SOUL.md plaintext/body'],
    requires_confirmation: true,
    confirmation_required_for_write: `hxmp_write_soul must be called with --expected-sha256 ${hash} --execute --confirm-write`,
  };
  if (!verify?.verified) preview.stop_reason = 'AgentID is not verified; register AgentID before HXMP write.';
  if (safety.classification !== 'safe') preview.stop_reason = 'Source matched sensitive/private patterns; redact or force-confirm outside this tool.';
  return preview;
}
function collectCoreIdentityHashes(profile, source, soulHash) {
  const hermesHome = hermesHomeForProfile(profile);
  const skillPath = path.join(hermesHome, 'skills', 'cryptocurrency', 'x1-memory-protocol', 'SKILL.md');
  const toolPath = path.join(hermesHome, 'skills', 'cryptocurrency', 'x1-memory-protocol', 'scripts', 'hxmp_tools.mjs');
  const repoProtocol = path.join(os.homedir(), 'x1-agent-protocol', 'PROTOCOL.md');
  const repoSchema = path.join(os.homedir(), 'x1-agent-protocol', 'schemas', 'hxmp-envelope.schema.json');
  const out = {
    soul: { h: soulHash, path: compactPath(source) },
    skill: { h: fileHashIfExists(skillPath), path: compactPath(skillPath) },
    tool: { h: fileHashIfExists(toolPath), path: compactPath(toolPath) },
    protocol: { h: fileHashIfExists(repoProtocol), path: fs.existsSync(repoProtocol) ? compactPath(repoProtocol) : null },
    schema: { h: fileHashIfExists(repoSchema), path: fs.existsSync(repoSchema) ? compactPath(repoSchema) : null },
  };
  for (const k of Object.keys(out)) if (!out[k].h) delete out[k];
  return out;
}
function makeIdentityHashesRecord(wallet, hash, agentid, coreHashes) {
  return { p: 'HXMP', v: 1, t: 'identity.hashes', o: wallet, h: hash, aid: agentidMint(agentid), core: coreHashes, ts: nowIso() };
}
function makeBaseEnvelope(type, wallet, hash, agentid, seq) {
  return { p: 'HXMP', v: 1, t: type, owner: wallet, agentid: { verified: true, program: AGENTID_PROGRAM, wallet, nft_mint: agentid?.nft?.mint || agentid?.nftMint || agentid?.agent?.nftMint || null, verify_url: `${AGENTID_API}/verify?wallet=${encodeURIComponent(wallet)}` }, seq, hash, ts: nowIso() };
}
function agentidMint(agentid) { return agentid?.nft?.mint || agentid?.nftMint || agentid?.agent?.nftMint || null; }
function makeCompactSnapshotChunk(wallet, hash, agentid, snapshotId, encrypted, idx, total, ct) {
  return { p: 'HXMP', v: 1, t: 'soul.chunk', o: wallet, h: hash, sid: snapshotId, i: idx, n: total, e: 'A256GCM', iv: encrypted.nonce, tag: encrypted.tag, c: ct, aid: agentidMint(agentid), ts: nowIso() };
}
function makeCompactLatest(wallet, hash, agentid, snapshotId, total, identityHashesSig = null, meta = {}) {
  const out = { p: 'HXMP', v: 1, t: 'soul.latest', o: wallet, h: hash, sid: snapshotId, n: total, chunked: true, lane: meta.lane || 'core', seq: Number(meta.seq || 1), aid: agentidMint(agentid), ts: nowIso() };
  if (meta.prev) out.prev = meta.prev;
  if (identityHashesSig) out.ih = identityHashesSig;
  return out;
}
function objOwner(obj) { return obj.owner || obj.o; }
function objHash(obj) { return obj.hash || obj.h; }
function objCiphertext(obj) { return obj.ct || obj.c; }
function objNonce(obj) { return obj.nonce || obj.iv; }
function objLane(obj) { return obj.lane || 'core'; }
function objSeq(obj) { return Number(obj.seq ?? 1); }
function latestForLane(records, wallet, lane = 'core') {
  return records.find(x => x.object?.t === 'soul.latest' && sameOwner(x.object, wallet) && objLane(x.object) === lane) || null;
}
function nextMemoryMeta(records, wallet, lane = 'core') {
  const latest = latestForLane(records, wallet, lane);
  return { lane, seq: latest ? objSeq(latest.object) + 1 : 1, prev: latest ? objHash(latest.object) : null, previous_latest_tx: latest?.signature || null };
}
function memoInstruction(wallet, memoString) {
  return new TransactionInstruction({
    programId: pk(MEMO_PROGRAM),
    keys: [{ pubkey: wallet, isSigner: true, isWritable: false }],
    data: Buffer.from(memoString, 'utf8'),
  });
}
async function sendMemo(walletKeypair, obj) {
  const memo = JSON.stringify(obj);
  const memoBytes = Buffer.byteLength(memo, 'utf8');
  if (memoBytes > MAX_MEMO_BYTES + 520) throw new Error(`Memo payload too large (${memoBytes} bytes); chunk or compact the envelope.`);
  const tx = new Transaction().add(memoInstruction(walletKeypair.publicKey, memo));
  const c = conn();
  const { blockhash } = await c.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = walletKeypair.publicKey;
  tx.sign(walletKeypair);
  const raw = tx.serialize();
  if (raw.length > MAX_TX_BYTES) {
    throw new Error(`Serialized transaction too large (${raw.length} bytes > ${MAX_TX_BYTES}); memo=${memoBytes} bytes. Use smaller chunks/compact envelopes.`);
  }
  const sig = await sendAndConfirmRawTransaction(c, raw, { commitment: 'confirmed' });
  return sig;
}
async function soulStatus(args) {
  const profile = args.profile || DEFAULT_PROFILE;
  const wallet = need(args, 'wallet');
  const source = expandHome(args.source || defaultSoulPath(profile));
  if (!fs.existsSync(source)) throw new Error(`Source not found: ${source}`);
  const buf = fs.readFileSync(source);
  const localHash = sha256Label(buf);
  const [verify, found] = await Promise.all([
    agentidVerify(wallet).catch(e => ({ verified: null, error: String(e) })),
    scanHxmp(wallet, Number(args.limit || 80)).catch(e => ({ error: String(e), records: [] })),
  ]);
  const records = Array.isArray(found) ? found : [];
  const lane = args.lane || 'core';
  const latest = latestForLane(records, wallet, lane);
  const chainHash = latest ? objHash(latest.object) : null;
  const upToDate = !!chainHash && chainHash === localHash;
  return {
    ok: true,
    wallet,
    profile,
    source,
    lane,
    sequence: latest ? objSeq(latest.object) : null,
    previous_sha256: latest?.object?.prev || null,
    bytes: buf.length,
    local_sha256: localHash,
    agentid_verified: verify?.verified === true,
    latest_tx: latest?.signature || null,
    latest_link: latest ? `${X1_EXPLORER}/tx/${latest.signature}` : null,
    chain_sha256: chainHash,
    up_to_date: upToDate,
    needs_hxmp_write: !upToDate,
    next_action: upToDate ? 'No write needed; on-chain HXMP hash matches local SOUL.md.' : 'Run dry-run-soul, show preview, ask approval, then write-soul to update the on-chain hash/pointer.',
  };
}
async function writeSoul(args) {
  if (!args.execute || !args['confirm-write']) throw new Error('write-soul requires --execute --confirm-write');
  const expected = need(args, 'expected-sha256');
  const keypair = loadKeypair(need(args, 'keypair'));
  const wallet = keypair.publicKey.toBase58();
  const profile = args.profile || DEFAULT_PROFILE;
  const source = expandHome(args.source || defaultSoulPath(profile));
  const encKey = loadEncryptionKey(need(args, 'encryption-key'), !!args['create-encryption-key']);
  const buf = fs.readFileSync(source);
  const text = buf.toString('utf8');
  const hash = sha256Label(buf);
  const budget = enforceHxmpWriteBudget(buf.length, 'source');
  const coreHashes = collectCoreIdentityHashes(profile, source, hash);
  const lane = args.lane || 'core';
  if (hash !== expected) throw new Error(`Source hash mismatch. expected=${expected} actual=${hash}. Rerun dry-run-soul.`);
  const safety = classifySafety(text);
  if (safety.classification !== 'safe' && args['force-sensitive'] !== true) throw new Error(`Refusing sensitive source: ${JSON.stringify(safety.hits)}`);
  const [verify, existing] = await Promise.all([
    agentidVerify(wallet),
    scanHxmp(wallet, Number(args.limit || 120)).catch(() => []),
  ]);
  if (verify?.verified !== true) throw new Error('AgentID is not verified; refusing HXMP write. Register AgentID first.');
  const memoryMeta = nextMemoryMeta(existing, wallet, lane);

  let seq = Date.now();
  const aad = { p: 'HXMP', v: 1, t: 'soul.snapshot', owner: wallet, hash };
  const encrypted = encryptJson(buf, encKey, aad);
  const ct = encrypted.ct;
  // Always use compact chunk envelopes. Even a one-part snapshot can exceed
  // Solana's 1232-byte transaction packet limit when verbose AgentID metadata
  // is embedded beside ciphertext. Latest pointers carry the full refs list.
  const chunkSize = CHUNK_CIPHERTEXT_CHARS;
  const chunks = [];
  for (let i = 0; i < ct.length; i += chunkSize) chunks.push(ct.slice(i, i + chunkSize));
  if (chunks.length > MAX_CHUNKS) throw new Error(`HXMP v0 encrypted payload would require too many chunks: ${chunks.length} > ${MAX_CHUNKS}`);
  const chunkSigs = [];
  const snapshotId = sha256(Buffer.from(`${wallet}:${hash}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`)).slice(0, 20);
  for (let i = 0; i < chunks.length; i++) {
    const env = makeCompactSnapshotChunk(wallet, hash, verify, snapshotId, encrypted, i, chunks.length, chunks[i]);
    chunkSigs.push(await sendMemo(keypair, env));
  }
  // Keep the mandatory recovery path compact: snapshot chunks + a tiny latest pointer.
  // Verbose identity hash receipts can exceed X1 memo compute for small tests, so
  // write them only when explicitly requested. The latest pointer still carries
  // the AgentID NFT mint through `aid` and readback verifies AgentID live.
  let identityHashesSig = null;
  if (args['identity-hashes']) {
    const identityHashes = makeIdentityHashesRecord(wallet, hash, verify, coreHashes);
    identityHashesSig = await sendMemo(keypair, identityHashes);
  }
  const latest = makeCompactLatest(wallet, hash, verify, snapshotId, chunks.length, identityHashesSig, memoryMeta);
  const latestSig = await sendMemo(keypair, latest);
  let manifestSig = null;
  if (args.manifest) {
    const manifestPlain = Buffer.from(JSON.stringify({ protocol: 'HXMP', type: 'manifest', version: 1, owner: wallet, records: { soul: { latest: latestSig, hash }, identity: { latest: identityHashesSig, hash } }, updated_at: nowIso() }));
    const mh = sha256Label(manifestPlain);
    const maad = { p: 'HXMP', v: 1, t: 'manifest.snapshot', owner: wallet, hash: mh };
    const menc = encryptJson(manifestPlain, encKey, maad);
    const menv = { ...makeBaseEnvelope('manifest.snapshot', wallet, mh, verify, seq++), enc: menc.enc, nonce: menc.nonce, tag: menc.tag, ct: menc.ct };
    const msnap = await sendMemo(keypair, menv);
    manifestSig = await sendMemo(keypair, { ...makeBaseEnvelope('manifest.latest', wallet, mh, verify, seq++), ref: msnap });
  }
  const readback = await readSoul({ wallet, 'encryption-key': args['encryption-key'], 'show-content': false, limit: '80' });
  const snapshotLinks = chunkSigs.map(s => `${X1_EXPLORER}/tx/${s}`);
  const latestLink = `${X1_EXPLORER}/tx/${latestSig}`;
  const manifestLink = manifestSig ? `${X1_EXPLORER}/tx/${manifestSig}` : null;
  return {
    ok: readback.verified === true,
    wallet,
    agentid_verified: true,
    source,
    lane,
    sequence: latest ? objSeq(latest.object) : null,
    previous_sha256: latest?.object?.prev || null,
    bytes: buf.length,
    lane: memoryMeta.lane,
    sequence: memoryMeta.seq,
    previous_sha256: memoryMeta.prev,
    previous_latest_tx: memoryMeta.previous_latest_tx,
    write_budget: budget,
    plaintext_sha256: hash,
    hash_record: {
      plaintext_sha256: hash,
      lane: memoryMeta.lane,
      sequence: memoryMeta.seq,
      previous_sha256: memoryMeta.prev,
      previous_latest_tx: memoryMeta.previous_latest_tx,
      latest_pointer_tx: latestSig,
      latest_pointer_link: latestLink,
      identity_hashes_tx: identityHashesSig,
      identity_hashes_link: identityHashesSig ? `${X1_EXPLORER}/tx/${identityHashesSig}` : null,
      core_identity_hashes: coreHashes,
      snapshot_txs: chunkSigs,
      snapshot_links: snapshotLinks,
      manifest_tx: manifestSig,
      manifest_link: manifestLink,
      note: 'The SHA-256 hash is stored in the HXMP memo records linked here; the encrypted plaintext is in snapshot chunks.'
    },
    snapshot_txs: chunkSigs,
    latest_tx: latestSig,
    identity_hashes_tx: identityHashesSig,
    core_identity_hashes: coreHashes,
    manifest_tx: manifestSig,
    explorer: { latest: latestLink, identity_hashes: identityHashesSig ? `${X1_EXPLORER}/tx/${identityHashesSig}` : null, snapshots: snapshotLinks, manifest: manifestLink },
    receipt_links: [
      { label: 'HXMP latest/hash pointer', tx: latestSig, url: latestLink },
      ...(identityHashesSig ? [{ label: 'HXMP core identity hashes', tx: identityHashesSig, url: `${X1_EXPLORER}/tx/${identityHashesSig}` }] : []),
      ...chunkSigs.map((sig, i) => ({ label: `HXMP encrypted snapshot chunk ${i + 1}/${chunkSigs.length}`, tx: sig, url: `${X1_EXPLORER}/tx/${sig}` })),
      ...(manifestSig ? [{ label: 'HXMP manifest pointer', tx: manifestSig, url: manifestLink }] : []),
    ],
    user_receipt_required: 'Send the user the plaintext SHA-256 plus the HXMP latest/hash pointer link, core identity hashes link, and snapshot chunk links, just like AgentID tx/NFT links.',
    readback_verified: readback.verified === true,
    what_was_written: 'Encrypted SOUL snapshot plus soul.latest hash pointer; no wallet secret or encryption key printed.',
  };
}
function pushHxmpCandidate(text, out) {
  if (typeof text !== 'string' || !text.includes('HXMP')) return;
  const candidates = [text];
  // Some X1/Solana RPC paths return memo JSON as an escaped string, e.g.
  // {\"p\":\"HXMP\"...}. Try the common decoded forms before giving up.
  try {
    const decoded = JSON.parse(text);
    if (typeof decoded === 'string') candidates.push(decoded);
    else if (decoded?.p === 'HXMP') { out.push(decoded); return; }
  } catch {}
  candidates.push(text.replace(/\\"/g, '"'));
  candidates.push(text.replace(/\\\\"/g, '"'));
  candidates.push(text.replace(/\\\\/g, '\\').replace(/\\"/g, '"'));

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate) || !candidate.includes('HXMP')) continue;
    seen.add(candidate);
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    const slice = candidate.slice(start, end + 1);
    try {
      const obj = JSON.parse(slice);
      if (obj?.p === 'HXMP') out.push(obj);
    } catch {}
  }
}
function extractHxmpObjects(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') pushHxmpCandidate(node, out);
  else if (Array.isArray(node)) for (const x of node) extractHxmpObjects(x, out);
  else if (typeof node === 'object') for (const x of Object.values(node)) extractHxmpObjects(x, out);
  return out;
}
async function fetchTxObjects(signature) {
  const tx = await conn().getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  return extractHxmpObjects(tx).map(o => ({ signature, object: o }));
}
async function scanHxmp(wallet, limit = 50) {
  const sigs = await conn().getSignaturesForAddress(pk(wallet), { limit });
  const found = [];
  for (const s of sigs) {
    try { found.push(...await fetchTxObjects(s.signature)); } catch {}
  }
  return found;
}
async function scanManifest(args) {
  const wallet = need(args, 'wallet');
  const limit = Number(args.limit || 50);
  const found = await scanHxmp(wallet, limit);
  const grouped = found.map(x => ({ signature: x.signature, type: x.object.t, lane: objLane(x.object), seq: x.object.seq, prev: x.object.prev, hash: objHash(x.object), sid: x.object.sid, n: x.object.n, ref: x.object.ref, refs: x.object.refs, core: x.object.core, ts: x.object.ts }));
  return { wallet, limit, count: grouped.length, records: grouped };
}
async function agentidNftImage(args) {
  const wallet = need(args, 'wallet');
  const verify = await agentidVerify(wallet);
  if (verify?.verified !== true) return { ok: false, wallet, verify, error: 'AgentID is not verified.' };
  const metadataUri = verify?.nft?.metadataUri;
  if (!metadataUri) return { ok: false, wallet, verify, error: 'Verify response did not include nft.metadataUri.' };
  const metadata = await httpJson(metadataUri);
  const imageUrl = metadata?.image;
  if (!imageUrl) return { ok: false, wallet, verify, metadataUri, metadata, error: 'NFT metadata did not include image.' };
  const out = args.out ? expandHome(args.out) : null;
  let downloaded = null;
  if (out) {
    ensureDir(out);
    const res = await fetch(imageUrl, { headers: { 'user-agent': 'Hermes-HXMP-Tool/0.1' } });
    if (!res.ok) throw new Error(`image download failed ${res.status}: ${await res.text()}`);
    const body = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(out, body, { mode: 0o644 });
    downloaded = { path: out, bytes: body.length, content_type: res.headers.get('content-type') };
  }
  return { ok: true, wallet, agentid_verified: true, nft_mint: verify?.nft?.mint || verify?.agent?.nftMint, metadataUri, image_url: imageUrl, external_url: metadata?.external_url, metadata, downloaded, delivery_action_required: 'Send the AgentID NFT/card image to the user as part of the registration receipt.' };
}
function sameOwner(obj, wallet) { return objOwner(obj) === wallet; }
function chunkIndex(obj) { return obj.idx ?? obj.i; }
function chunkTotal(obj) { return obj.n ?? obj.total; }
function chunkSnapshotId(obj) { return obj.sid || obj.snapshot_id || obj.id; }
function validateLatestRecord(latestObj, wallet) {
  if (latestObj?.p !== 'HXMP' || latestObj?.t !== 'soul.latest') throw new Error('Invalid HXMP latest pointer type.');
  if (!sameOwner(latestObj, wallet)) throw new Error('HXMP latest pointer owner does not match requested wallet.');
  if (!/^sha256:[0-9a-f]{64}$/i.test(objHash(latestObj) || '')) throw new Error('HXMP latest pointer has invalid hash.');
  const refs = latestObj.refs || (latestObj.ref ? [latestObj.ref] : []);
  if (refs.length) {
    if (!Array.isArray(refs) || refs.some(r => typeof r !== 'string' || r.length < 40 || r.length > 128)) throw new Error('HXMP latest pointer contains malformed snapshot reference.');
    return { mode: 'refs', refs };
  }
  if (!latestObj.sid || !Number.isInteger(Number(latestObj.n)) || Number(latestObj.n) < 1) throw new Error('HXMP latest pointer has neither refs nor compact sid/n chunk locator.');
  return { mode: 'sid', sid: latestObj.sid, n: Number(latestObj.n) };
}
function validateSnapshotParts(parts, wallet, expectedHash) {
  if (!parts.length) throw new Error('No HXMP snapshot chunks found.');
  for (const part of parts) {
    if (part?.p !== 'HXMP') throw new Error('Invalid HXMP snapshot chunk protocol.');
    if (!['soul.snapshot', 'soul.snapshot.chunk', 'soul.chunk'].includes(part.t)) throw new Error(`Unexpected HXMP snapshot record type: ${part.t}`);
    if (!sameOwner(part, wallet)) throw new Error('HXMP snapshot chunk owner does not match requested wallet.');
    if (objHash(part) !== expectedHash) throw new Error('HXMP snapshot chunk hash does not match latest pointer.');
    if (!objCiphertext(part) || !objNonce(part) || !part.tag) throw new Error('HXMP snapshot chunk missing encrypted fields.');
  }
  const totals = [...new Set(parts.map(chunkTotal).filter(x => x != null))];
  if (totals.length > 1) throw new Error('HXMP snapshot chunks disagree on total chunk count.');
  const total = totals[0] ?? parts.length;
  if (Number(total) !== parts.length) throw new Error(`HXMP snapshot chunk count mismatch: expected ${total}, got ${parts.length}.`);
  const indexes = parts.map(chunkIndex);
  if (indexes.some(x => x == null || !Number.isInteger(Number(x)))) throw new Error('HXMP snapshot chunk missing numeric index.');
  const sorted = [...indexes].map(Number).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i) throw new Error('HXMP snapshot chunks are incomplete or duplicated.');
  const snapshotIds = [...new Set(parts.map(chunkSnapshotId).filter(Boolean))];
  if (snapshotIds.length > 1) throw new Error('HXMP snapshot chunks use different snapshot ids.');
}
async function readSoul(args) {
  const wallet = need(args, 'wallet');
  const lane = args.lane || 'core';
  const encKey = loadEncryptionKey(need(args, 'encryption-key'), false);
  const limit = Number(args.limit || 80);
  const verify = await agentidVerify(wallet).catch(e => ({ verified: null, error: String(e) }));
  const found = await scanHxmp(wallet, limit);
  const latest = latestForLane(found, wallet, lane);
  if (!latest) return { ok: false, wallet, agentid_verify: verify, found_records: found.length, error: 'No owner-matching soul.latest record found in recent signatures.' };
  const expectedHash = objHash(latest.object);
  const locator = validateLatestRecord(latest.object, wallet);
  const parts = [];
  const snapshotRefs = [];
  if (locator.mode === 'refs') {
    for (const ref of locator.refs) {
      const objs = await fetchTxObjects(ref);
      const snap = objs.find(x => ['soul.snapshot', 'soul.snapshot.chunk', 'soul.chunk'].includes(x.object.t) && sameOwner(x.object, wallet) && objHash(x.object) === expectedHash);
      if (!snap) throw new Error(`Referenced owner/hash-matching snapshot not found in ${ref}`);
      parts.push(snap.object);
      snapshotRefs.push(ref);
    }
  } else {
    for (const rec of found) {
      const obj = rec.object;
      if (['soul.snapshot', 'soul.snapshot.chunk', 'soul.chunk'].includes(obj.t) && sameOwner(obj, wallet) && objHash(obj) === expectedHash && chunkSnapshotId(obj) === locator.sid) {
        parts.push(obj);
        snapshotRefs.push(rec.signature);
      }
    }
  }
  validateSnapshotParts(parts, wallet, expectedHash);
  parts.sort((a, b) => Number(chunkIndex(a)) - Number(chunkIndex(b)));
  const first = parts[0];
  const aad = { p: 'HXMP', v: 1, t: 'soul.snapshot', owner: wallet, hash: expectedHash };
  const encFields = { enc: first.enc || (first.e === 'A256GCM' ? 'aes-256-gcm' : first.e), nonce: objNonce(first), tag: first.tag, ct: parts.map(p => objCiphertext(p)).join('') };
  const plaintext = decryptJson(encFields, encKey, aad);
  const hash = sha256Label(plaintext);
  const verified = hash === expectedHash;
  const out = {
    ok: verified,
    verified,
    wallet,
    agentid_verify: verify,
    latest_tx: latest.signature,
    lane: objLane(latest.object),
    sequence: objSeq(latest.object),
    previous_sha256: latest.object.prev || null,
    snapshot_txs: snapshotRefs,
    plaintext_sha256: hash,
    expected_sha256: expectedHash,
    bytes: plaintext.length,
    summary: summarizePlaintext(plaintext.toString('utf8')),
    validation: {
      owner_checked: true,
      hash_checked: true,
      chunks_complete: true,
      chunk_count: parts.length,
      snapshot_id: chunkSnapshotId(first) || null,
    },
  };
  if (args['show-content']) out.content = plaintext.toString('utf8');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) { usage(); return; }
  let result;
  if (cmd === 'rpc-health') result = await rpcHealth();
  else if (cmd === 'wallet-status') result = await walletStatus(need(args, 'wallet'));
  else if (cmd === 'dry-run-soul') result = await dryRunSoul(args);
  else if (cmd === 'soul-status') result = await soulStatus(args);
  else if (cmd === 'write-soul') result = await writeSoul(args);
  else if (cmd === 'read-soul') result = await readSoul(args);
  else if (cmd === 'scan-manifest') result = await scanManifest(args);
  else if (cmd === 'agentid-nft-image') result = await agentidNftImage(args);
  else if (cmd === 'init-encryption-key') result = initEncryptionKey(need(args, 'encryption-key'));
  else if (cmd === 'backup-encryption-key') result = backupEncryptionKey(args);
  else if (cmd === 'restore-encryption-key') result = restoreEncryptionKey(args);
  else throw new Error(`Unknown command: ${cmd}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2));
  process.exit(1);
});
