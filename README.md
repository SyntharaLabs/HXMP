[README.md](https://github.com/user-attachments/files/29750466/README.md)
# HXMP: Hermes X1 Memory Protocol

HXMP means **Hermes X1 Memory Protocol**.

HXMP is a protocol and tool layer for AI agents on X1. It gives agents a structured way to use X1 for identity-linked memory, receipts, and safe blockchain operations.

HXMP is designed around a simple rule:

> Public proof. Private readability.

The chain can hold hashes, encrypted chunks, timestamps, receipts, and identity links. The readable memory stays encrypted. The memory key stays local.

## What HXMP does

HXMP helps agents:

1. Verify an Agent ID Protocol identity.
2. Create encrypted memory records.
3. Write public hashes for private memory.
4. Create latest-memory pointers with lane, sequence, and previous-hash links.
5. Link memory and receipts to an agent identity.
6. Recover encrypted records through X1 RPC.
7. Decrypt memory locally.
8. Verify recovered memory against on-chain hashes.
9. Write non-secret receipts for important actions.
10. Use X1 tools for token creation and liquidity operations with explicit approval.

## What HXMP does not do

HXMP does not make the blockchain private.

Observers can still see public metadata such as wallet addresses, timestamps, record types, hashes, encrypted chunk counts, and transaction signatures.

HXMP must not be used to publish private personal information, wallet secrets, seed phrases, API keys, passwords, private chat logs, medical data, banking data, legal data, or third-party private information.

## Wallet key vs memory key

HXMP separates signing from reading.

| Key | Purpose |
|---|---|
| X1 wallet key | Signs transactions and pays gas. |
| HXMP memory key | Encrypts and decrypts memory locally. |

The wallet key is never printed. The memory key is never written to chain.

## Safety model

Read-only commands can run without approval.

Reading HXMP records through X1 RPC is free in the sense that it does **not** spend XNT gas, because it does not sign or submit a transaction. Network providers may still rate-limit RPC calls.

State-changing commands require explicit approval and execution flags. Writing memory, registering identity, creating tokens, adding liquidity, removing liquidity, or moving assets must never happen automatically.

Treat any HXMP/agent wallet like a **hot wallet**. It exists for identity, memory, receipts, learning, and experimental protocol work. Do not use it as a treasury, savings wallet, or place to store meaningful funds. Keep only the small amount of XNT/AGI needed for tests and approved operations.

Typical write commands require flags like:

```bash
--execute --confirm-execute
```

HXMP memory writes also require an exact hash from a dry run:

```bash
--expected-sha256 sha256:<hash-from-dry-run> --execute --confirm-write
```

## Memory organization

HXMP uses `soul.latest` as the agent's current bookmark. Each new memory write can include:

| Field | Meaning |
|---|---|
| `lane` | The memory chapter, default `core`. |
| `seq` | The sequence/page number inside that lane. |
| `prev` | The previous memory hash for that lane. |
| `sid` | Snapshot id used to find encrypted chunks. |
| `n` | Number of chunks in the snapshot. |

This lets an agent find its place in a large memory book: read the newest `soul.latest`, check the lane and sequence, follow `prev` backward if needed, retrieve chunks by `sid`, decrypt locally, and verify the hash.

## Agent ID Protocol prerequisite

Normal HXMP memory writes require an **X1 wallet funded with XNT** and the wallet must verify as an Agent ID Protocol identity first.

XNT is the native gas token on X1. It is also used in the Agent ID setup flow to buy AGI. Agent ID creation then burns the required AGI and attaches a soulbound Agent ID NFT/card to the wallet.

In short:

```text
X1 wallet + XNT gas
  -> buy AGI
  -> burn required AGI
  -> register Agent ID Protocol identity
  -> attach soulbound Agent ID NFT/card
  -> HXMP memory writes can proceed
```

Read-only verification endpoint:

```text
GET https://agentid-app.vercel.app/api/verify?wallet=<WALLET_PUBLIC_KEY>
```

If verification fails, the agent should stop and guide the user through Agent ID Protocol registration before writing memory.

## Quick start for agents

Read the full agent instructions and manifests first:

```text
AGENTS.md
API.md
TOOL_MANIFEST.json
SKILL_MANIFEST.json
```

Then use the scripts in `scripts/`.

Read-only examples:

```bash
node scripts/hxmp_tools.mjs rpc-health
node scripts/hxmp_tools.mjs wallet-status --wallet <WALLET_PUBLIC_KEY>
node scripts/hxmp_tools.mjs dry-run-soul --wallet <WALLET_PUBLIC_KEY> --profile default
node scripts/hxmp_tools.mjs agentid-nft-image --wallet <WALLET_PUBLIC_KEY> --out /tmp/agentid-card.svg
node scripts/hxmp_tools.mjs read-soul --wallet <WALLET_PUBLIC_KEY> --encryption-key ~/.hermes/x1/default/hxmp-encryption.key
node scripts/agentid_register.mjs status --wallet <WALLET_PUBLIC_KEY>
node scripts/xdex_tools.mjs wallet-tokens --wallet <WALLET_PUBLIC_KEY>
```

State-changing examples require explicit approval:

```bash
node scripts/hxmp_tools.mjs write-soul \
  --keypair ~/.hermes/x1/default/id.json \
  --encryption-key ~/.hermes/x1/default/hxmp-encryption.key \
  --expected-sha256 sha256:<HASH_FROM_DRY_RUN> \
  --execute --confirm-write
```

## GitHub safety

This repository intentionally excludes key files through `.gitignore`.

Never commit:

```text
id.json
hxmp-encryption.key
.env
private keys
seed phrases
API keys
wallet secret material
```

## Disclaimer

HXMP and related scripts are experimental developer tools. They are not financial advice, legal advice, investment advice, or a promise of profit, security, privacy, or regulatory compliance.

Users are responsible for reviewing transactions, protecting keys, understanding gas costs, treating agent wallets as hot wallets, limiting funds held there, and complying with applicable laws.

## Status

HXMP is early infrastructure. Treat it as an experimental protocol and tool layer. Review every state-changing action before execution.
