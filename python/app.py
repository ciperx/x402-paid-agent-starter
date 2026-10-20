"""A paid route over x402 v1, exact scheme, USDC on Base or Base Sepolia. Flask, no extra deps."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Callable

from flask import Flask, Response, jsonify, request

USDC = {
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
}


def to_atomic(price: str) -> str:
    clean = str(price).strip()
    if not re.fullmatch(r"\d+(\.\d{1,6})?", clean):
        raise ValueError(f"price must be a decimal USDC amount with at most 6 decimals, got {price}")
    whole, _, fraction = clean.partition(".")
    amount = str(int(whole)) + (fraction + "000000")[:6]
    return amount.lstrip("0") or "0"


def requirements_for(*, amount: str, network: str, pay_to: str, resource: str, description: str, timeout: int = 60) -> dict:
    if network not in USDC:
        raise ValueError("network must be base or base-sepolia")
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", pay_to):
        raise ValueError("pay_to must be an address")
    return {
        "scheme": "exact",
        "network": network,
        "maxAmountRequired": amount,
        "resource": resource,
        "description": description,
        "mimeType": "application/json",
        "payTo": pay_to,
        "maxTimeoutSeconds": timeout,
        "asset": USDC[network],
    }


def create_app(
    *,
    price: str,
    pay_to: str,
    network: str,
    facilitator: Any,
    description: str = "A paid answer",
    handler: Callable[[Any], Any] | None = None,
) -> Flask:
    amount = to_atomic(price)
    app = Flask(__name__)

    def needs() -> dict:
        return requirements_for(
            amount=amount,
            network=network,
            pay_to=pay_to,
            resource=request.url,
            description=description,
        )

    def tell(message: str, doc: dict) -> Response:
        body = {"x402Version": 1, "error": message, "accepts": [doc]}
        return Response(json.dumps(body), status=402, mimetype="application/json")

    @app.get("/health")
    def health() -> Response:
        return jsonify({"ok": True})

    @app.get("/paid")
    def paid() -> Response:
        doc = needs()
        header = request.headers.get("X-PAYMENT")
        if not header:
            return tell("payment required", doc)
        try:
            payload = json.loads(base64.b64decode(header, validate=True))
        except Exception:
            return tell("X-PAYMENT is not base64 JSON", doc)

        verification = facilitator.verify(payload, doc)
        if not verification.get("isValid"):
            return tell(verification.get("invalidReason", "payment did not verify"), doc)

        settlement = facilitator.settle(payload, doc)
        if not settlement.get("success"):
            return tell(settlement.get("errorReason", "payment did not settle"), doc)

        result = handler(payload) if handler else {"ok": True, "paid": True}
        receipt = base64.b64encode(json.dumps(settlement).encode()).decode()
        return Response(json.dumps(result), status=200, mimetype="application/json", headers={"X-PAYMENT-RESPONSE": receipt})

    return app
