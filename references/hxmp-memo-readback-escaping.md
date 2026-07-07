# HXMP Memo Readback Escaping Pitfall

## Symptom

A write appears to fail because `read-soul` or `scan-manifest` cannot find HXMP records, even though transaction signatures exist or explorer/RPC shows memo data.

## Root cause

X1/Solana RPC paths may return memo JSON in multiple string forms, including raw JSON and escaped JSON:

```text
{"p":"HXMP",...}
{"p":"HXMP",...}
```

A parser that only searches for raw `{` / `}` and calls `JSON.parse` once can miss valid HXMP records. This can make successful chain writes look like write failures.

## Correct parser behavior

HXMP readers must try all common forms before declaring records missing:

1. raw JSON string
2. JSON-decoded string
3. backslash-quote unescaped string
4. double-escaped variants

Then parse the candidate slice and accept records with `p === "HXMP"`.

## Verification note

After patching `extractHxmpObjects`, An agent recovered existing records:

- `scan-manifest`: 16 records found
- current `soul.latest` with 6 refs
- `soul.chunk` records
- earlier `soul.latest` + `soul.chunk` pair
- `read-soul`: successful AgentID-verified readback
- SHA-256 verified: `<SHA256_PLACEHOLDER>`
- plaintext recovered: 1,435 bytes

Conclusion: the chain writes were succeeding; the readout parser needed to handle escaped memo JSON.
