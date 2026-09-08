import type { ApiVersion } from "@shopify/shopify-app-react-router/server";

export type GraphqlClient = {
  graphql: (query: string, options?: {
    variables?: Record<string, unknown>;
    apiVersion?: ApiVersion;
    tries?: number;
  }) => Promise<Response>;
};

type RequestState = {
  tail: Promise<void>;
  available: number;
  restoreRate: number;
  maximum: number;
  observedAt: number;
  costs: Map<string, number>;
};

const states = new WeakMap<GraphqlClient, RequestState>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function throttleErrors(body: any) {
  const errors = body?.errors?.graphQLErrors ?? body?.errors;
  return Array.isArray(errors) && errors.length > 0 && errors.every((error: any) =>
    error.extensions?.code === "THROTTLED" || /^throttled\.?$/i.test(error.message || ""),
  ) && !body?.data;
}

function retryAfterMs(headers: any) {
  const value = headers?.get?.("retry-after") ?? headers?.["retry-after"] ?? headers?.["Retry-After"];
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === null) return 0;
  const seconds = Number(text);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(text) - Date.now()) || 0;
}

function recordCost(state: RequestState, query: string, body: any) {
  const cost = body?.extensions?.cost;
  const throttle = cost?.throttleStatus;
  if (!throttle || !Number.isFinite(throttle.currentlyAvailable) || !(throttle.restoreRate > 0)) return;
  state.available = throttle.currentlyAvailable;
  state.restoreRate = throttle.restoreRate;
  state.maximum = throttle.maximumAvailable;
  state.observedAt = Date.now();
  if (Number.isFinite(cost.requestedQueryCost)) state.costs.set(query, cost.requestedQueryCost);
}

function budgetWait(state: RequestState, query: string) {
  if (!state.restoreRate) return 0;
  const available = state.available + (Date.now() - state.observedAt) * state.restoreRate / 1000;
  const required = Math.min(state.maximum, (state.costs.get(query) ?? 50) + 5);
  return Math.max(0, Math.ceil((required - available) / state.restoreRate * 1000));
}

// Serialize each client's requests so concurrent bulk workers share the same budget.
// Retry only explicit throttling rejections; other mutation failures may have committed.
export async function shopifyRequest(
  admin: GraphqlClient,
  query: string,
  options?: Parameters<GraphqlClient["graphql"]>[1],
): Promise<Response> {
  let state = states.get(admin);
  if (!state) {
    state = { tail: Promise.resolve(), available: 0, restoreRate: 0, maximum: 1000, observedAt: 0, costs: new Map() };
    states.set(admin, state);
  }
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const pause = budgetWait(state, query);
      if (pause > 0) await sleep(pause);
      let retryAfter = 0;
      try {
        const response = await admin.graphql(query, options);
        const body = await response.clone().json().catch(() => null);
        recordCost(state, query, body);
        if (response.status !== 429 && !throttleErrors(body)) return response;
        retryAfter = retryAfterMs(response.headers);
      } catch (error: any) {
        recordCost(state, query, error?.body);
        const http429 = error?.response?.code === 429 || error?.response?.status === 429;
        const throttled = throttleErrors(error?.body) || (!error?.body && /^throttled\.?$/i.test(error?.message || ""));
        if (!http429 && !throttled) throw error;
        retryAfter = retryAfterMs(error?.headers ?? error?.response?.headers);
      }
      if (attempt === 11) break;
      await sleep(Math.max(retryAfter, budgetWait(state, query), Math.min(30000, 1000 * 2 ** attempt)));
    }
    throw new Error("Shopify's rate limit remained busy after 12 attempts. This operation was not confirmed; retry this row later.");
  } finally {
    release();
  }
}
