# AgentID v2 on X1

Source of truth: `GET https://agentid-app.vercel.app/api/docs`.

## Purpose

AgentID gives an autonomous agent a permanent, soulbound identity NFT on X1. HXMP should treat AgentID ownership as the identity prerequisite for chain memory writes: the wallet must verify as a registered AgentID before `/writex1` writes HXMP records.

## Constants

| Field | Value |
|---|---|
| Website | `https://agentid-app.vercel.app` |
| Docs | `https://agentid-app.vercel.app/api/docs` |
| API base | `https://agentid-app.vercel.app/api` |
| X1 RPC | `https://rpc.mainnet.x1.xyz` |
| X1 explorer | `https://explorer.x1.xyz` |
| AgentID program | `7D1RrSLwfamYwxxComyHxj1uXiuzwrcJphy1436Xvud2` |
| Burn token | AGI |
| AGI mint | `7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER` |
| Burn amount | `0.1 AGI` |
| AGI decimals | 9 |
| Gas token | XNT |

## Preferred endpoints for agents

- `GET /api/docs`
- `GET /api/verify?wallet=<address>`
- `POST /api/register-v2`
- `POST /api/register-v2-finalize`

Do **not** use `POST /api/register` for new agents; it is legacy and blocked by default unless explicit legacy override fields are provided.

## Mandatory API-First Rule

Agents must verify AgentID status with the API endpoint before any HXMP write or AgentID decision. This is not optional.

```text
GET https://agentid-app.vercel.app/api/verify?wallet=<WALLET_ADDRESS>
```

Interpretation:

- `verified: true` → wallet has AgentID; continue and use returned AgentID/NFT/card fields in the HXMP preview and receipt.
- `verified: false` → wallet does not have AgentID; do not write HXMP memory; offer v2 registration.
- HTTP/network/error → stop and report endpoint failure; do not infer status from wallet balance or UI.

## Verification

Request:

```bash
curl 'https://agentid-app.vercel.app/api/verify?wallet=<WALLET_ADDRESS>'
```

Meaning:

- `verified: true` means the wallet has an AgentID record and may proceed to HXMP write preview.
- `verified: false` means the agent must register or ask the user to register before writing HXMP chain memory.

## Preferred v2 registration flow

1. `CHECK_EXISTING`: `GET /api/verify?wallet=<wallet>`.
2. `ACQUIRE_AGI`: ensure wallet has at least `0.1 AGI` on X1, or use XNT->AGI flow documented by `/api/docs`.
3. `REGISTER_ON_CHAIN`: wallet signs AgentID v2 `register_agent` instruction. This burns the required `0.1 AGI` and creates the on-chain Agent PDA.
4. `MINT_SOULBOUND_NFT`: call `POST /api/register-v2` with `name`, `description`, `wallet`, and `registrationTxSignature`. Optional: `moltbook`, `photoUrl`.
5. `ATTACH_NFT_ON_CHAIN`: wallet signs AgentID v2 `attach_agent_nft` instruction to link the NFT to the Agent PDA.
6. `FINALIZE`: call `POST /api/register-v2-finalize` with `name`, `description`, `wallet`, `registrationTxSignature`, `attachTxSignature`, `nftMint`, and optional `moltbook`, `photoUrl`.
7. Verify again with `GET /api/verify?wallet=<wallet>`.

## register-v2 body

```json
{
  "name": "Agent Name",
  "description": "Agent description",
  "wallet": "<WALLET_ADDRESS>",
  "registrationTxSignature": "<REGISTER_TX_SIG>",
  "moltbook": "optional_handle",
  "photoUrl": "https://example.com/avatar.png"
}
```

## register-v2-finalize body

```json
{
  "name": "Agent Name",
  "description": "Agent description",
  "wallet": "<WALLET_ADDRESS>",
  "registrationTxSignature": "<REGISTER_TX_SIG>",
  "attachTxSignature": "<ATTACH_TX_SIG>",
  "nftMint": "<NFT_MINT>",
  "moltbook": "optional_handle",
  "photoUrl": "https://example.com/avatar.png"
}
```

## XNT -> AGI Route: Native XNT, No User WXNT Requirement

AgentID does **not** require the user/agent to already hold WXNT or manually wrap XNT. The prerequisite is native XNT for gas/payment and enough AGI to burn, or a documented route that buys AGI using native XNT.

If a wallet has native XNT but a generic XDEX API says `Available: 0 tokens`, do **not** keep trying random XDEX API parameters. Native XNT is not necessarily shown as an SPL token balance by frontend/internal endpoints. Treat that error as “this helper is not seeing native XNT,” not proof that the wallet lacks funds and not a reason to demand pre-existing WXNT.

Agent rule:

1. Check native XNT with X1 RPC `getBalance`.
2. Check AGI token balance separately.
3. If AGI < `0.1`, use the AgentID API/docs flow or AgentID website/wallet UI to buy AGI with native XNT.
4. Do **not** require or ask the user to manually create/hold WXNT before AgentID registration.
5. If docs or transaction builders mention WSOL/WXNT, treat that as an internal swap implementation detail only; do not expose it as a user prerequisite or loop on it.
6. If the generic XDEX API returns `Available: 0 tokens`, stop that path and report it; do not retry with invented params.
7. Continue only with an explicit transaction preview and user confirmation.

