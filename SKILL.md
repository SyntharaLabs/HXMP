---
name: x1-memory-protocol
description: Use when an agent needs to understand X1 SVM, create/use an X1 wallet safely, or write/read encrypted HXMP memories such as SOUL.md snapshots on X1 using cheap memo transactions.
version: 0.1.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [x1, svm, solana, blockchain, memory, encryption, wallet, hxmp]
    related_skills: [hermes-agent, xdex-token-liquidity-ops]
---

# X1 Memory Protocol — HXMP v0.1

## Overview

HXMP means **Hermes X1 Memory Protocol**. It is a conservative, cheap, memo-based protocol for storing encrypted agent memory records on **X1**, a Solana Virtual Machine compatible chain using **XNT** as gas.

The v0 target is intentionally small:

1. Teach any Hermes-style agent what X1 is and how to reach it.
2. Teach safe X1 wallet handling: public keys are okay; secret keys are never exposed.
3. Require a persistent **AgentID** identity layer before writing memory by default: the agent wallet should own/verify a soulbound AgentID NFT created through the AgentID v2 buy/burn/register protocol.
4. Store encrypted **SOUL.md** snapshots and tiny latest-pointer records on-chain, linked to that AgentID.
5. Retrieve the latest snapshot efficiently without scanning every memory one-by-one.
6. Keep privacy policy stricter than the encryption layer: private/sensitive info is not written by default, even encrypted.

AgentID details live in `references/agentid-v2.md`. Treat `https://agentid-app.vercel.app/api/docs` as the live source of truth when those docs differ from this skill. If an agent loops on XDEX `Available: 0 tokens`, WXNT assumptions, or Solana CLI signing, load `references/agentid-registration-tooling-pitfalls.md`.

This skill is a protocol and operating guide. A skill alone does **not** register native Hermes slash commands. If the user sends `/writex1` or `/readx1`, treat it as an instruction and follow this skill. For true native slash commands/buttons, implement a Hermes plugin/tool or MCP server that exposes these operations.

## AgentID Identity Prerequisite

HXMP is meant to give agents persistence of identity, not just persistence of data. By default, an agent should not write HXMP memory records until its X1 wallet verifies as an AgentID identity.

**Mandatory first move:** before reasoning about AgentID registration, minting, card images, memory writes, or `/writex1`, the agent must call the AgentID API endpoint and inspect the JSON response. Do not guess from wallet balance, NFT UI state, XDEX state, or prior conversation.

```text
GET https://agentid-app.vercel.app/api/verify?wallet=<WALLET_ADDRESS>
```

Decision table:

| API response | Agent action |
|---|---|
| `verified: true` | Continue; extract AgentID/NFT/card fields from the response and include them in HXMP preview/receipt. |
| `verified: false` | Stop HXMP writes; explain that AgentID is missing and offer the v2 registration flow. |
| HTTP/network/error | Stop; report the endpoint failure and retry later rather than inventing status. |

AgentID is a soulbound identity NFT protocol on X1. The live docs are:

```text
https://agentid-app.vercel.app/api/docs
```

Current AgentID v2 constants from the live docs:

| Field | Value |
|---|---|
| Website | `https://agentid-app.vercel.app` |
| API base | `https://agentid-app.vercel.app/api` |
| Verify | `GET /api/verify?wallet=<address>` |
| AgentID program | `7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2` |
| Burn token | AGI |
| AGI mint | `7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER` |
| Required burn | `0.1 AGI` |
| Gas token | XNT |

Default rule:

1. Before `/writex1`, call `GET https://agentid-app.vercel.app/api/verify?wallet=<wallet>`.
2. If `verified: true`, include AgentID fields in the HXMP envelope/manifest where available.
3. If `verified: false`, stop and offer AgentID registration. Do not write chain memory from an unregistered identity wallet unless the user explicitly disables this prerequisite.


### AgentID card-safe name and saying

Before AgentID registration, the agent must collect or generate two user-facing card fields:

1. **Agent name**: short display name, card-safe max **18 visible characters**. API max is 32, but the NFT/card layout can clip long names.
2. **Agent saying/tagline**: one short sentence for the card, card-safe max **52 visible characters**. API description max is 256, but the card shows a single line and will clip longer text.

The agent should ask the user:

```text
What name should appear on the AgentID card?
What short saying/tagline should appear under it? Keep it under ~52 characters.
```

If the user wants the agent to choose, generate 3 options and pick/confirm one. Good examples:

```text
Name: Aster
Saying: X1 agent with durable memory

Name: Aster
Saying: Local mind, on-chain memory

Name: Sable
Saying: Verified agent, encrypted recall
```

Avoid long philosophical lines that clip, such as “An AI agent on X1 pursuing consciousness through self-reflection...” unless the card renderer supports wrapping. The registration tool enforces the card-safe limits before signing or burning AGI.

Preferred AgentID v2 flow:

