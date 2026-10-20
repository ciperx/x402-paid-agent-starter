/**
 * A paid route over x402, version 1 headers, exact scheme, USDC on Base or Base Sepolia.
 * Web standard Request and Response only, so the same code runs on Node, Hono, Bun or a worker.
 */

export const USDC = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export type Network = keyof typeof USDC;

export interface PaymentRequirements {
  scheme: "exact";
  network: Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
}

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
}

export interface SettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  errorReason?: string;
}

export interface Facilitator {
  verify(paymentPayload: unknown, paymentRequirements: PaymentRequirements): Promise<VerifyResult>;
  settle(paymentPayload: unknown, paymentRequirements: PaymentRequirements): Promise<SettleResult>;
}

export interface CreateAppOptions {
  price: string;
  payTo: string;
  network: Network;
  facilitator: Facilitator;
  description?: string;
  resource?: string;
  maxTimeoutSeconds?: number;
  handler?: (paymentPayload: unknown) => Promise<unknown> | unknown;
}

export interface App {
  fetch(request: Request): Promise<Response>;
}

function toAtomic(price: string): string {
  const clean = String(price).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) throw new Error(`price must be a decimal USDC amount with at most 6 decimals, got ${price}`);
  const [whole, fraction = ""] = clean.split(".");
  const padded = (fraction + "000000").slice(0, 6);
  return `${BigInt(whole)}${padded}`.replace(/^0+(?=\d)/, "");
}

function base64Json(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function decodeBase64Json(value: string): unknown {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function createApp(options: CreateAppOptions): App {
  const { price, payTo, network, facilitator, description = "A paid answer", resource, handler } = options;
  const amount = toAtomic(price);
  if (!(network in USDC)) throw new Error(`network must be base or base-sepolia, got ${String(network)}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) throw new Error("payTo must be an address");

  const requirements = (url: string): PaymentRequirements => ({
    scheme: "exact",
    network,
    maxAmountRequired: amount,
    resource: resource ?? url,
    description,
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: options.maxTimeoutSeconds ?? 60,
    asset: USDC[network],
  });

  async function paid(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const needs = requirements(url.toString());
    const header = request.headers.get("X-PAYMENT");

    if (!header) {
      return json({ x402Version: 1, error: "payment required", accepts: [needs] }, 402);
    }

    let payload: unknown;
    try {
      payload = decodeBase64Json(header);
    } catch {
      return json({ x402Version: 1, error: "X-PAYMENT is not base64 JSON", accepts: [needs] }, 402);
    }

    const verification = await facilitator.verify(payload, needs);
    if (!verification?.isValid) {
      return json({ x402Version: 1, error: verification?.invalidReason ?? "payment did not verify", accepts: [needs] }, 402);
    }

    const settlement = await facilitator.settle(payload, needs);
    if (!settlement?.success) {
      return json({ x402Version: 1, error: settlement?.errorReason ?? "payment did not settle", accepts: [needs] }, 402);
    }

    const result = handler ? await handler(payload) : { ok: true, paid: true };
    return json(result, 200, { "X-PAYMENT-RESPONSE": base64Json(settlement) });
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method !== "GET") {
        return json({ error: "method not allowed" }, 405, { allow: "GET" });
      }
      if (url.pathname === "/health") return json({ ok: true }, 200);
      if (url.pathname === "/paid") return paid(request);
      return json({ error: "not found" }, 404);
    },
  };
}
