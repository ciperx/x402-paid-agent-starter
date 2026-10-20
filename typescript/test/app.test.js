import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createApp, USDC } from "../src/app.ts";
import { listOffer } from "../src/list.ts";

const PAY_TO = "0x" + "ab".repeat(20);

function facilitatorDouble({ valid = true, settled = true, tx = "0x" + "cd".repeat(32) } = {}) {
  const seen = [];
  return {
    seen,
    verify: async (payload, requirements) => {
      seen.push({ step: "verify", payload, requirements });
      return valid ? { isValid: true } : { isValid: false, invalidReason: "insufficient funds" };
    },
    settle: async (payload, requirements) => {
      seen.push({ step: "settle", payload, requirements });
      return settled ? { success: true, transaction: tx, network: requirements.network } : { success: false, errorReason: "nonce already used" };
    },
  };
}

const paidHeader = "X-PAYMENT";
const payload = { x402Version: 1, scheme: "exact", payload: { signature: "0xdead", authorization: { from: PAY_TO, to: PAY_TO } } };

function request(path, headers = {}) {
  return new Request(`https://agent.example${path}`, { headers });
}

test("A1 an unpaid call answers 402 with valid payment requirements", async () => {
  const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base", facilitator: facilitatorDouble() });
  const response = await app.fetch(request("/paid"));
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.x402Version, 1);
  assert.ok(Array.isArray(body.accepts) && body.accepts.length === 1);
  const needs = body.accepts[0];
  assert.equal(needs.scheme, "exact");
  assert.equal(needs.network, "base");
  assert.equal(needs.maxAmountRequired, "10000");
  assert.equal(needs.asset, USDC.base);
  assert.equal(needs.payTo, PAY_TO);
  assert.equal(needs.mimeType, "application/json");
  assert.ok(needs.maxTimeoutSeconds >= 30);
  assert.match(needs.resource, /\/paid$/);

  const health = await app.fetch(request("/health"));
  assert.equal(health.status, 200);
});

