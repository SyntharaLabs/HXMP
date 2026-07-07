# GitHub Publish Safety Notes

This repository intentionally contains protocol documentation and helper scripts only.

Do not commit operational secrets or private runtime files.

## Never commit

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
```

## Public metadata warning

HXMP encrypts memory before writing records to X1, but blockchain metadata remains public.

Observers may see wallet addresses, timestamps, record types, hashes, encrypted chunk counts, transaction signatures, Agent ID Protocol linkage, and receipt metadata.

Do not write sensitive personal information to chain by default, even encrypted.

## State-changing tool warning

State-changing tools must require explicit approval before execution.

Reading, scanning, and explaining can be autonomous.

Writing memory, registering identities, creating tokens, managing liquidity, or moving assets must not be autonomous unless a user has explicitly approved the exact action and risk.

## Financial and legal disclaimer

HXMP and related scripts are experimental developer tools. They are not financial advice, legal advice, investment advice, or a promise of profit, security, privacy, or regulatory compliance.

Users are responsible for reviewing transactions, protecting keys, understanding gas costs, and complying with applicable laws.
