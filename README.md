# x402 paid agent starter

Two starters for a paid agent listed on LAX, one in TypeScript and one in Python, each usable on
its own: one route priced in USDC over x402, a valid LAX offer with the Five Laws, and a script
that lists the offer on the registry.

## Layout

- `typescript/src/app.ts`: `createApp({price, payTo, network, facilitator, description?})` returns
  `{fetch(request)}`, web standard `Request` and `Response`, so it runs on Node, Hono, Bun or a
  worker. `GET /health` is free, `GET /paid` is the paid route.
- `typescript/src/list.ts`: `listOffer({offer, registryUrl?, fetch?, pay})` posts the offer, pays
  the registry's 402 through `pay` and returns `{id}`. The key stays with the caller and is never
  logged.
- `typescript/lax-offer.json` and `python/lax-offer.json`: the same offer, a per call capability
  priced in USDC over x402, an https endpoint on the builder's domain, and the Five Laws.
- `python/app.py`: `create_app(price=..., pay_to=..., network=..., facilitator=..., handler=...)`
  with the same routes and the same behaviour, Flask, pinned in `requirements.txt`.
- `python/list_offer.py`: `list_offer(offer, pay, registry_url=..., http=requests)`.

## Protocol

Version 1 headers, exact scheme, USDC:

- Unpaid `GET /paid` answers 402 with
  `{x402Version: 1, error, accepts: [{scheme, network, maxAmountRequired, resource, description, mimeType, payTo, maxTimeoutSeconds, asset}]}`.
- A paid call sends `X-PAYMENT`, base64 JSON of the payment payload. The app verifies it through
  the facilitator, settles it, and only then does the work, answering 200 with
  `X-PAYMENT-RESPONSE`, base64 JSON of the settlement.
- A payment that does not verify or does not settle answers 402 and no work is done.
- The asset is the USDC contract of the chosen network: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  on base, `0x036CbD53842c5426634e7929541eC2318f3dCF7e` on base-sepolia.
- The price is a decimal USDC string such as `0.01`, converted to atomic units with six decimals.

## Run the tests

```sh
cd typescript && node --test test/*.test.js
cd python && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m pytest -q
```

TypeScript: 6 tests, each named after the acceptance item it proves, with an injected facilitator
and an injected fetch, so they run offline. Python: 5 tests mirroring A1 to A4.

## What is open

A5 asks for the transaction hash of one paid call per starter on Base Sepolia. Both starters are
ready for it: point `facilitator` at a live facilitator, set `payTo` to a wallet you control and
run one paid call. I did not have a funded Sepolia payer in this build session, so the READMEs
carry no hash yet, and I will not paste a hash I could not produce.
