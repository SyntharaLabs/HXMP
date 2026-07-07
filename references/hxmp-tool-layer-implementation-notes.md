# HXMP Tool Layer Implementation Notes

Session-derived notes for turning the X1 memory protocol from instructions into executable Hermes tools.

## Working tool-layer shape

Use this layered model:

1. **Skill**: protocol, safety policy, and workflow. It tells the agent when to use AgentID, dry runs, confirmation, writes, and readback verification.
2. **Script**: deterministic implementation under the skill directory, runnable via terminal even before first-class tools exist.
3. **Profile-local plugin**: registers first-class Hermes tools for the target profile.
4. **Profile config**: enables the plugin and toolset.
5. **Fresh session/restart**: required before newly added tools enter the live prompt/tool schema.

For a named profile, the profile-local structure is:

```text
~/.hermes/profiles/<profile-name>/skills/cryptocurrency/x1-memory-protocol/scripts/hxmp_tools.mjs
~/.hermes/profiles/<profile-name>/plugins/x1-hxmp/plugin.yaml
~/.hermes/profiles/<profile-name>/plugins/x1-hxmp/__init__.py
```

Config needs both:

```yaml
toolsets:
  - x1_hxmp

plugins:
  enabled:
    - x1-hxmp
```

## Minimal first-class tools

The practical companion set is:

```text
x1_wallet_status       # read-only balance + AgentID verify
hxmp_dry_run_soul      # source read, AgentID verify, safety check, SHA-256, exact preview
hxmp_write_soul        # encrypted memo write, guarded by expected hash + explicit execution confirmation
hxmp_read_soul         # shallow scan, fetch latest, decrypt, verify SHA-256
hxmp_scan_manifest     # shallow audit/recovery scan of HXMP records
```

Keep AgentID registration separate but adjacent via:

```text
agentid_status.py
agentid_register.mjs
```

## Required write guard

The state-changing HXMP write tool should enforce in code, not just prose:

```text
AgentID verify == true
current plaintext SHA-256 == expected SHA-256 from dry run
execute flag == true
confirmation flag == true
```

The write tool must never print wallet secret bytes, seed phrases, private keys, API keys, or encryption key bytes.

## Balance/status verification pitfall

Do not assume a wallet is funded because the user says "an agent has 1 XNT" or because a prior message references a wallet. Always check the exact public key that will sign the transaction with live X1 RPC/`x1_wallet_status` immediately before registration or HXMP write.

If the expected funded wallet shows `0` lamports, the right conclusion is usually one of:

- the XNT is in a different an agent wallet,
- funding has not landed yet,
- the active keypair/public key differs from the remembered/default wallet.

Do not proceed to AgentID registration or HXMP write until the signing wallet is confirmed funded and AgentID status is checked live.

## AgentID image/card evidence

The AgentID docs may not expose a stable `/api/card-image` endpoint. Do not fabricate image endpoints. After registration/finalize, prefer image/card evidence from the API response, NFT metadata, website, or live docs. If no image URL is exposed but verification succeeds, return verify JSON, NFT mint, transaction links, and explorer links instead.

## Completion standard

For a real end-to-end proof, require all of:

1. funded signing wallet verified live,
2. AgentID registration/finalize executed after explicit user approval,
3. `GET /api/verify?wallet=<wallet>` returns verified true,
4. `hxmp_dry_run_soul` produces preview/hash,
5. user approves exact write,
6. `hxmp_write_soul` writes encrypted snapshot + latest pointer,
7. `hxmp_read_soul` decrypts and verifies SHA-256,
8. receipt includes AgentID status, tx signatures, hash, and readback result.
