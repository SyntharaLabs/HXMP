# X1 Program Boundaries and Tool Discovery

## Durable correction

Generic X1/SVM SPL token operations use the standard SPL Token program:

```text
TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
```

The AgentID identity program is separate:

```text
7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2
```

Do not use the AgentID program for generic token creation, `InitializeMint`, `MintTo`, ATA creation, or `SyncNative`. Use it only for AgentID-specific instructions such as `register_agent` and `attach_agent_nft`.

## Discovery rule for agents

Agents may load only `x1-memory-protocol` when the user says “HXMP protocol.” Therefore the HXMP skill must surface X1Harness-derived token/liquidity tools even though XDEX execution is an extension module.

If an agent cannot find token creation, check both paths:

```text
x1-memory-protocol/scripts/xdex_tools.mjs
xdex-token-liquidity-ops/scripts/xdex_tools.mjs
```

The command that proves discovery works without signing is:

```bash
node scripts/xdex_tools.mjs create-token --name "Dry Run" --symbol DRY --decimals 9 --supply 1
```

Expected shape:

```json
{
  "dry_run": true,
  "state_changing": true,
  "action": "create_token",
  "requires": ["--execute", "--confirm-execute"]
}
```

## Execution safety

State-changing token/liquidity actions require both flags and explicit user approval of exact parameters:

```text
--execute --confirm-execute
```

Use `--hxmp-receipt` only for non-secret public DeFi receipts. Never write wallet secrets, encryption keys, seed phrases, private user data, or sensitive business details into HXMP receipts.
