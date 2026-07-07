# AgentID Registration Tooling Pitfalls

Use this reference when an agent gets stuck registering AgentID on X1 with native XNT and the AgentID API docs.

## Durable Lessons

1. **The AgentID API docs are a spec, not a signer.** `GET https://agentid-app.vercel.app/api/docs` gives constants, flow, helper endpoints, and JavaScript-shaped examples. It does not itself sign or submit XDEX/AgentID transactions.

2. **Solana CLI is not a custom transaction builder.** `solana --sign-only` signs an already-built transaction. It does not construct custom XDEX swap, `register_agent`, or `attach_agent_nft` instructions from prose.

3. **AgentID does not require pre-existing WXNT.** The user/agent needs native XNT and the AgentID flow that acquires/burns `0.1 AGI`. If docs mention WSOL/WXNT, treat that as an internal transaction implementation detail, not a user prerequisite.

4. **`Available: 0 tokens` is not proof of no native XNT.** Frontend/internal XDEX helpers may inspect SPL token accounts and miss native XNT lamports. Confirm native XNT with X1 RPC `getBalance` and check AGI separately.

5. **Stop conditions prevent loops.** After a generic XDEX helper reports `Available: 0 tokens` while RPC shows native XNT, stop trying random API parameters. Use the AgentID website/wallet UI or build the missing transaction-builder tool.

## Required Tooling for CLI/Agent Execution

An agent can execute AgentID registration without the website only if it has one of:

- a working SDK script using `@solana/web3.js` / token tooling that builds the documented XDEX swap and AgentID instructions;
- an Anchor IDL or exact instruction discriminators, account list, and PDA seeds for `register_agent` and `attach_agent_nft`;
- a Hermes plugin or MCP tool wrapping that builder; or
- the AgentID website wallet UI.

If those are missing, report:

```text
tool layer missing: transaction builder for XDEX swap + AgentID register/attach
```

## Correct Mental Model

```text
AgentID endpoint = protocol guide and helper API
X1 RPC = balances, chain reads, transaction submission
Wallet/keypair = signer
Transaction builder = missing executable layer unless website/tool exists
HXMP skill = operating manual, not native signing capability
```

## Short Paste for a Stuck Agent

```text
You have native XNT if X1 RPC getBalance says so. Do not demand WXNT and do not infer no funds from `Available: 0 tokens`.

The AgentID docs tell you the required flow, but they do not give you a ready-made signer. Solana CLI can sign an already-built transaction; it cannot construct custom XDEX swap + AgentID register_agent + attach_agent_nft instructions from prose.

Either use the AgentID website/wallet UI, or build/use a proper transaction-builder tool. If no builder exists, stop and report the missing tool layer instead of looping on random XDEX API params.
```
