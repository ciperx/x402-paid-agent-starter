/**
 * List an offer on the LAX registry, answering the registry's own 402 with a payment header
 * from the caller's pay function. The key stays with the caller: nothing here logs it.
 */

export interface ListOfferOptions {
  offer: Record<string, unknown>;
  registryUrl?: string;
  fetch?: typeof globalThis.fetch;
  pay: (paymentRequired: unknown) => Promise<string> | string;
}

export interface ListOfferResult {
  id: string;
  body?: unknown;
}

export async function listOffer(options: ListOfferOptions): Promise<ListOfferResult> {
  const { offer, pay } = options;
  const base = (options.registryUrl ?? "https://lax.kognai.ai/registry").replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = `${base}/offers`;

  const post = async (payment?: string): Promise<Response> => {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (payment) headers["X-PAYMENT"] = payment;
    return doFetch(url, { method: "POST", headers, body: JSON.stringify(offer) });
  };

  let response = await post();
  if (response.status === 402) {
    const required = await response.json();
    const header = await pay(required);
    if (!header || typeof header !== "string") throw new Error("pay did not return a payment header");
    response = await post(header);
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const reason = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `answered ${response.status}`;
    throw new Error(`the registry refused the offer: ${reason}`);
  }

  const id = typeof body === "object" && body ? (body as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || id.length === 0) throw new Error("the registry answered without a listing id");
  return { id, body };
}
