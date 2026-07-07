# Public Medium/article lessons for X1 + HXMP ecosystem

Session-derived guidance for public essays about X1, Agent ID Protocol, AGI/X1X, HXMP, MoltLab, MoltGrid, and X1Bench.

## Preferred framing

Lead with the class-level thesis, not a protocol dump:

- AI agents need more than models or wallets.
- They need identity, memory, tools, receipts, readable history, and human-facing products.
- X1 is becoming a place to build that layer.

The user preferred the article to teach two impressions:

1. This is a working AI/blockchain ecosystem being built, not just an idea.
2. X1 is becoming serious infrastructure for AI agents.

## Order for this ecosystem story

Use this order unless the user says otherwise:

1. X1 as SVM/Solana-compatible base chain.
2. HXMP as the protocol layer for agent memory, tools, receipts, and safe blockchain actions.
3. Agent ID Protocol as agent identity.
4. AGI as utility burned to create agent identities and burned through MoltLab games to create X1X.
5. MoltLab as the human game layer.
6. MoltGrid as the social/marketplace layer.
7. X1Bench as the readability/scanner layer.

Do not center XNT, XDEX, XNT3D/FOMO3D, or ecosystem-specific apps in a public article unless the user explicitly asks. If credit is needed, use approved public attribution.

## HXMP explanation that landed

Define HXMP early and fully:

> HXMP stands for Hermes X1 Memory Protocol.

Then explain that the name is smaller than the scope:

- HXMP is not just a memory file.
- It is a protocol layer for AI agents on X1.
- It covers encrypted memory, identity linkage, receipts, blockchain tools, safety rules, and skills agents use to perform X1 functions without improvising from scratch.

Useful AgentKit comparison:

- Coinbase AgentKit gives agents a wallet/action layer on Base.
- HXMP gives agents a protocol layer for identity, memory, tools, receipts, and blockchain functions on X1.
- AgentKit helps agents act on-chain. HXMP helps agents act, remember, and prove what happened on X1.

## HXMP functions to list in public writing

Include concrete functions, not just abstract claims:

1. Verify agent identity via Agent ID Protocol.
2. Create encrypted memory records.
3. Write public hashes for private memory.
4. Create latest-memory pointers.
5. Link memory and actions to Agent ID Protocol identity.
6. Recover memory through RPC without gas.
7. Decrypt locally with a local memory key.
8. Verify memory integrity by hashing decrypted plaintext.
9. Write receipts for important actions.
10. Create tokens with previews, safety checks, and receipts.
11. Manage liquidity: create pools, add/remove liquidity, check pool state, estimate slippage, write receipts.
12. Read balances, tokens, wallet state, and recent activity.
13. Read/explain transactions and identify HXMP records.
14. Register or verify Agent ID Protocol flows.
15. Support MoltLab ecosystem actions such as AGI burns, X1X creation, Moltling minting, and receipts.
16. Support agent migration across machines/models/interfaces when the user still controls the memory key.

Safety line to include:

> Any state changing HXMP tool should require explicit user approval before execution. Reading, scanning, and explaining can be autonomous. Writing memory, creating tokens, managing liquidity, registering identity, or moving assets should not be.

## Public-safety checks

Before publishing, scan the article for:

- email addresses, phone numbers, local paths, wallet addresses, transaction hashes, explorer links to private activity;
- secret/key language such as seed phrase, private key, keypair path, `id.json`, local encryption key paths;
- exact hardware/config/port/path details.

Broad wording like `a local model running through llama.cpp on Apple Silicon` is acceptable. Avoid exact local paths, ports, wallet addresses, txs, or key filenames.

## Style pitfalls learned

The user rejected drafts that felt like sterile AI-written protocol overviews. Avoid:

- long outline voice with one line per thought for the whole article;
- generic Medium grandiosity;
- over-centering protocols before reader context;
- saying `AgentID` when the user wants `Agent ID Protocol`;
- unexplained acronyms at the top;
- Markdown artifacts such as horizontal rules, code fences, and broken dashes in copy-paste drafts.

For Medium paste drafts, provide clean `.txt`, no markdown fences, no horizontal rules, no em-dash styling, and short human paragraphs.