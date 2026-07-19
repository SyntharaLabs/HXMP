# X1 Wallet Transfer Specification

## Scope

This module defines simple wallet-to-wallet transfers on X1 for:

- native XNT;
- standard SPL tokens;
- Token-2022 tokens whose transfer behavior succeeds in simulation.

The recipient parameter is always an **owner wallet public key**, not a token-account address. For token transfers, the implementation derives the recipient associated token account (ATA) using the mint's actual token program and creates it idempotently when absent.

## Normative flow

Every transfer MUST follow:

```text
collect sender + recipient + exact decimal amount + optional mint
-> validate public keys
-> reject self-transfer
-> fetch finalized/confirmed balances and mint metadata
-> convert the amount to an exact u64 without floating point
-> derive and validate source/destination token accounts when applicable
-> construct the exact transaction
-> estimate the fee
-> simulate without loading a keypair or signing
-> produce a canonical intent SHA-256
-> show the complete preview to the user
-> obtain explicit approval for that exact intent
-> rebuild the intent from live state
-> require the same preview SHA-256 plus execute and confirm-transfer gates
-> load the protected signer and sign
-> broadcast and confirm
-> verify recipient/source balance deltas
-> return signature, explorer link, and verification result
```

## Preview requirements

A preview MUST expose:

- network and RPC;
- sender owner wallet;
- recipient owner wallet;
- asset type (`XNT` or `SPL token`);
- token mint and token program when applicable;
- exact UI amount string;
- exact base-unit amount;
- decimals;
- selected source token account when applicable;
- derived recipient token account when applicable;
- whether recipient ATA creation is included;
- estimated network fee;
- simulation error and compute units;
- `preview_sha256` over the canonical intent;
- explicit statement that no keypair was loaded, no signature was created, and nothing was broadcast.

A failed simulation MUST NOT be presented as executable. This includes rent-exemption failures for tiny native transfers to a brand-new address.

## Exact amount rules

Implementations MUST:

- accept positive decimal strings only;
- reject commas, exponent notation, signs, empty strings, zero, excess decimal places, and values above `u64::MAX`;
- convert with decimal-string arithmetic, never JavaScript/Python floating point;
- use the mint's live decimals for tokens and 9 decimals for native XNT;
- use SPL `TransferChecked` for token transfers.

## Token-account rules

Implementations MUST:

- read the mint account and identify its actual owner program;
- support only the standard SPL Token and Token-2022 programs unless another program is explicitly implemented;
- verify source account owner, mint, token program, and balance;
- derive the recipient ATA from recipient owner + token program + mint;
- verify an existing recipient account's owner/mint/program relationships;
- include idempotent ATA creation when the recipient ATA is absent;
- expose ATA creation in the preview and simulation.

Transfer-hook or extension-bearing Token-2022 mints MAY require additional accounts. The tool MUST rely on live simulation and MUST stop rather than guessing those accounts.

## Approval binding

Execution MUST require all three:

1. `execute=true`;
2. `confirm_transfer=true`;
3. `expected_preview_sha256` exactly matching the freshly rebuilt canonical intent.

Changing sender, recipient, asset, mint, amount, decimals, source account, recipient account, or ATA-creation behavior MUST change the preview hash and invalidate prior approval.

The execution path MUST check both gates before reading the keypair file.

## Secret handling

Tools MUST NOT print, return, log, memo, or commit:

- keypair bytes;
- private keys;
- seed phrases;
- signer material.

Only the keypair path label and derived public key may be displayed.

## Receipt and verification

After confirmation, return:

- canonical intent;
- preview SHA-256;
- transaction signature;
- X1 explorer link;
- confirmation state;
- post-transfer source and recipient balances;
- explicit delta-verification booleans.

An optional future HXMP `wallet.transfer.receipt` MAY record the non-secret intent and transaction proof, but it MUST be separately disclosed because it creates an additional on-chain transaction.

## Reference commands

```bash
node tools/wallet/x1_wallet_tools.mjs transfer-preview \
  --wallet <SENDER_PUBLIC_KEY> \
  --to <RECIPIENT_OWNER_WALLET> \
  --amount 0.01

node tools/wallet/x1_wallet_tools.mjs transfer-preview \
  --wallet <SENDER_PUBLIC_KEY> \
  --to <RECIPIENT_OWNER_WALLET> \
  --amount 1.25 \
  --mint <TOKEN_MINT>

node tools/wallet/x1_wallet_tools.mjs transfer \
  --keypair <PROTECTED_KEYPAIR_PATH> \
  --to <RECIPIENT_OWNER_WALLET> \
  --amount 1.25 \
  --mint <TOKEN_MINT> \
  --expected-preview-sha256 sha256:<APPROVED_HASH> \
  --execute --confirm-transfer
```

Never run the final command without explicit user approval of the exact preview.