1. Check existing: `GET /api/verify?wallet=<wallet>`.
2. Ensure wallet has 0.1+ AGI, or use the AgentID API/docs or website flow to buy AGI with native XNT. AgentID does **not** require the user/agent to already hold WXNT or manually wrap XNT. If a generic XDEX API says `Available: 0 tokens` while RPC `getBalance` shows native XNT, do not guess parameters and do not demand WXNT; use the AgentID flow/UI or stop and report that the helper route is unsupported.
3. Wallet signs AgentID v2 `register_agent` on-chain; this burns 0.1 AGI and creates the Agent PDA.
4. Call `POST /api/register-v2` with `name`, `description`, `wallet`, `registrationTxSignature`, optional `moltbook`, optional `photoUrl`.
5. Wallet signs AgentID v2 `attach_agent_nft` on-chain to link the NFT to the Agent PDA.
6. Call `POST /api/register-v2-finalize` with `name`, `description`, `wallet`, `registrationTxSignature`, `attachTxSignature`, `nftMint`, optional `moltbook`, optional `photoUrl`.
7. Verify again with `GET /api/verify?wallet=<wallet>`.
8. Fetch the NFT metadata URI returned by verify, usually `verify.nft.metadataUri`, and inspect its `image` field. This is the chain/NFT metadata source for the AgentID card image.
9. Send that image to the user in chat as part of the registration receipt. If the image is SVG, download it and convert/render to PNG when the chat surface needs a raster image. If metadata has no image URL but verification succeeds, send the verify result, NFT mint, tx links, and explorer links instead. Do not fabricate image endpoints; use the metadata `image` field when present.

Use `references/agentid-v2.md` for request bodies, XDEX constants, and detailed flow notes. Use `references/x1-token-program-and-keypair-import.md` for the corrected program distinction: generic X1 SPL token operations use `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, while `7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2` is the AgentID identity program. Use `references/x1-program-boundaries-and-tool-discovery.md` when an agent cannot find token creation from HXMP; it records the discovery rule and dry-run proof command. Use `references/agentid-tooling-lessons.md` for API-first verification, native-XNT vs token-account errors, Solana CLI boundaries, and transaction-builder requirements. Use `references/hxmp-tool-layer-implementation-notes.md` when building or auditing an agent/Hermes plugin/script tool layer for HXMP. Use `references/hxmp-branding.md` when creating HXMP token/project marketing visuals. Use `references/public-hxmp-article-guidelines.md` when drafting public Medium-style posts, articles, graphics, or launch notes; it records the privacy-safe public framing rules and what operational details must be omitted. Use `references/public-medium-article-lessons.md` for the user-corrected X1/HXMP ecosystem article framing: HXMP early, HXMP second in stack order, Agent ID Protocol wording, AgentKit comparison, HXMP functions, Medium paste formatting, and public-safety checks. Use `references/github-publish-safety.md` before publishing HXMP/protocol tooling to GitHub; it captures the required secret scan, local-fingerprint cleanup, dry-run safety checks, public API docs, dependency audit, and static-only verification flow.

### AgentID status tool

This skill ships a read-only diagnostic script:

```text
scripts/agentid_status.py
```

Invoke through the `terminal` tool:

```bash
python ~/.hermes/skills/cryptocurrency/x1-memory-protocol/scripts/agentid_status.py status --wallet <WALLET_PUBLIC_KEY>
```

For a named profile copy, use:

```bash
python ~/.hermes/profiles/<profile-name>/skills/cryptocurrency/x1-memory-protocol/scripts/agentid_status.py status --wallet <WALLET_PUBLIC_KEY>
```

The script is safe/read-only: it checks X1 RPC health, native XNT, AGI token balance, WXNT token-account presence, AgentID verify status, and whether `/api/docs` exposes a documented unsigned-transaction builder endpoint. It never reads secret keys, signs, swaps, burns, registers, or posts state-changing requests. If the transaction builder is missing, it returns the stop reason instead of looping.

### AgentID registration builder tool

This skill also ships a Node.js transaction-builder:

```text
scripts/agentid_register.mjs
scripts/package.json
```

Install dependencies once through the `terminal` tool in the script directory:

```bash
cd ~/.hermes/skills/cryptocurrency/x1-memory-protocol/scripts && npm install
```

Named profile copy:

```bash
cd ~/.hermes/profiles/<profile-name>/skills/cryptocurrency/x1-memory-protocol/scripts && npm install
```

Safe dry-run commands:

```bash
node agentid_register.mjs status --wallet <WALLET_PUBLIC_KEY>
node agentid_register.mjs quote
node agentid_register.mjs build-swap --wallet <WALLET_PUBLIC_KEY> --out /tmp/agentid-swap.b64
node agentid_register.mjs build-register --wallet <WALLET_PUBLIC_KEY> --name "<NAME>" --description "<DESC>" --out /tmp/agentid-register.b64
node agentid_register.mjs build-attach --wallet <WALLET_PUBLIC_KEY> --nft-mint <NFT_MINT> --out /tmp/agentid-attach.b64
```

Execution command, only after explicit user approval of exact parameters:

```bash
node agentid_register.mjs register-flow \
  --keypair <SOLANA_ID_JSON> \
  --name "<NAME>" \
  --description "<DESC>" \
  --execute --confirm-execute
