# Python starter

```python
from app import create_app
from list_offer import list_offer

app = create_app(price="0.01", pay_to=PAY_TO, network="base", facilitator=Facilitator())
result = list_offer(offer, pay=lambda required: sign(required), registry_url="https://lax.kognai.ai/registry")
```

`GET /health` is free. `GET /paid` mirrors the TypeScript route: 402 with the requirements,
verify, settle, then 200 with `X-PAYMENT-RESPONSE`.

Tests: `.venv/bin/python -m pytest -q` (5 tests, A1 to A4 plus the price check).

A5 proof: the transaction hash of one paid call on Base Sepolia is not in this README yet, see the
root README, "What is open".
