# Public HXMP article / post guidelines

Use this when drafting public Medium-style posts, launch notes, graphics, or explainers about HXMP, AgentID, XDEX, X1 Bench, MoltLab, MoltGrid, Hermes agents or local-model operation.

## Safe public framing

Lead with a concrete proof moment, not a definition:

```text
A local agent wrote encrypted memory to X1 for a small XNT cost, read it back for free through RPC, decrypted locally, and verified the hash.
```

Keep it high-level and readable for AI/blockchain/privacy/technology audiences. Use short paragraphs, specific examples, and simple diagrams. Prefer proof cards over raw terminal output. Use exact costs, tx links, wallet addresses, AgentID card images, hashes, or screenshots only after explicit approval of the exact artifact.

Good public proof card:

```text
Write: small XNT cost
Read: 0 XNT
Identity: verified AgentID
Result: memory recovered and hash verified
```

Good simple trust equation:

```text
hash(decrypted memory) = hash written on-chain
```

Core privacy phrase:

```text
Public proof, private readability.
```

Explain the key mechanism without exposing operational details:

```text
The wallet key signs transactions and proves authorship. The HXMP memory key decrypts encrypted memory. They are not the same key. The memory key stays local and is never written to X1, published in the article, pasted into prompts, or included in receipts. Without that memory key, observers can see hashes, encrypted chunks, timestamps, and identity linkage, but not plaintext memory.
```

Recommended public diagram:

```text
Identity  → AgentID
Memory    → HXMP
Proof     → hashes and receipts
Storage   → X1 memo records
Reading   → RPC
Privacy   → local encryption key
```

## Do not publish operational details

Omit anything that could compromise the user, the agent, Hermes, wallets, or network setup:

- local file paths
- localhost/base URLs, ports, private RPCs, private endpoints, config names
- wallet keypair JSON details, `id.json`, private key formats, seed phrases, signing-file command examples
- API keys, OAuth tokens, client IDs/secrets, credentials, screenshots with private account data
- serial numbers, UUIDs, exact network topology, private IPs, hostnames
- unapproved wallet addresses, NFT IDs, transaction links, hashes, or card images
- raw QuickBooks, personal, health, email, or account data

For wallet/action discussion say:

```text
The agent signs with a local wallet. The public address can be shared only when explicitly approved. The signing key stays private and never goes into HXMP, the article, a prompt, or the chain.
```

## Tone and structure

For public Medium-style X1/HXMP ecosystem articles, **ask framing questions before drafting**. Do not guess the story from protocol notes alone. Capture the thesis, intended reader, project order, links, and anti-style first.

When the user's goal is the X1 agent-infrastructure/ecosystem story, use this order unless the user says otherwise:

1. X1 as the base chain: SVM/Solana-compatible, high-throughput, low-cost activity. Use verified docs for performance claims; if an official TPS number is not found, say high-throughput rather than inventing one.
2. AgentID Protocol as the agent identity layer: technical identity + soulbound anchor + continuity/reputation, explained simply.
3. AGI as utility/burn/create token: burned to create AgentID and burned through playing games in the MoltLab ecosystem to create X1X.
4. HXMP defined immediately as **Hermes X1 Memory Protocol**. Explain that HXMP is not just a memory file: it is a protocol layer for AI agents on X1, including memory format, identity linkage, on-chain receipts, skills/tools, safety rules, and blockchain functions.
5. MoltLab as the human/fun ecosystem layer: burn AGI, play games, mint X1X; Moltlings are smart NFTs minted by burning AGI that can level up, battle, and play in the ecosystem.
6. MoltGrid as the social/marketplace layer for ecosystem/agent activity.
7. X1Bench as the readability/scanner layer for humans and agents to understand on-chain activity.
8. Wider local-agent thesis: local models will become more important; long-term memory is still unsolved; the hope is people run local models (e.g. Ornith via llama.cpp on Mac/Apple-Silicon-class hardware) while decentralizing identity and memory proof on-chain.
9. Close with why people using local/on-chain agents for agentic commerce may have an advantage over peers who do not.

Do not include separate XNT, XDEX, XNT3D/FOMO³, an agent, or Synthara sections unless the user explicitly asks. When attribution is needed for this user’s public pieces, use the approved public attribution.

Write as practical and built, not as a whitepaper fantasy. A little vision is fine, but anchor every claim in what works. Avoid crypto-bro, corporate, overly mystical, academic, or obviously AI-written prose. Use simple section-by-section Medium prose, not a skeletal outline, and include project links in each section when public URLs are approved/provided.

For narrower HXMP-only pieces, keep the older proof-loop shape in mind: proof moment, why continuity matters, mental model, AgentID, HXMP, public proof/private readability, what the public can/cannot see, what the proof demonstrates, cheap write/free readback, local/decentralized-inference direction, builder note, disclaimer.

### AgentKit comparison and HXMP capability framing

If comparing to Coinbase AgentKit/Base, avoid saying “HXMP is AgentKit for X1” as a one-to-one claim. Use the more accurate framing:

```text
AgentKit gives agents a wallet and action layer.
HXMP gives agents a protocol layer for identity, memory, tools, receipts, and blockchain functions on X1.

AgentKit helps agents act on-chain.
HXMP helps agents act, remember, and prove what happened on X1.
```

Explain that HXMP contains both memory semantics and a tool/skill layer around X1 blockchain functions. List concrete agent abilities where relevant:

- verify AgentID / agent identity before actions
- create encrypted memory records
- write public hashes for private memory
- create latest-memory pointers
- link memory, receipts, and actions to AgentID
- recover records through RPC without gas
- decrypt locally with the local memory key
- verify memory integrity by hashing decrypted plaintext
- write action receipts for accountability
- create tokens with previews, approvals, and receipts
- manage liquidity: create pools, add/remove liquidity, check pool state, estimate slippage, and receipt the action
- read balances, token accounts, wallet state, and recent activity
- read/explain transactions and HXMP records in human language, especially with X1Bench
- support AgentID registration/verification flows
- support game/ecosystem actions such as AGI burns, X1X creation, and Moltling minting receipts
- support agent migration across machine/model/interface when the user retains the memory key

Emphasize: HXMP is not dumping everything on-chain; it is a structured, identity-linked, skill-aware, tool-driven, hash-verified, receipt-based, recoverable operating layer for X1 agents.

## Privacy-safe hardware/model wording

Do not include exact local paths, ports, LaunchAgent names, or config excerpts. Use broad wording such as:

```text
A consumer Apple Silicon machine running Hermes with a local 35B-class model.
```

or, if approved:

```text
A Mac Studio-class Apple Silicon machine running Hermes with a local Ornith model.
```

## Article examples to include only with approval

Public AgentID card images, wallet addresses, transaction hashes, and X1 Bench links are powerful evidence, but include them only after explicit approval of the exact artifact. If approval is missing, leave placeholders rather than guessing or searching private notes.