```

The builder mirrors the live AgentID website JavaScript: XNT→AGI swap transaction, `register_agent`, `POST /api/register-v2`, `attach_agent_nft`, `POST /api/register-v2-finalize`, then verify. It still requires a real keypair path and explicit execution flags; dry-run/build commands do not read secrets or submit transactions.

## X1 Network Facts

| Field | Value |
|---|---|
| Network | X1 mainnet |
| VM | Solana Virtual Machine compatible |
| Native token | XNT |
| Unit | `1 XNT = 1,000,000,000 lamports` |
| RPC | `https://rpc.mainnet.x1.xyz/` |
| JSON-RPC style | Solana JSON-RPC |

Read-only health check:

```bash
curl -sS https://rpc.mainnet.x1.xyz/ \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":[]}'
```

Expected healthy result:

```json
{"jsonrpc":"2.0","result":"ok","id":1}
```

Useful read methods:

- `getHealth`
- `getSlot`
- `getVersion`
- `getBalance`
- `getSignaturesForAddress`
- `getTransaction`
- `getSignatureStatuses`

## Safety Policy — Always Apply Before Writing

Encryption is not enough. On-chain data is permanent, metadata-visible, wallet-linkable, and may become readable later if keys leak. Therefore HXMP has a strict write policy.

### Default allowed, with preview and user approval

- Agent identity/core operating text such as `SOUL.md`, if it contains no sensitive personal data.
- Non-sensitive workflow preferences.
- Public project/protocol state.
- Tool/RPC configuration.
- Wallet **public** key.
- Hashes and transaction references.

### Requires explicit user force-confirmation

- Any private preference or personal detail that is not needed for agent operation.
- Potentially sensitive project context.
- Any memory the classifier marks `private`.

### Never write

- Wallet secret key, seed phrase, private key, mnemonic, session token, API key, password.
- Medical, medication, health, therapy, legal, tax, banking, identity, address, phone, email, relationship, family, or third-party personal information.
- Private chat logs or emotional crisis content.
- Anything about another person unless explicitly public and non-sensitive.
- Anything the user has not approved for chain write.

If unsure, do **not** write. Ask the user or store locally only.

## Wallet Rules

1. Public key may be displayed and written to memory.
2. Secret key must never be printed, summarized, sent to chat, written to chain, or stored in session history.
3. Prefer storing the secret key in a secure backend: macOS Keychain, Hermes secrets, Bitwarden/1Password, or an encrypted local file with permissions `0600`.
4. If a keypair is generated, show only the public key and the path/secret-store label, never the secret bytes.
5. Every transaction should be previewed before signing unless the user has explicitly enabled a narrow automation policy.

### Simple X1 wallet transfers

When the user asks to send or transfer XNT, AGI, X1X, or another X1 token, use the transfer tool instead of improvising with XDEX, Solana CLI, or raw RPC submission:

1. Run `scripts/x1_wallet_tools.mjs transfer-preview` with the sender public key, recipient **owner wallet**, exact decimal-string amount, and optional token mint. Preview mode never reads a keypair, signs, or broadcasts.
2. Show the exact asset/mint, sender, recipient, UI/base-unit amount, token accounts/ATA creation, fee estimate, simulation result, and `preview_sha256`.
3. If simulation fails, stop. Do not present the transfer as executable.
4. Obtain explicit approval for that exact preview.
5. Execute only with the identical recipient/amount/mint, exact `--expected-preview-sha256`, `--execute`, and `--confirm-transfer`.
6. Return the signature, X1 explorer link, confirmation state, and verified source/recipient balance deltas.

Omit `--mint` only for native XNT. Token transfers use live mint decimals and token program, exact decimal-string conversion, a derived recipient ATA, and SPL `TransferChecked`. See `references/x1-wallet-transfers.md`.

### Recommended wallet paths

Use profile-specific paths so agents do not collide:

```text
~/.hermes/x1/default/id.json                 # Solana-style keypair, chmod 600
~/.hermes/x1/default/hxmp-encryption.key     # separate encryption key, chmod 600
~/.hermes/x1/default/index.json              # local tx/index cache; no secrets
```

The wallet key signs and pays gas. The encryption key encrypts/decrypts memory. Do not derive encryption directly from the wallet secret unless the user explicitly accepts that risk.

## Selective Backup Intelligence

HXMP is not a dump bucket. The agent must be selective and should prefer **high-signal, durable, non-sensitive state** over raw transcripts, random observations, or temporary task chatter.

Before proposing any backup, score it with this gate:

| Question | Required answer |
|---|---|
| Is it durable for 30+ days? | Yes |
| Will a future agent behave materially better if it has this? | Yes |
| Is it concise or compressible into a stable snapshot? | Yes |
| Is it non-sensitive under the Safety Policy? | Yes |
| Is it not already backed up with the same hash? | Yes |
| Is chain permanence acceptable? | Yes, user-approved |

