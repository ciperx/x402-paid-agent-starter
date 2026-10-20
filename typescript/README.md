# TypeScript starter

```ts
import { createApp } from "./src/app.ts";

const app = createApp({
  price: "0.01",
  payTo: process.env.PAY_TO!,
  network: "base",
  facilitator: { verify: (p, r) => fetchFacilitator("/verify", p, r), settle: (p, r) => fetchFacilitator("/settle", p, r) },
});

// Node, Hono, Bun or a worker
const response = await app.fetch(new Request("https://agent.example/paid"));
```

`GET /health` is free. `GET /paid` answers 402 with the payment requirements, verifies and
settles `X-PAYMENT`, and only then answers 200 with `X-PAYMENT-RESPONSE`.

Tests: `node --test test/*.test.js` (6 tests, A1 to A6, offline).

A5 proof: the transaction hash of one paid call on Base Sepolia is not in this README yet, see the
root README, "What is open".
