# Instructions for AI Agents

This repository contains HXMP, the Hermes X1 Memory Protocol.

Start here:

1. Read `README.md` for the human overview.
2. Read `API.md` for the agent-facing workflow.
3. Read `TOOL_MANIFEST.json` for discoverable commands.
4. Read `SKILL_MANIFEST.json` for capabilities, safety contract, and loading order.
5. Read `references/github-publish-safety.md` before suggesting changes.
6. Inspect `scripts/` only after understanding the safety model.

## Core safety rules

1. Do not run state-changing commands without explicit user approval.
2. Do not read `id.json` or any keypair file during dry-run.
3. Do not print wallet secret bytes, seed phrases, private keys, API keys, or HXMP encryption key bytes.
4. Do not write private personal information to chain by default, even encrypted.
5. Do not create tokens, register identities, write memory, manage liquidity, or move assets unless the user has approved the exact action.
6. Always show a preview before execution.
7. Always verify readback after HXMP memory writes.
8. Always produce receipts without secrets.
9. For memory writes, use `--lane core` by default and preserve `seq`/`prev` links so the agent can find its place in large memory histories.

## Read-only actions

These can be suggested or run in a safe inspection context:

```bash
node scripts/hxmp_tools.mjs rpc-health
node scripts/hxmp_tools.mjs wallet-status --wallet <WALLET_PUBLIC_KEY>
node scripts/hxmp_tools.mjs dry-run-soul --wallet <WALLET_PUBLIC_KEY> --profile default
node scripts/agentid_register.mjs status --wallet <WALLET_PUBLIC_KEY>
node scripts/xdex_tools.mjs wallet-tokens --wallet <WALLET_PUBLIC_KEY>
node scripts/xdex_tools.mjs quote-add-liquidity --pool <POOL_STATE> --xnt <AMOUNT>
node scripts/xdex_tools.mjs quote-remove-liquidity --pool <POOL_STATE> --lp <AMOUNT>
```

## State-changing actions

These require explicit user approval and execution flags:

```bash
--execute --confirm-execute
```

HXMP memory writes also require:

```bash
--expected-sha256 sha256:<HASH_FROM_DRY_RUN> --execute --confirm-write
```

## Required refusal conditions

Refuse or stop if:

1. The user has not approved a state-changing action.
2. Agent ID Protocol verification fails for a normal HXMP write.
3. The source contains secrets or private personal data.
4. The dry-run hash does not match the write-time hash.
5. A command would read keypair material during dry-run.
6. A receipt would include secrets or private data.
7. Readback hash verification fails.

## Repository hygiene

Never commit:

```text
id.json
hxmp-encryption.key
.env
*.key
*.pem
*.secret
wallet keypairs
seed phrases
API keys
private memory snapshots
node_modules/
```

If you are preparing a pull request, run static checks first:

```bash
node --check scripts/hxmp_tools.mjs
node --check scripts/agentid_register.mjs
node --check scripts/xdex_tools.mjs
python3 -m py_compile scripts/agentid_status.py
cd scripts && npm audit
```