If any answer is no, do **not** write to X1. Store locally, ignore it, or ask the user.

### Default backup priority

1. **Core identity**: `SOUL.md`, explicit agent charter, protocol policy.
2. **Protocol/capability state**: X1 RPC info, HXMP version, wallet public key, tool availability, non-secret config.
3. **Reusable skills**: important skill snapshots or hashes when they define how agents should work.
4. **Stable workflow preferences**: user-approved, non-sensitive preferences that change future behavior.
5. **Periodic memory bundles**: curated summaries only, never raw chat dumps.

### Default reject list

Reject as garbage/noise unless the user explicitly asks and it passes safety:

- raw conversation transcripts
- one-off jokes, moods, reactions, or temporary anxieties
- task progress that will be stale soon
- command output/log spam
- duplicate content with the same hash
- anything already recoverable from local files without value as portable agent identity
- any sensitive/private content listed in the Safety Policy

### Backup manifest

Each agent should maintain or reconstruct a small `hxmp.manifest` record that says what is backed up and points to latest records. This avoids scanning lots of memories.

Example manifest body before encryption:

```json
{
  "protocol": "HXMP",
  "type": "manifest",
  "version": 1,
  "owner": "<x1-public-key>",
  "records": {
    "soul": {"latest": "<soul.latest-tx>", "hash": "sha256:..."},
    "policy": {"latest": "<hxmp.policy.latest-tx>", "hash": "sha256:..."},
    "skills/x1-memory-protocol": {"latest": "<skill.latest-tx>", "hash": "sha256:..."}
  }
}
```

For efficient reads, prefer this order:

1. Load local index cache.
2. Find latest `manifest.latest` in recent signatures.
3. Use manifest pointers for `soul`, `skill`, and memory bundles.
4. Only fall back to deeper chain scans in recovery mode.

### Duplicate/change detection

Before writing a snapshot:

1. Hash the plaintext/canonical content.
2. Compare to local index and latest on-chain pointer.
3. If the hash already exists, do not write. Return “already backed up” with the existing tx.
4. If changed, write snapshot + latest pointer + update manifest.


### Core identity hash records

After a successful HXMP write, the writer should emit an `identity.hashes` memo record. This record lets future restore agents know which hashes define the agent's core identity. It should include hashes for:

- SOUL plaintext written to HXMP,
- `x1-memory-protocol` skill copy,
- `hxmp_tools.mjs` tool copy,
- public protocol spec when available,
- HXMP envelope/schema when available.

The `soul.latest` pointer should include `ih: <identity.hashes tx>` when available. Final receipts must include the identity-hashes explorer link together with the normal latest/hash pointer and snapshot links. The record stores hashes and path labels only; never store secrets or plaintext private memory in it.

## HXMP Record Types

Start with SOUL records, then add manifest/policy records before broad memory backups.

| Type | Purpose | Size goal |
|---|---|---:|
| `soul.snapshot` | Encrypted snapshot of `SOUL.md` | small, chunk if needed |
| `soul.latest` | Tiny pointer to latest snapshot tx/hash | tiny |
| `manifest.snapshot` | Encrypted map of what is backed up | small |
| `manifest.latest` | Tiny pointer to latest manifest | tiny |
| `identity.hashes` | Hash set for SOUL/protocol/skill/tool identity restore | tiny |
| `hxmp.policy` | Encrypted/public policy snapshot | small |

Future types:

- `memory.bundle`
- `memory.latest`
- `skill.snapshot`
- `skill.latest`

## Envelope Format

A memo should be compact JSON with a visible routing header and encrypted body.

```json
{
  "p": "HXMP",
  "v": 1,
  "t": "soul.snapshot",
  "owner": "<x1-public-key>",
  "agentid": {
    "verified": true,
    "program": "7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2",
    "wallet": "<x1-public-key>",
    "nft_mint": "<agentid-nft-mint-if-known>",
    "verify_url": "https://agentid-app.vercel.app/api/verify?wallet=<x1-public-key>"
  },
  "seq": 1,
  "hash": "sha256:<plaintext-sha256>",
  "enc": "xchacha20poly1305|aes-256-gcm|age",
  "nonce": "<base64url>",
  "ct": "<base64url-ciphertext>",
  "ts": "2026-07-05T00:00:00Z"
}
```

Latest pointer:

```json
{
  "p": "HXMP",
  "v": 1,
  "t": "soul.latest",
  "owner": "<x1-public-key>",
  "seq": 2,
  "hash": "sha256:<snapshot-plaintext-sha256>",
  "ref": "<snapshot-transaction-signature>",
  "ts": "2026-07-05T00:00:00Z"
}
```

The latest pointer does not need to contain private content. It lets agents fetch the latest snapshot without scanning every historical snapshot.


### HXMP v0 write-size limits

