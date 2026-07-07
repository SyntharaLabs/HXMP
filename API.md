# HXMP Agent API and Instruction Guide

This file is the public agent-facing API for HXMP.

It tells an AI agent how to use X1, Agent ID Protocol, encrypted memory, receipts, token creation, and liquidity tools safely.

## Core rules

1. Read-only actions may run without user approval.
2. State-changing actions require explicit user approval.
3. Never print or transmit wallet secret bytes.
4. Never print or transmit HXMP memory key bytes.
5. Never write private personal information to chain by default, even encrypted.
6. Always preview state-changing actions before execution.
7. Always write receipts without secrets.
8. Always verify readback after memory writes.

## Required local files

Use placeholders in public docs and scripts.

```text
~/.hermes/x1/default/id.json
~/.hermes/x1/default/hxmp-encryption.key
~/.hermes/x1/default/index.json
```

`id.json` is the Solana-style X1 wallet keypair. It signs transactions.

`hxmp-encryption.key` is the memory encryption key. It decrypts HXMP memory.

`index.json` is a local cache and must not contain secrets.

## Wallet and Solana/SVM tool setup

X1 is SVM-compatible, so agents can use Solana-style keypairs and many Solana tools with the X1 RPC URL.

Recommended local wallet path:

```text
~/.hermes/x1/default/id.json
```

Create the directory:

```bash
mkdir -p ~/.hermes/x1/default
chmod 700 ~/.hermes/x1/default
```

Create a new Solana-style keypair for X1:

```bash
solana-keygen new --outfile ~/.hermes/x1/default/id.json
chmod 600 ~/.hermes/x1/default/id.json
```

Show the public wallet address without printing the secret key:

```bash
solana address -k ~/.hermes/x1/default/id.json
```

Configure Solana CLI for X1 when using Solana CLI commands:

```bash
solana config set --url https://rpc.mainnet.x1.xyz/
solana config set --keypair ~/.hermes/x1/default/id.json
```

Check native XNT balance:

```bash
solana balance -u https://rpc.mainnet.x1.xyz/ ~/.hermes/x1/default/id.json
```

Agents must treat `id.json` as wallet secret material. Never print it, paste it, upload it, commit it, or read it during dry-run. Only execution flows that the user explicitly approves may load the keypair.

The wallet needs native XNT for gas before it can write HXMP records, register identity, create tokens, or manage liquidity. Read-only RPC checks do not require gas.

## Step 1: Check X1 RPC

```bash
node scripts/hxmp_tools.mjs rpc-health
```

Expected result: healthy X1 RPC status.

## Step 2: Check wallet status

```bash
node scripts/hxmp_tools.mjs wallet-status --wallet <WALLET_PUBLIC_KEY>
```

The agent should inspect:

1. Native XNT balance.
2. Agent ID Protocol verification status.
3. Whether HXMP writes are allowed.

Do not infer identity from balances or UI state. Use the Agent ID Protocol API.

## Step 3: Verify Agent ID Protocol

```text
GET https://agentid-app.vercel.app/api/verify?wallet=<WALLET_PUBLIC_KEY>
```

If `verified: true`, continue.

If `verified: false`, stop HXMP writes and guide the user through registration.

If the endpoint fails, stop and report the endpoint failure. Do not invent verification status.

## Step 4: Register Agent ID Protocol identity when needed

Dry run first. Dry runs must use `--wallet` and must not read a keypair file.

```bash
node scripts/agentid_register.mjs register-flow \
  --wallet <WALLET_PUBLIC_KEY> \
  --name "<AGENT_NAME>" \
  --description "<SHORT_TAGLINE>"
```

Execution requires the keypair and explicit approval flags.

```bash
node scripts/agentid_register.mjs register-flow \
  --keypair ~/.hermes/x1/default/id.json \
  --name "<AGENT_NAME>" \
  --description "<SHORT_TAGLINE>" \
  --execute --confirm-execute
```

This may swap XNT to AGI, burn AGI, register the agent, attach the soulbound NFT, post registration API calls, and verify the result.

## Agent ID NFT card image retrieval

After Agent ID registration or when verifying an existing Agent ID, fetch the card image from the NFT metadata source, not from a guessed URL.

```bash
node scripts/hxmp_tools.mjs agentid-nft-image \
  --wallet <WALLET_PUBLIC_KEY> \
  --out /tmp/agentid-card.svg
```

The tool follows this path:

```text
GET /api/verify?wallet=<wallet>
  -> verify.nft.metadataUri
  -> NFT metadata JSON
  -> metadata.image
  -> downloaded card image file
```

Send the downloaded image to the user as part of the Agent ID receipt. If the image is SVG and the chat/app needs PNG, render or convert it to PNG before delivery. If metadata has no `image` field but verification succeeds, report the Agent ID verify result, NFT mint, and explorer links instead. Do not fabricate image endpoints.

## Step 5: Create or restore HXMP encryption key

Create a local memory key:

```bash
node scripts/hxmp_tools.mjs init-encryption-key \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
```

Back it up locally. The key must never be committed, pasted into chat, written to chain, or logged.

```bash
node scripts/hxmp_tools.mjs backup-encryption-key \
  --wallet <WALLET_PUBLIC_KEY> \
  --profile default \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
```

