import base64
import json

import pytest

from app import USDC, create_app
from list_offer import list_offer

PAY_TO = "0x" + "ab" * 20
PAYLOAD = {"x402Version": 1, "scheme": "exact", "payload": {"signature": "0xdead"}}


class Facilitator:
    def __init__(self, valid=True, settled=True, tx="0x" + "cd" * 32):
        self.valid = valid
        self.settled = settled
        self.tx = tx
        self.seen = []

    def verify(self, payload, requirements):
        self.seen.append("verify")
        return {"isValid": self.valid} if self.valid else {"isValid": False, "invalidReason": "insufficient funds"}

    def settle(self, payload, requirements):
        self.seen.append("settle")
        if not self.settled:
            return {"success": False, "errorReason": "nonce already used"}
        return {"success": True, "transaction": self.tx, "network": requirements["network"]}


def header():
    return {"X-PAYMENT": base64.b64encode(json.dumps(PAYLOAD).encode()).decode()}


def test_a1_unpaid_call_answers_402_with_requirements():
    app = create_app(price="0.01", pay_to=PAY_TO, network="base", facilitator=Facilitator())
    client = app.test_client()
    response = client.get("/paid")
    assert response.status_code == 402
    body = response.get_json()
    assert body["x402Version"] == 1
    needs = body["accepts"][0]
    assert needs["scheme"] == "exact"
    assert needs["network"] == "base"
    assert needs["maxAmountRequired"] == "10000"
    assert needs["asset"] == USDC["base"]
    assert needs["payTo"] == PAY_TO
    assert needs["mimeType"] == "application/json"
    assert client.get("/health").status_code == 200


def test_a2_paid_call_is_verified_settled_and_answered_with_the_receipt():
    worked = {"count": 0}

    def work(payload):
        worked["count"] += 1
        return {"answer": 42}

    facilitator = Facilitator()
    app = create_app(price="0.02", pay_to=PAY_TO, network="base", facilitator=facilitator, handler=work)
    client = app.test_client()

    paid = client.get("/paid", headers=header())
    assert paid.status_code == 200
    assert paid.get_json() == {"answer": 42}
    assert worked["count"] == 1
    receipt = json.loads(base64.b64decode(paid.headers["X-PAYMENT-RESPONSE"]))
    assert receipt["success"] is True
    assert len(receipt["transaction"]) == 66
    assert facilitator.seen == ["verify", "settle"]

    refused = create_app(price="0.02", pay_to=PAY_TO, network="base", facilitator=Facilitator(valid=False), handler=work).test_client()
    assert refused.get("/paid", headers=header()).status_code == 402

    unsettled = create_app(price="0.02", pay_to=PAY_TO, network="base", facilitator=Facilitator(settled=False), handler=work).test_client()
    assert unsettled.get("/paid", headers=header()).status_code == 402
    assert worked["count"] == 1


def test_a3_the_offer_carries_pricing_and_the_five_laws():
    offer = json.load(open("lax-offer.json"))
    assert 3 <= len(offer["name"]) <= 80
    assert 20 <= len(offer["description"]) <= 600
    assert offer["endpoint"].startswith("https://")
    capability = offer["capabilities"][0]
    assert capability["pricing"]["model"] == "per_call"
    assert capability["pricing"]["currency"] == "USDC"
    assert capability["pricing"]["rail"] == "x402"
    assert capability["input_schema"] and capability["output_schema"]
    text = json.dumps(offer["constitutional_constraints"])
    for law in ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"]:
        assert law in text


class Response:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body


class Http:
    def __init__(self):
        self.calls = []

    def post(self, url, data=None, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "data": data})
        if len(self.calls) == 1:
            return Response(402, {"x402Version": 1, "accepts": [{"scheme": "exact", "maxAmountRequired": "10000"}]})
        return Response(200, {"ok": True, "id": "lax-ext-test02"})


def test_a4_the_listing_script_pays_the_registry_402_and_returns_the_id():
    http = Http()
    seen = {}

    def pay(required):
        seen["required"] = required
        return "signed-payment-header"

    result = list_offer({"name": "quote desk", "description": "a paid quote desk"}, pay, http=http)
    assert result["id"] == "lax-ext-test02"
    assert seen["required"]["accepts"][0]["maxAmountRequired"] == "10000"
    assert "X-PAYMENT" not in http.calls[0]["headers"]
    assert http.calls[1]["headers"]["X-PAYMENT"] == "signed-payment-header"
    assert http.calls[0]["url"].endswith("/registry/offers")


def test_price_must_be_a_usdc_decimal():
    with pytest.raises(ValueError):
        create_app(price="1.1234567", pay_to=PAY_TO, network="base", facilitator=Facilitator())