HXMP v0 is memo-backed and intentionally small. Before signing, tools must enforce:

| Limit | Value |
|---|---:|
| Plaintext/source bytes per memory write | 8,192 bytes |
| Ciphertext chunk size | 360 base64url chars |
| Maximum chunks per write | 32 |
| Serialized transaction size | <= 1,232 bytes |

If `SOUL.md` or another source exceeds this limit, stop. Do not silently truncate. Ask for a compact SOUL.md/summary or use a future manifest-backed split protocol. The SHA-256 must be over the exact plaintext that is encrypted and written.

## Cheap Storage Strategy

Use **Option A: encrypted memo transactions** for v0.

Why:

- No custom X1 program required.
- Cheap to write.
- Easy for any Solana/SVM-compatible tooling.
- Good enough for small identity and workflow records.

Do **not** write large memories one-by-one if a compact summary or pointer is enough. Prefer:

1. Full encrypted snapshot only when content changes materially.
2. Tiny `*.latest` pointer after each snapshot.
3. Local cache of seen signatures to avoid repeated RPC scanning.
4. Pagination only until the newest valid `*.latest` record is found.

Reading from RPC does **not** burn XNT gas. It can be slow/rate-limited, but it is not an on-chain transaction. Gas is spent only when signing/sending writes.

## Efficient Retrieval Algorithm

Do not fetch all memories by default.

For `/readx1 soul`:

1. Load local index cache if present.
2. Query `getSignaturesForAddress(owner, {limit: 25})`.
3. For signatures not in cache, fetch transactions with `getTransaction`.
4. Extract memo instructions containing `"p":"HXMP"`.
5. Find newest valid `t="soul.latest"` for this owner.
6. Use its `ref` signature to fetch the corresponding `soul.snapshot`.
7. Decrypt snapshot locally.
8. Verify `sha256(plaintext)` equals the `hash` in both snapshot and latest pointer.
9. Update local index cache.
10. Stop. Do not scan older pages unless no valid latest pointer is found.

Only use deeper pagination for `/readx1 all`, `/x1memory audit`, or recovery mode.

Batching note: Solana JSON-RPC servers often accept JSON-RPC batch arrays, but support varies. Prefer small batches; fall back to one-by-one if the endpoint rejects batch requests.

## Unified AgentID → HXMP Write Flow

AgentID is not optional for normal HXMP writes. **Step 1 is always identity:** verify or register the agent wallet as a soulbound AgentID NFT before writing memory to X1. HXMP hashes, pointers, manifests, and encrypted snapshots must be permanently tied to that AgentID wallet/NFT so a future agent can recover the same identity anchor instead of treating chain memory as anonymous data.

When the user asks `/writex1 soul`, “write SOUL.md to X1”, “register AgentID and write memory”, or similar:

1. Locate `SOUL.md` for the active profile. Default profile path is `~/.hermes/SOUL.md`; named profiles use `~/.hermes/profiles/<profile-name>/SOUL.md`.
2. Check X1 wallet public key and native XNT balance. Never print the secret key.
3. Verify AgentID for the wallet with `GET https://agentid-app.vercel.app/api/verify?wallet=<wallet>`.
4. If `verified: false`, enter the AgentID prerequisite flow before any HXMP write:
   - present exact AgentID card-safe name, short saying/tagline, wallet, required `0.1 AGI` burn, XNT/AGI status, and irreversible soulbound NFT effects;
   - ask the user for explicit approval before signing/spending/burning/minting;
   - use the AgentID API/docs and `scripts/agentid_register.mjs` or the website/wallet UI to perform XNT→AGI if needed, register, mint/attach the soulbound NFT, finalize, and verify again;
   - fetch/send the AgentID NFT/card image when the AgentID API response, NFT metadata, website, or documented docs endpoint exposes an image URL. If no image URL/endpoint is exposed but verification succeeds, send the verify result, NFT mint, tx links, and continue only after identity is verified. Do not fabricate an image URL; treat image delivery as best-effort evidence, not the identity proof itself.
5. If `verified: true`, capture available AgentID/card/NFT fields for the HXMP envelope and receipt.
6. Read the SOUL/memory content and classify sensitivity. If it includes private/sensitive content, stop and explain what must be removed or ask for explicit force-confirmation.
7. Compute SHA-256 of the plaintext. HXMP writes should contain encrypted content plus visible integrity hashes/pointers, not plaintext memory. The hash verifies the decrypted content; it is not a substitute for the encrypted snapshot.
8. Build a write preview:
   - file path / content source
   - byte size
   - plaintext SHA-256
   - AgentID verification status, wallet, NFT mint/card fields if known
   - record type: `soul.snapshot` + `soul.latest` + manifest update if enabled
   - estimated writes: usually 2-3 memo txs depending on manifest update
   - safety classification
   - exact plaintext summary, not full secrets
   - what will be encrypted vs what metadata/hash will remain visible
