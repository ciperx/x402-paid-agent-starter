"""List an offer on the LAX registry, answering the registry's own 402 with a payment header."""

from __future__ import annotations

import json
from typing import Any, Callable

import requests


def list_offer(
    offer: dict,
    pay: Callable[[Any], str],
    registry_url: str = "https://lax.kognai.ai/registry",
    http: Any = requests,
) -> dict:
    """POST the offer, pay the 402 through pay(), and return {"id": ...}.

    The key belongs to the caller: this function never reads, stores or logs one.
    """
    url = registry_url.rstrip("/") + "/offers"

    def post(payment: str | None = None) -> Any:
        headers = {"content-type": "application/json", "accept": "application/json"}
        if payment:
            headers["X-PAYMENT"] = payment
        return http.post(url, data=json.dumps(offer), headers=headers, timeout=60)

    response = post()
    if response.status_code == 402:
        header = pay(response.json())
        if not header or not isinstance(header, str):
            raise RuntimeError("pay did not return a payment header")
        response = post(header)

    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}

    if response.status_code >= 400:
        reason = body.get("error", f"answered {response.status_code}") if isinstance(body, dict) else str(body)
        raise RuntimeError(f"the registry refused the offer: {reason}")

    listing = body.get("id") if isinstance(body, dict) else None
    if not listing:
        raise RuntimeError("the registry answered without a listing id")
    return {"id": listing, "body": body}