## Step 6: Dry-run a memory write

```bash
node scripts/hxmp_tools.mjs dry-run-soul \
  --wallet <WALLET_PUBLIC_KEY> \
  --profile default \
  --lane core
```

The dry run returns:

1. Source path.
2. Byte size.
3. Plaintext SHA-256.
4. Agent ID Protocol status.
5. Safety classification.
6. Planned records.
7. What will be visible on-chain.
8. What will be encrypted.
9. Lane, sequence number, previous hash, and previous latest pointer when available.

## Memory lanes and book navigation

HXMP uses the newest valid `soul.latest` pointer as the agent's bookmark. For large memories, the pointer carries organization fields:

| Field | Meaning |
|---|---|
| `lane` | Memory chapter such as `core`, `receipt`, `tool`, `identity`, or `game`. Default is `core`. |
| `seq` | Sequence/page number in that lane. |
| `prev` | Previous memory hash in that lane. |
| `sid` | Snapshot id for retrieving encrypted chunks. |
| `n` | Expected chunk count. |

When writing a new memory, the agent scans existing HXMP records for the newest pointer in the lane, sets `seq` to previous sequence plus one, and sets `prev` to the previous memory hash. When reading, the agent finds the newest pointer for the lane and retrieves matching chunks by wallet, hash, and snapshot id.

If the memory book becomes very large, add periodic `manifest.latest` checkpoints as a table of contents for lanes.

If the safety classifier flags sensitive content, stop and ask the user to redact or confirm a safer source.

## Step 7: Execute memory write after approval

Only execute after the user approves the preview and exact hash.

```bash
node scripts/hxmp_tools.mjs write-soul \
  --keypair ~/.hermes/x1/default/id.json \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key \
  --expected-sha256 sha256:<HASH_FROM_DRY_RUN> \
  --execute --confirm-write
```

The tool writes encrypted chunks, an identity hash record, and a latest pointer. It then reads back and verifies the hash.

## Step 8: Read memory

```bash
node scripts/hxmp_tools.mjs read-soul \
  --wallet <WALLET_PUBLIC_KEY> \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
```

The read path must verify:

1. The latest pointer belongs to the requested wallet.
2. Snapshot chunks belong to the same wallet.
3. Snapshot chunk hashes match the latest pointer.
4. Chunk indexes are complete.
5. Snapshot IDs are consistent.
6. The decrypted plaintext hash matches the on-chain hash.

## Step 9: Token creation

Preview first:

```bash
node scripts/xdex_tools.mjs create-token \
  --wallet <WALLET_PUBLIC_KEY> \
  --name "<TOKEN_NAME>" \
  --symbol "<SYMBOL>" \
  --decimals 9 \
  --supply 1000000
```

Execute only after approval:

```bash
node scripts/xdex_tools.mjs create-token \
  --keypair ~/.hermes/x1/default/id.json \
  --name "<TOKEN_NAME>" \
  --symbol "<SYMBOL>" \
  --decimals 9 \
  --supply 1000000 \
  --execute --confirm-execute --hxmp-receipt
```

## Step 10: Liquidity operations

Read-only quotes:

```bash
node scripts/xdex_tools.mjs quote-add-liquidity --pool <POOL_STATE> --xnt <AMOUNT>
node scripts/xdex_tools.mjs quote-remove-liquidity --pool <POOL_STATE> --lp <AMOUNT>
```

Execution requires explicit approval:

```bash
node scripts/xdex_tools.mjs add-liquidity \
  --keypair ~/.hermes/x1/default/id.json \
  --pool <POOL_STATE> \
  --xnt <AMOUNT> \
  --slippage-bps 300 \
  --execute --confirm-execute --hxmp-receipt
```

```bash
node scripts/xdex_tools.mjs remove-liquidity \
  --keypair ~/.hermes/x1/default/id.json \
  --pool <POOL_STATE> \
  --lp <AMOUNT> \
  --slippage-bps 300 \
  --execute --confirm-execute --hxmp-receipt
```

## Refusal rules

An agent must refuse or stop when:

1. The user has not approved a state-changing action.
2. Agent ID Protocol verification fails for a normal HXMP write.
3. The requested source contains secrets or private personal data.
4. The dry-run hash does not match the write-time hash.
5. The keypair path is requested during dry-run.
6. A tool would write secrets, private data, or raw memory to chain.
7. A readback hash fails verification.
8. A transaction or receipt would omit important user-visible details.

## Disclaimer

HXMP and related scripts are experimental developer tools. They are not financial advice, legal advice, investment advice, or a promise of profit, security, privacy, or regulatory compliance.

Users are responsible for reviewing transactions, protecting keys, understanding gas costs, and complying with applicable laws.

## Receipt rules

Receipts may contain:

1. Public wallet address.
2. Transaction signature.
3. Explorer link.
4. Action type.
5. Public token mint or pool address.
6. Plaintext SHA-256 hash for encrypted memory.

Receipts must not contain:

1. Wallet secret keys.
2. HXMP encryption key bytes.
3. Seed phrases.
4. API keys.
5. Private personal data.
6. Private chat logs.
7. Sensitive business or financial details beyond what the user approved.