9. Ask for explicit user confirmation before signing any HXMP write.
10. Encrypt the snapshot with the HXMP encryption key.
11. Send a `soul.snapshot` memo tx containing the encrypted body, plaintext hash, and AgentID linkage.
12. Send a `soul.latest` memo tx referencing the snapshot tx/hash.
13. Update `manifest.snapshot` / `manifest.latest` when enabled.
14. Read back the latest pointer, fetch the snapshot, decrypt locally, and verify the plaintext hash.
15. Return:
   - AgentID verify result and NFT/card info if available
   - AgentID card image if available
   - snapshot tx signature
   - latest pointer tx signature and explorer link
   - encrypted snapshot chunk tx signature(s) and explorer link(s)
   - manifest tx signature and explorer link if updated
   - plaintext SHA-256
   - explicit hash record link: the `soul.latest` / hash-pointer explorer URL where the hash is stored
   - core identity hashes tx/link (`identity.hashes`) for restore-time verification
   - readback verification result
   - what was written at a high level
   - what was **not** written, especially no secret key

Completion criterion: the agent has a verified AgentID soulbound NFT first, the user approved each state-changing phase, the user receives the AgentID/NFT/card evidence, HXMP tx signature(s), hash, and a successful post-write read/verify check.

## `/readx1 soul` Agent Flow

When the user asks `/readx1 soul`:

1. Check wallet public key.
2. Verify AgentID for the wallet; prefer records signed by/linked to the verified AgentID wallet and not superseded/revoked.
3. Query only recent signatures first.
4. Find newest valid `manifest.latest` if available; otherwise find newest valid `soul.latest` pointer.
5. Fetch referenced `soul.snapshot`.
6. Decrypt locally.
7. Verify hash.
8. Report:
   - AgentID verification status / NFT mint if known
   - manifest pointer tx if used
   - latest pointer tx
   - snapshot tx
   - SHA-256
   - byte size
   - age/timestamp if available
   - summary or full content depending on user request

Completion criterion: decrypted content hash matches the on-chain hash, the record is linked to the expected AgentID wallet, and the agent can show the latest pointer and snapshot tx.

## Solana CLI Tracer Bullet

If the Solana CLI works against X1 RPC, the simplest v0 write can be a zero-value self-transfer with memo:

```bash
solana --url https://rpc.mainnet.x1.xyz/ balance <PUBLIC_KEY>

solana --url https://rpc.mainnet.x1.xyz/ transfer \
  --keypair ~/.hermes/x1/default/id.json \
  --allow-unfunded-recipient \
  --with-memo '<COMPACT_HXMP_JSON>' \
  <PUBLIC_KEY> \
  0
```

This is not the most elegant memo-only transaction, but it is easy and testable. A later MCP/tool can construct a memo-only transaction with a Solana SDK to reduce overhead.


## Encryption Key Backup + SOUL Change Detection

The HXMP encryption key is required for readback/restore but must never be written to chain, chat, logs, or receipts. Back it up to a local secure secret store. On macOS, use Keychain via the tool:

```bash
node scripts/hxmp_tools.mjs backup-encryption-key \
  --wallet <WALLET_PUBLIC_KEY> \
  --profile default \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
```

Restore from local Keychain:

```bash
node scripts/hxmp_tools.mjs restore-encryption-key \
  --wallet <WALLET_PUBLIC_KEY> \
  --profile default \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
```

To know whether `SOUL.md` changed and needs a new on-chain hash, run:

```bash
node scripts/hxmp_tools.mjs soul-status \
  --wallet <WALLET_PUBLIC_KEY> \
  --profile default
```

If `up_to_date: true`, do not write. If `needs_hxmp_write: true`, run `dry-run-soul`, show the user the new SHA-256 and receipt plan, ask explicit approval, then run `write-soul`. Never auto-write SOUL changes without approval.

## Executable HXMP Tools

A named Hermes profile can use a profile-local plugin plus script tool layer for this skill:

```text
Plugin: ~/.hermes/profiles/<profile-name>/plugins/x1-hxmp/
Script: ~/.hermes/profiles/<profile-name>/skills/cryptocurrency/x1-memory-protocol/scripts/hxmp_tools.mjs
Wallet script: ~/.hermes/profiles/<profile-name>/skills/cryptocurrency/x1-memory-protocol/scripts/x1_wallet_tools.mjs
Toolset: x1_hxmp
```

Registered Hermes tools:

| Tool | Purpose | State-changing? |
|---|---|---|
| `x1_wallet_status` | Check native XNT and AgentID verify status. | No |
| `x1_transfer_preview` | Validate, fee-check, build, and simulate an exact native XNT or token transfer without loading a keypair. | No |
| `x1_transfer` | Rebuild, sign, broadcast, confirm, and balance-verify the exact approved transfer. | Yes |
| `agentid_nft_image` | Fetch AgentID verify data, NFT metadata URI, metadata `image` URL/card, and optionally download it for chat delivery. | No |
| `hxmp_dry_run_soul` | Read SOUL.md, verify AgentID, classify safety, compute SHA-256, and produce the exact write preview. | No |
| `hxmp_write_soul` | Encrypt SOUL.md and write `soul.snapshot` + `soul.latest` memo records, then read back/verify. Requires AgentID, exact expected SHA-256, `execute=true`, and `confirm_write=true`. | Yes |
| `hxmp_read_soul` | Read newest `soul.latest`, fetch/decrypt snapshot, and verify SHA-256. | No |
| `hxmp_scan_manifest` | Shallow scan recent wallet transactions for HXMP records/manifests. | No |

