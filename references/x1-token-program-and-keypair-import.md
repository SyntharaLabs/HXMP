# X1 Token Program & Keypair Import — Operational Notes

## Correct program distinction

X1 is SVM-compatible and generic SPL token operations use the standard SPL Token program:

```text
TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
```

The X1 AgentID identity program is separate:

```text
7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2
```

Do **not** use the AgentID program for generic token creation, `InitializeMint`, `MintTo`, ATA, or `SyncNative` token instructions. Use it only for AgentID-specific instructions such as `register_agent` and `attach_agent_nft`.

## X1Harness-derived token creation

The reference XDEX tool ports token/liquidity functions from X1Harness into the protocol tool layer:

```text
scripts/xdex_tools.mjs
```

Token creation uses:

- `SystemProgram.createAccount` for the mint account,
- SPL Token `InitializeMint`,
- associated token account creation,
- SPL Token `MintTo`,
- Metaplex metadata instruction,
- optional HXMP `defi.receipt` memo.

Dry-run / preview:

```bash
node scripts/xdex_tools.mjs create-token \
  --name <NAME> \
  --symbol <SYMBOL> \
  --decimals <0-9> \
  --supply <UI_SUPPLY>
```

Execution requires explicit approval flags and a keypair path:

```bash
node scripts/xdex_tools.mjs create-token \
  --keypair <id.json> \
  --name <NAME> \
  --symbol <SYMBOL> \
  --decimals <0-9> \
  --supply <UI_SUPPLY> \
  --description <DESC> \
  --execute --confirm-execute \
  --hxmp-receipt
```

## XDEX pool/liquidity functions

The same tool includes approval-gated XDEX commands:

```bash
node scripts/xdex_tools.mjs create-pool --keypair <id.json> --token-mint <MINT> --xnt <AMOUNT> --token <AMOUNT> --execute --confirm-execute --hxmp-receipt
node scripts/xdex_tools.mjs add-liquidity --keypair <id.json> --pool <POOL_STATE> --xnt <AMOUNT> --slippage-bps 300 --execute --confirm-execute --hxmp-receipt
node scripts/xdex_tools.mjs remove-liquidity --keypair <id.json> --pool <POOL_STATE> --lp <AMOUNT> --slippage-bps 300 --execute --confirm-execute --hxmp-receipt
```

Without both `--execute` and `--confirm-execute`, these commands return dry-run previews only.

## Keypair Import — Base58 → JSON Array

When importing a base58 secret into a Node.js script:

1. Do **not** print the secret.
2. Decode with a trusted base58 library to bytes.
3. Verify the decoded secret derives the expected public key.
4. Write the keypair as a Solana-style JSON array only to a protected local path with mode `0600`.
5. Verify with public-key-only tooling; never paste or summarize the private bytes.

## Error patterns

- `incorrect program id for instruction` during generic token creation usually means the wrong program id was used. Generic X1 SPL token operations should use `Tokenkeg...`, not the AgentID program.
- `AgentID verify false` is about the identity/NFT program, not generic token capability.
- `Available: 0 tokens` in an XDEX/frontend API does not prove the wallet lacks native XNT; check native XNT with RPC `getBalance`.
