#!/usr/bin/env python3
"""Read-only AgentID/X1 diagnostic tool for HXMP agents.

This script is intentionally safe: it never reads a secret key, signs, swaps,
burns, registers, or posts state-changing requests. It tells an agent whether
it can proceed, use the AgentID website/UI, or stop because a transaction
builder is missing.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict

X1_RPC = "https://rpc.mainnet.x1.xyz/"
AGENTID_API = "https://agentid-app.vercel.app/api"
AGI_MINT = "7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER"
WXNT_MINT = "So11111111111111111111111111111111111111112"
LAMPORTS_PER_XNT = 1_000_000_000
AGI_DECIMALS = 9
REQUIRED_AGI_RAW = 100_000_000  # 0.1 AGI with 9 decimals


def http_json(url: str, *, method: str = "GET", payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    data = None
    headers = {"User-Agent": "Hermes-HXMP-AgentID-Tool/0.1"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as resp:
        body = resp.read().decode("utf-8")
        try:
            return json.loads(body)
        except Exception:
            return {"raw": body, "status": resp.status}


def rpc(method: str, params: list[Any]) -> Dict[str, Any]:
    req = urllib.request.Request(
        X1_RPC,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "Hermes-HXMP-AgentID-Tool/0.1"},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def token_accounts(wallet: str, mint: str) -> Dict[str, Any]:
    return rpc("getTokenAccountsByOwner", [wallet, {"mint": mint}, {"encoding": "jsonParsed"}])


def token_amount_raw(accounts_resp: Dict[str, Any]) -> int:
    total = 0
    for item in accounts_resp.get("result", {}).get("value", []) or []:
        try:
            amt = item["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]
            total += int(amt)
        except Exception:
            continue
    return total


def summarize_docs() -> Dict[str, Any]:
    docs = http_json(f"{AGENTID_API}/docs")
    endpoints = docs.get("endpoints", {})
    endpoint_names = sorted(k for k in endpoints.keys() if k != "preferredForAgents")
    # The live docs currently expose no unsigned-tx builder endpoint. Detect that explicitly.
    docs_text = json.dumps(docs).lower()
    has_builder_endpoint = any(term in docs_text for term in [
        "/api/build-transaction",
        "/api/prepare-register",
        "/api/register-agent-tx",
        "unsignedtransaction",
        "unsigned transaction",
    ])
    return {
        "protocol": docs.get("protocol"),
        "version": docs.get("version"),
        "preferred_endpoints": endpoints.get("preferredForAgents"),
        "endpoint_names": endpoint_names,
        "requirements": docs.get("requirements"),
        "on_chain_program": docs.get("onChainProgram"),
        "xnt_swap_method_present": "xntSwapMethod" in docs,
        "documented_unsigned_tx_builder_endpoint": bool(has_builder_endpoint),
    }


def diagnose(wallet: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"wallet": wallet, "network": "X1 mainnet", "rpc": X1_RPC}

    health = rpc("getHealth", [])
    out["rpc_health"] = health.get("result")

    balance = rpc("getBalance", [wallet])
    lamports = int(balance.get("result", {}).get("value", 0))
    out["native_xnt"] = {"lamports": lamports, "xnt": lamports / LAMPORTS_PER_XNT}

    agi_resp = token_accounts(wallet, AGI_MINT)
    agi_raw = token_amount_raw(agi_resp)
    out["agi"] = {
        "mint": AGI_MINT,
        "raw": agi_raw,
        "amount": agi_raw / (10 ** AGI_DECIMALS),
        "has_required_0_1_agi": agi_raw >= REQUIRED_AGI_RAW,
        "token_account_count": len(agi_resp.get("result", {}).get("value", []) or []),
    }

    wxnt_resp = token_accounts(wallet, WXNT_MINT)
    wxnt_raw = token_amount_raw(wxnt_resp)
    out["wxnt"] = {
        "mint": WXNT_MINT,
        "raw": wxnt_raw,
        "token_account_count": len(wxnt_resp.get("result", {}).get("value", []) or []),
        "required_by_agentid": False,
        "note": "AgentID does not require pre-existing WXNT or manual wrapping.",
    }

    verify_url = f"{AGENTID_API}/verify?wallet={urllib.parse.quote(wallet)}"
    try:
        out["agentid_verify"] = http_json(verify_url)
    except Exception as exc:
        out["agentid_verify"] = {"error": repr(exc), "verified": None}

    try:
        out["docs"] = summarize_docs()
    except Exception as exc:
        out["docs"] = {"error": repr(exc)}

    verified = out.get("agentid_verify", {}).get("verified") is True
    has_agi = out["agi"]["has_required_0_1_agi"]
    has_xnt = lamports > 0
    has_builder_endpoint = out.get("docs", {}).get("documented_unsigned_tx_builder_endpoint") is True

    if verified:
        next_action = "AgentID already verified. HXMP writes may proceed after normal preview/approval."
        stop_reason = None
    elif has_agi:
        next_action = "AGI balance is sufficient. Need executable register_agent + attach_agent_nft transaction builder or website UI."
        stop_reason = "missing AgentID transaction builder" if not has_builder_endpoint else None
    elif has_xnt:
        next_action = "Native XNT exists but AGI is insufficient. Use AgentID website/wallet UI or build SDK tool for XNT->AGI swap plus register/attach. Do not loop on XDEX Available: 0 tokens."
        stop_reason = "missing transaction builder for XDEX swap + AgentID register/attach" if not has_builder_endpoint else None
    else:
        next_action = "Wallet lacks native XNT and required AGI. Fund wallet before registration."
        stop_reason = "insufficient funds"

    out["decision"] = {
        "can_hxmp_write_now": bool(verified),
        "can_register_with_current_readonly_tool": False,
        "safe_to_use_solana_cli_sign_only": False,
        "next_action": next_action,
        "stop_reason": stop_reason,
        "loop_breaker": "Solana CLI signs already-built txs; it does not build custom XDEX/AgentID instructions. Do not guess XDEX params or imaginary AgentID build endpoints.",
    }
    return out


def print_human(result: Dict[str, Any]) -> None:
    print("AgentID/X1 diagnostic")
    print(f"wallet: {result['wallet']}")
    print(f"rpc_health: {result.get('rpc_health')}")
    nx = result["native_xnt"]
    print(f"native_xnt: {nx['xnt']} XNT ({nx['lamports']} lamports)")
    agi = result["agi"]
    print(f"agi: {agi['amount']} AGI; required_0.1={agi['has_required_0_1_agi']}; token_accounts={agi['token_account_count']}")
    wx = result["wxnt"]
    print(f"wxnt_token_accounts: {wx['token_account_count']} (not required by AgentID)")
    print(f"agentid_verified: {result.get('agentid_verify', {}).get('verified')}")
    print(f"documented_unsigned_tx_builder_endpoint: {result.get('docs', {}).get('documented_unsigned_tx_builder_endpoint')}")
    print(f"next_action: {result['decision']['next_action']}")
    if result["decision"].get("stop_reason"):
        print(f"stop_reason: {result['decision']['stop_reason']}")
    print(f"loop_breaker: {result['decision']['loop_breaker']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only AgentID/X1 diagnostic for HXMP agents")
    sub = parser.add_subparsers(dest="cmd", required=True)
    status = sub.add_parser("status", help="Check wallet, AgentID, AGI, XNT, docs, and next action")
    status.add_argument("--wallet", required=True, help="X1 wallet public key")
    status.add_argument("--json", action="store_true", help="Print JSON only")
    args = parser.parse_args()

    if args.cmd == "status":
        result = diagnose(args.wallet)
        if args.json:
            print(json.dumps(result, indent=2, sort_keys=True))
        else:
            print_human(result)
        return 0
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