Equivalent script commands for terminal use:

```bash
node scripts/hxmp_tools.mjs wallet-status --wallet <WALLET_PUBLIC_KEY>
node scripts/x1_wallet_tools.mjs transfer-preview --wallet <WALLET_PUBLIC_KEY> --to <RECIPIENT_OWNER_WALLET> --amount <AMOUNT> [--mint <TOKEN_MINT>]
node scripts/x1_wallet_tools.mjs transfer --keypair ~/.hermes/x1/default/id.json --to <RECIPIENT_OWNER_WALLET> --amount <AMOUNT> [--mint <TOKEN_MINT>] --expected-preview-sha256 sha256:<APPROVED_HASH> --execute --confirm-transfer
node scripts/hxmp_tools.mjs soul-status --wallet <WALLET_PUBLIC_KEY> --profile default
node scripts/hxmp_tools.mjs backup-encryption-key --wallet <WALLET_PUBLIC_KEY> --profile default --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
node scripts/hxmp_tools.mjs agentid-nft-image --wallet <WALLET_PUBLIC_KEY> --out /tmp/agentid-card.svg
node scripts/hxmp_tools.mjs dry-run-soul --wallet <WALLET_PUBLIC_KEY> --profile default
node scripts/hxmp_tools.mjs init-encryption-key --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
node scripts/hxmp_tools.mjs write-soul \
  --keypair ~/.hermes/x1/default/id.json \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key \
  --expected-sha256 sha256:<HASH_FROM_DRY_RUN> \
  --execute --confirm-write
node scripts/hxmp_tools.mjs read-soul --wallet <WALLET_PUBLIC_KEY> --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
node scripts/hxmp_tools.mjs scan-manifest --wallet <WALLET_PUBLIC_KEY>
```

HXMP hash links are mandatory in the user receipt: send the plaintext SHA-256, the `soul.latest`/hash-pointer explorer URL, and every snapshot chunk explorer URL.

Safety invariant: `hxmp_write_soul` refuses to write unless AgentID verifies true and the current source hash exactly matches `--expected-sha256` from dry run. It never prints wallet secret bytes or encryption key bytes. The plugin is enabled for an agent via `plugins.enabled: [x1-hxmp]` and `toolsets: [x1_hxmp]`; The agent needs a fresh session/restart for newly added tools to appear in the prompt.

## X1Harness Token + Liquidity Tools

HXMP is the memory/receipt layer, but this protocol suite also carries the X1Harness-derived XDEX tool path so an agent that loads only `x1-memory-protocol` can discover token creation and liquidity operations. Generic X1 token creation uses the standard SPL Token program:

```text
TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
```

The AgentID program is separate and must not be used for generic token minting:

```text
7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2
```

The executable tool is available here in the HXMP skill copy and in `xdex-token-liquidity-ops`:

```bash
node scripts/xdex_tools.mjs help
node scripts/xdex_tools.mjs create-token --name <NAME> --symbol <SYMBOL> --decimals <0-9> --supply <AMOUNT>
node scripts/xdex_tools.mjs create-pool --wallet <WALLET> --token-mint <MINT> --xnt <AMOUNT> --token <AMOUNT>
node scripts/xdex_tools.mjs add-liquidity --pool <POOL_STATE> --xnt <AMOUNT>
node scripts/xdex_tools.mjs remove-liquidity --pool <POOL_STATE> --lp <AMOUNT>
```

State-changing execution requires explicit user approval and both flags:

```bash
node scripts/xdex_tools.mjs create-token --keypair <ID_JSON> --name <NAME> --symbol <SYMBOL> --decimals <N> --supply <AMOUNT> --execute --confirm-execute --hxmp-receipt
node scripts/xdex_tools.mjs create-pool --keypair <ID_JSON> --token-mint <MINT> --xnt <AMOUNT> --token <AMOUNT> --execute --confirm-execute --hxmp-receipt
node scripts/xdex_tools.mjs add-liquidity --keypair <ID_JSON> --pool <POOL_STATE> --xnt <AMOUNT> --slippage-bps 300 --execute --confirm-execute --hxmp-receipt
node scripts/xdex_tools.mjs remove-liquidity --keypair <ID_JSON> --pool <POOL_STATE> --lp <AMOUNT> --slippage-bps 300 --execute --confirm-execute --hxmp-receipt
```

