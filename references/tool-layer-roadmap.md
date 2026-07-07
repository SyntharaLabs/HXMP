# HXMP Tool Layer Roadmap

This reference captures the recommended build path for turning the `x1-memory-protocol` skill from an operating guide into executable tools.

## Core distinction

- Skill = protocol/instructions/safety policy.
- Script = reusable helper an agent can run through terminal/tool access.
- Hermes plugin or MCP server = first-class callable tools exposed to the agent.
- Slash command = UX layer after the underlying tools work.

Do not imply that installing the skill alone creates native `/writex1` or `/readx1` commands. Until a plugin/MCP/slash-command layer exists, those strings are instructions the agent interprets.

## Build order

Start read-only, then dry-run, then signing:

1. `agentid_verify.py`
   - Input: X1 wallet public key.
   - Calls `GET https://agentid-app.vercel.app/api/verify?wallet=<wallet>`.
   - Returns verified status, AgentID/NFT/card fields if present.

2. `x1_rpc.py`
   - Health, slot, version, balance, signatures, transaction fetch.
   - No signing.

3. `hxmp_dry_run.py`
   - Reads `SOUL.md`, hashes it, classifies safety, verifies AgentID, estimates records/tx count, and prints an exact preview.
   - Never signs or broadcasts.

4. `hxmp_read.py`
   - Uses local cache + shallow `getSignaturesForAddress` scan.
   - Finds newest manifest/latest pointer, fetches snapshot, decrypts locally, verifies SHA-256.

5. `hxmp_write_soul.py`
   - Requires verified AgentID unless explicitly overridden by user.
   - Requires explicit user confirmation of the preview.
   - Encrypts SOUL snapshot, sends `soul.snapshot`, sends `soul.latest`, updates manifest when enabled, reads back, verifies hash, returns receipt.

6. Wrap scripts as a Hermes plugin or MCP server.

7. Add native slash-command UX only after the tools are verified.

## Candidate tool names

```text
agentid_verify
x1_wallet_status
x1_rpc_health
hxmp_dry_run_soul
hxmp_write_soul
hxmp_read_soul
hxmp_scan_manifest
hxmp_write_receipt
```

## Required safety invariant

Every state-changing tool must enforce:

```text
preview → explicit user confirmation → sign → send → verify → receipt
```

The model must not be able to bypass confirmation by simply deciding to sign. Confirmation should happen in tool code or gateway approval flow, not only in natural language.

## Secret handling

- Never print wallet secret keys, seed phrases, private keys, API keys, or encryption keys.
- Store signing key and memory encryption key separately.
- Prefer macOS Keychain, Hermes secrets, Bitwarden/1Password, or chmod `0600` encrypted files.
- The receipt should include public key, AgentID status, tx signatures, hashes, and high-level content summary only.

## DeFi tool relationship

XDEX/token/liquidity tooling should remain separate from HXMP. HXMP can store non-secret receipts for XDEX actions, but it should not become the DeFi execution tool itself.