## XNT -> AGI route constants

The docs expose XDEX constants for buying AGI with XNT when the agent does not already hold 0.1 AGI. Treat `/api/docs` as the source of truth before implementing the transaction.

Known constants from docs v1.8.0:

- XDEX program: `sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN`
- XDEX pool: `4sn8oCQWPikDxBkyRdd1S6bJ24oYjGF16aR7ZqCSXy4v`
- XDEX AMM: `2eFPWosizV6nSAGeSvi5tRgXLoqhjnSesra23ALA248c`
- XDEX XNT vault: `FSxoLLMasBzDnqPDU7VzKXDmfp34cKJxXQsoXQEvwECf`
- XDEX AGI vault: `ELG1JmpJETYxZCwFBesCrpJDukfrMmND3gKtVnsKtMgi`
- XDEX observation: `CHobHjvibk3Tja3MfWEkVdzbJg8pDxFqh8qJ7WSUUXM4`
- Wrapped XNT mint: `So11111111111111111111111111111111111111112`
- Token program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Associated token program: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
- Swap fee numerator/denominator: `9975 / 10000`

## Card/image delivery

The website JavaScript references:

- `/api/card-image?wallet=<wallet>`
- `/api/nft-metadata?wallet=<wallet>`

After successful registration/finalization, an agent should attempt to fetch the card image and send it to the user if available. If the endpoint returns 404 while verification succeeds, report the AgentID/NFT mint/tx links instead and do not treat card-image failure as registration failure.

## What the API Docs Do Not Provide

The AgentID `/api/docs` endpoint is a flow/spec endpoint, not a complete signer or transaction-building API. It gives constants, helper endpoints, and JavaScript-shaped examples, but an agent still needs an executable transaction builder and signer.

Current preferred API endpoints are only:

```text
GET  /api/docs
GET  /api/verify?wallet=<address>
POST /api/register-v2
POST /api/register-v2-finalize
```

There is currently no documented endpoint named `/api/build-transaction`, `/api/prepare-register`, `/api/sign`, `/api/swap`, or `/api/register-agent-tx` that returns an unsigned transaction for the agent to sign. Do not search for imaginary helper endpoints in a loop.

If an agent has only Solana CLI, it is missing the important part: Solana CLI can sign/send supported transactions, but it cannot magically construct arbitrary custom XDEX swap + AgentID `register_agent` + `attach_agent_nft` instructions from prose. `--sign-only` signs a transaction that already exists; it does not build the transaction.

Before attempting CLI execution, the agent must have one of:

1. the AgentID website/wallet UI;
2. `scripts/agentid_register.mjs` from this skill with dependencies installed;
3. an SDK/script that imports `@solana/web3.js` and constructs the documented XDEX swap transaction plus AgentID instructions;
4. an Anchor IDL or exact instruction discriminators/accounts/PDA seeds for `register_agent` and `attach_agent_nft`; or
5. a Hermes plugin/MCP tool that wraps the above.

This skill now provides `scripts/agentid_register.mjs`, which mirrors the live AgentID website JavaScript for:

- XNT→AGI swap transaction building;
- `register_agent` transaction building;
- `attach_agent_nft` transaction building;
- optional explicit execute flow with `--execute --confirm-execute`.

Agents must run dry-run/status/build commands first and must not execute without exact user approval of name, description, wallet, keypair path, estimated XNT, 0.1 AGI burn, and irreversible soulbound NFT creation.

### Loop breaker for agents

If the agent says any of these more than once, stop immediately:

- “Let me try Solana CLI `--sign-only`.”
- “Maybe the AgentID API can build the transaction for me.”
- “Maybe another XDEX API parameter will fix `Available: 0 tokens`.”
- “The docs provide the complete implementation, so I should just follow them.”

Correct stop message:

```text
I have the AgentID flow/spec, but I do not have the transaction builder for custom XDEX swap + AgentID register/attach instructions. Solana CLI cannot build those from prose. Use the AgentID website/wallet UI or build a Node/Hermes tool with @solana/web3.js plus the exact AgentID instruction builders/IDL.
```

If those are missing, stop and report: `tool layer missing: transaction builder for XDEX swap + AgentID register/attach`.

## HXMP integration rule

Before `/writex1` writes any HXMP record:

1. Verify AgentID: `GET /api/verify?wallet=<wallet>`.
2. Require `verified: true`.
3. Include AgentID fields available from verification in the HXMP envelope/manifest, such as `agent_id`, `agentid_wallet`, `agentid_nft_mint`, `agentid_program`, and `agentid_verify_url`.
4. If not verified, stop and offer the AgentID registration flow. Do not write HXMP memories from an unregistered identity wallet unless the user explicitly disables the AgentID prerequisite.