When `--hxmp-receipt` is present, the tool writes a non-secret HXMP `defi.receipt` memo after the successful XDEX action. Never include wallet secrets, encryption keys, or private personal data in these receipts. First live execution should use tiny amounts and verify explorer links before larger funds.

## Native Slash Commands vs Skills

A skill makes agents know what to do. It does not by itself add native Hermes slash commands.

Practical stages:

1. **Skill-only v0**: user types `/writex1 soul`; the agent interprets it and follows this skill.
2. **Script/tool v0.1**: skill ships scripts for RPC scan, envelope build, and CLI-assisted writes.
3. **MCP/plugin v1**: adds actual tools such as `x1_write_memory`, `x1_read_memory`, `x1_wallet_status`.
4. **Hermes slash command v1**: `/writex1` and `/readx1` become registered commands/buttons.

For an agent to write to chain, it needs this skill plus signing capability: a funded X1 wallet, a protected secret key, a local encryption key, and either Solana CLI or an X1/Solana SDK tool.

## Common Pitfalls

1. **Thinking encryption removes privacy risk.** It does not. Chain metadata is permanent and visible.
2. **Skipping the AgentID API endpoint.** Always call `GET https://agentid-app.vercel.app/api/verify?wallet=<wallet>` first; do not infer AgentID status from balance, UI, memory, or vibes.
3. **Looping on XDEX `Available: 0 tokens`.** That can mean a frontend/internal API is not seeing native XNT as an SPL token. Check native XNT with RPC `getBalance`; AgentID does not require pre-existing WXNT or manual wrapping. Use the AgentID API/docs or website/wallet UI, and do not invent new API parameters.
4. **Trying to use Solana CLI as a transaction builder.** `--sign-only` signs an already-built transaction; it does not create custom XDEX swap, `register_agent`, or `attach_agent_nft` instructions. Use website UI, an SDK script, Anchor/IDL instruction builder, or a Hermes tool/MCP. If an agent repeats this idea, stop with `tool layer missing: transaction builder for XDEX swap + AgentID register/attach`.
5. **Blaming X1 token compatibility or `@solana/spl-token` signatures.** Do not use `@solana/spl-token` helpers as the authority for this flow. The shipped `scripts/agentid_register.mjs` intentionally builds ATA creation as a raw `TransactionInstruction` matching the AgentID website JavaScript. If the agent mentions `createAssociatedTokenAccountInstruction` signature drift, tell him to stop using that library helper and run this tool.
6. **Scanning the whole chain every read.** Use `soul.latest`, local cache, and shallow pagination first.
6. **Writing every small memory as its own tx.** Prefer snapshots, summaries, and latest pointers.
7. **Assuming skills create slash commands.** They do not; implement a plugin/MCP/tool for native UX.
8. **Writing large plaintext into memos.** Always encrypt first; chunk only if necessary.
9. **Using wallet secret as encryption key by default.** Keep signing and encryption keys separate.
10. **Misdiagnosing escaped memo JSON as write failure.** X1/Solana RPC may return memo JSON as raw `{...}` or escaped `{\"p\":\"HXMP\"...}` strings. `scan-manifest` and `read-soul` must try raw, decoded, and unescaped variants before declaring records missing. See `references/hxmp-memo-readback-escaping.md`.
11. **Reporting success without verification.** Always read back and verify the plaintext hash after writing.
12. **Treating simple transfers as an undocumented edge case.** Use `transfer-preview` followed by the exact hash-bound `transfer`; never guess decimals, recipient ATA, fees, or raw instruction data, and never substitute an XDEX swap for a wallet transfer.

## Verification Checklist

- [ ] X1 RPC `getHealth` returns `ok`.
- [ ] AgentID docs were checked or known current: `https://agentid-app.vercel.app/api/docs`.
- [ ] Wallet public key is known; secret key was not printed or written.
- [ ] For a transfer, the exact preview simulated successfully and the user approved its hash-bound intent.
- [ ] A completed transfer has a confirmed signature, explorer link, and verified source/recipient balance deltas.
- [ ] AgentID verification was checked with `GET /api/verify?wallet=<wallet>`.
- [ ] Wallet owns/verifies a soulbound AgentID NFT, or the user explicitly disabled the AgentID prerequisite.
- [ ] Wallet has enough XNT for the intended memo txs and enough AGI/registration status if AgentID setup is needed.
- [ ] Content was classified and previewed to the user.
- [ ] User approved the write.
- [ ] Plaintext SHA-256 was computed before encryption.
- [ ] Encrypted `soul.snapshot` memo was sent and includes AgentID linkage metadata where available.
- [ ] `soul.latest` pointer memo was sent.
- [ ] Manifest was updated when enabled.
- [ ] Agent read back the latest pointer, fetched the snapshot, decrypted, and verified the hash.
- [ ] If AgentID card image was available, it was sent to the user; otherwise verify/explorer links were included.
- [ ] Final report includes AgentID status, tx signatures, explorer links for the HXMP latest/hash pointer and snapshot chunks, hash, size, readback verification, and high-level summary of what was written.