test("A2 a paid call is verified, settled, then answered 200 with X-PAYMENT-RESPONSE, and a failed payment gets 402 with no work", async () => {
  let worked = 0;
  const good = facilitatorDouble();
  const app = createApp({
    price: "0.02",
    payTo: PAY_TO,
    network: "base",
    facilitator: good,
    handler: () => {
      worked += 1;
      return { answer: 42 };
    },
  });

  const ok = await app.fetch(request("/paid", { [paidHeader]: btoa(JSON.stringify(payload)) }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { answer: 42 });
  assert.equal(worked, 1);
  const receipt = JSON.parse(atob(ok.headers.get("X-PAYMENT-RESPONSE")));
  assert.equal(receipt.success, true);
  assert.match(receipt.transaction, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(good.seen.map((entry) => entry.step), ["verify", "settle"]);
  assert.equal(good.seen[0].requirements.maxAmountRequired, "20000");

  const badVerify = createApp({ price: "0.02", payTo: PAY_TO, network: "base", facilitator: facilitatorDouble({ valid: false }), handler: () => { worked += 1; } });
  const refused = await badVerify.fetch(request("/paid", { [paidHeader]: btoa(JSON.stringify(payload)) }));
  assert.equal(refused.status, 402);
  assert.match((await refused.json()).error, /insufficient/);

  const badSettle = createApp({ price: "0.02", payTo: PAY_TO, network: "base", facilitator: facilitatorDouble({ settled: false }), handler: () => { worked += 1; } });
  const unsettled = await badSettle.fetch(request("/paid", { [paidHeader]: btoa(JSON.stringify(payload)) }));
  assert.equal(unsettled.status, 402);
  assert.match((await unsettled.json()).error, /nonce/);
  assert.equal(worked, 1, "no work on a failed payment");

  const junk = await app.fetch(request("/paid", { [paidHeader]: "not base64 json" }));
  assert.equal(junk.status, 402);
});

test("A3 each starter's offer carries the paid route, its pricing and the Five Laws", async () => {
  const laws = ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"];
  for (const path of ["../lax-offer.json", "../../python/lax-offer.json"]) {
    const offer = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
    assert.ok(offer.name.length >= 3 && offer.name.length <= 80);
    assert.ok(offer.description.length >= 20 && offer.description.length <= 600);
    assert.match(offer.endpoint, /^https:\/\//);
    assert.ok(Array.isArray(offer.capabilities) && offer.capabilities.length >= 1);
    const capability = offer.capabilities[0];
    assert.equal(capability.pricing.model, "per_call");
    assert.match(capability.pricing.amount, /^\d+(\.\d+)?$/);
    assert.equal(capability.pricing.currency, "USDC");
    assert.equal(capability.pricing.rail, "x402");
    assert.ok(capability.input_schema && capability.output_schema);
    const text = JSON.stringify(offer.constitutional_constraints);
    for (const law of laws) assert.ok(text.includes(law), `missing ${law}`);
  }
});

test("A4 the listing script answers the registry 402, pays with the returned header and returns the id, without logging a key", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ x402Version: 1, accepts: [{ scheme: "exact", maxAmountRequired: "10000" }] }), { status: 402 });
    }
    return new Response(JSON.stringify({ ok: true, id: "lax-ext-test01" }), { status: 200 });
  };

  const offer = { name: "quote desk", description: "a paid quote desk", capabilities: [], constitutional_constraints: [] };
  const result = await listOffer({ offer, fetch: fakeFetch, pay: async (required) => {
    assert.equal(required.accepts[0].maxAmountRequired, "10000");
    return "signed-payment-header";
  } });
  assert.equal(result.id, "lax-ext-test01");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers["X-PAYMENT"], undefined);
  assert.equal(calls[1].headers["X-PAYMENT"], "signed-payment-header");
  assert.match(calls[0].url, /\/registry\/offers$/);

  const failing = async () => new Response(JSON.stringify({ error: "offer must name an endpoint" }), { status: 400 });
  await assert.rejects(() => listOffer({ offer, fetch: failing, pay: async () => "header" }), /refused/);
});

test("A5 the Base Sepolia network is priced in its own USDC and the settlement transaction comes back to the caller", async () => {
  const app = createApp({ price: "1.5", payTo: PAY_TO, network: "base-sepolia", facilitator: facilitatorDouble({ tx: "0x" + "ef".repeat(32) }) });
  const unpaid = await app.fetch(request("/paid"));
  const needs = (await unpaid.json()).accepts[0];
  assert.equal(needs.network, "base-sepolia");
  assert.equal(needs.asset, USDC["base-sepolia"]);
  assert.equal(needs.maxAmountRequired, "1500000");

  const paid = await app.fetch(request("/paid", { [paidHeader]: btoa(JSON.stringify(payload)) }));
  assert.equal(paid.status, 200);
  const receipt = JSON.parse(atob(paid.headers.get("X-PAYMENT-RESPONSE")));
  assert.equal(receipt.network, "base-sepolia");
  assert.equal(receipt.transaction, "0x" + "ef".repeat(32));
});

test("A6 the Python starter mirrors A1 to A4 with pytest tests", async () => {
  const app = await readFile(new URL("../../python/app.py", import.meta.url), "utf8");
  const listing = await readFile(new URL("../../python/list_offer.py", import.meta.url), "utf8");
  const requirements = await readFile(new URL("../../python/requirements.txt", import.meta.url), "utf8");
  const tests = await readFile(new URL("../../python/test_app.py", import.meta.url), "utf8");

  assert.match(app, /def create_app/);
  assert.match(app, /X-PAYMENT/);
  assert.match(app, /X-PAYMENT-RESPONSE/);
  assert.match(app, /maxAmountRequired/);
  assert.match(listing, /def list_offer/);
  assert.match(requirements, /flask/i);
  assert.match(requirements, /pytest/i);
  for (const name of ["test_a1_", "test_a2_", "test_a3_", "test_a4_"]) {
    assert.ok(tests.includes(name), `pytest is missing ${name}`);
  }
});
