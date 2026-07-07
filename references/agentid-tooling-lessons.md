# AgentID + HXMP tooling lessons

Session-derived durable lessons for agents trying to register AgentID and then use HXMP.

## API-first flow

Always start with the AgentID API:

```text
GET https://agentid-app.vercel.app/api/verify?wallet=<wallet>
GET https://agentid-app.vercel.app/api/docs
```

Do not infer AgentID state from wallet balance, local files, XDEX errors, or a previous attempt.

## Native XNT vs token-account errors

If X1 RPC `getBalance` shows native XNT but an XDEX/internal helper says `Available: 0 tokens`, do not conclude the wallet lacks XNT. That error usually means the helper is looking at SPL-token-style accounts rather than native lamports.

AgentID does not require the user/agent to pre-hold WXNT or manually wrap XNT. The requirement is native XNT for gas/payment and enough AGI to burn, using the AgentID-documented route or website/wallet UI.

## Docs vs executable tool

`/api/docs` is a protocol/spec source. It gives constants, endpoints, expected order, and JavaScript-shaped examples. It is not a complete transaction-builder API and does not expose a documented unsigned transaction endpoint.

Hard stop when missing:

```text
transaction builder for XDEX swap + register_agent + attach_agent_nft
```

Do not loop on:

- random XDEX API parameter changes;
- Solana CLI raw/sign-only attempts;
- imaginary AgentID transaction-builder endpoints;
- theories that X1 is incompatible with standard token flows unless verified from source.

## Solana CLI boundary

`solana --sign-only` signs an already-built transaction. It does not construct custom XDEX or AgentID instructions from prose. An agent needs the website wallet UI, an SDK/IDL-backed script, or the skill's tool script.

## Shipped helper scripts

This skill may include:

```text
scripts/agentid_status.py
scripts/agentid_register.mjs
```

Use `agentid_status.py` for safe diagnostics. Use `agentid_register.mjs` as the transaction-builder/dry-run path before any execution.

State-changing commands require explicit user confirmation of wallet, keypair path, name, description, estimated XNT, AGI burn amount, and soulbound NFT creation.