const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

// Load server logic with external services mocked; no Shopify or database writes.
function load(file, mocks, extraExports = "", globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../app/models", file), "utf8");
  const code = ts.transpileModule(source + extraExports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, console, Error, setTimeout, clearTimeout, Response, ...globals,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "node:crypto") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

let now = 0;
const delays = [];
const requests = load("shopify-requests.server.ts", {}, "", {
  Date: class extends Date { static now() { return now; } },
  setTimeout(fn, ms) { delays.push(ms); now += ms; queueMicrotask(fn); },
});
const products = load("bulk-products.server.ts", {
  "./shopify-requests.server": requests,
  "@shopify/shopify-app-react-router/server": { ApiVersion: { April26: "2026-04" } },
  "./bulk-spreadsheets.server": { shopifyCategoryOptions: [] },
});
const row = (i) => ({
  productId: `product-${i}`, variantId: `variant-${i}`,
  inventoryItemId: `inventory-${i}`, barcode: `00${i}`, quantity: i % 2 ? 30 : 0,
});
const confirmed = () => Response.json({ data: {
  inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: "2026-09-06" }, userErrors: [] },
} });

test("4360 rows use compatible API, bounded batches and distinct retry keys", async () => {
  const keys = new Set();
  const sizes = [];
  const result = await products.updateInventoryQuantities({ graphql: async (query, options) => {
    assert.equal(options.apiVersion, "2026-04");
    assert.match(query, /@idempotent\(key: \$idempotencyKey\)/);
    assert.equal(options.tries, 1);
    assert.ok(!keys.has(options.variables.idempotencyKey));
    keys.add(options.variables.idempotencyKey);
    const quantities = options.variables.input.quantities;
    assert.ok(quantities.length <= 250);
    sizes.push(quantities.length);
    for (const quantity of quantities) {
      assert.equal(quantity.changeFromQuantity, null);
      assert.equal(quantity.locationId, "location");
      assert.ok(!Object.hasOwn(quantity, "compareQuantity"));
    }
    return confirmed();
  } }, Array.from({ length: 4360 }, (_, i) => row(i)), "location");
  assert.equal(sizes.length, 18);
  assert.equal(sizes.at(-1), 110);
  assert.equal(result.updatedRows, 4360);
  assert.equal(result.failedRows, 0);
  assert.equal(result.rowResults.length, 4360);
});

test("failed batch identifies barcodes and does not count them as updated", async () => {
  let calls = 0;
  const result = await products.updateInventoryQuantities({ graphql: async () => {
    if (++calls === 1) throw new Error("Inventory unavailable");
    return confirmed();
  } }, Array.from({ length: 251 }, (_, i) => row(i)), "location");
  assert.equal(result.updatedRows, 1);
  assert.equal(result.failedRows, 250);
  assert.equal(result.rowResults[0].barcode, "000");
  assert.equal(result.rowResults[0].message, "Inventory unavailable");
  assert.equal(result.rowResults[250].success, true);
});

test("Shopify user errors and missing confirmation are failures", async () => {
  for (const data of [{}, { inventorySetQuantities: { userErrors: [
    { code: "INVALID", field: ["quantities", "0"], message: "Invalid inventory item" },
  ] } }]) {
    const result = await products.updateInventoryQuantities({ graphql: async () => Response.json({ data }) }, [row(1)], "location");
    assert.equal(result.updatedRows, 0);
    assert.equal(result.failedRows, 1);
    assert.ok(result.rowResults[0].message.length > 0);
  }
});

test("GraphQL throttling retries the same inventory key until confirmed", async () => {
  const optionsSeen = [];
  const start = delays.length;
  const result = await products.updateInventoryQuantities({ graphql: async (_query, options) => {
    optionsSeen.push(options);
    if (optionsSeen.length < 4) return Response.json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] });
    return confirmed();
  } }, [row(1)], "location");
  assert.equal(result.updatedRows, 1);
  assert.equal(result.failedRows, 0);
  assert.equal(optionsSeen.length, 4);
  assert.ok(optionsSeen.every((options) => options === optionsSeen[0]));
  assert.deepEqual(delays.slice(start), [1000, 2000, 4000]);
});

test("SDK thrown throttling and HTTP 429 respect Retry-After", async () => {
  let calls = 0;
  const start = delays.length;
  const response = await requests.shopifyRequest({ graphql: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Throttled"), {
      body: { errors: { graphQLErrors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } },
    });
    if (calls === 2) return new Response("Rate limited", { status: 429, headers: { "Retry-After": "7" } });
    return confirmed();
  } }, "mutation test");
  assert.equal(response.status, 200);
  assert.deepEqual(delays.slice(start), [1000, 7000]);
});

test("4360 concurrent status updates recover from throttles and verify Shopify status", async () => {
  const attempts = new Map();
  let inFlight = 0;
  let peak = 0;
  const outcomes = await products.updateProductStatuses({ graphql: async (_query, options) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    const { id, status } = options.variables.product;
    attempts.set(id, (attempts.get(id) || 0) + 1);
    if (attempts.get(id) === 1) throw Object.assign(new Error("Throttled"), {
      body: { errors: { graphQLErrors: [{ extensions: { code: "THROTTLED" } }] } },
    });
    return Response.json({ data: { productUpdate: { product: { id, status }, userErrors: [] } } });
  } }, Array.from({ length: 4360 }, (_, i) => `product-${i}`), "DRAFT");
  assert.equal(peak, 1);
  assert.equal(outcomes.length, 4360);
  assert.ok(outcomes.every((outcome) => outcome.success));
});

test("rate budget pauses the next call before Shopify rejects it", async () => {
  const start = delays.length;
  const admin = { graphql: async () => Response.json({ data: { ok: true }, extensions: { cost: {
    requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 0, maximumAvailable: 1000, restoreRate: 50 },
  } } }) };
  await requests.shopifyRequest(admin, "query test");
  await requests.shopifyRequest(admin, "query test");
  assert.deepEqual(delays.slice(start), [300]);
});

test("permanent errors are not retried and persistent throttling is bounded", async () => {
  let calls = 0;
  await assert.rejects(requests.shopifyRequest({ graphql: async () => {
    calls += 1;
    throw new Error("Access denied");
  } }, "mutation test"), /Access denied/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(requests.shopifyRequest({ graphql: async () => {
    calls += 1;
    return Response.json({ errors: [{ message: "Throttled" }] });
  } }, "mutation test"), /12 attempts/);
  assert.equal(calls, 12);
});

test("invalid inventory row does not prevent valid rows in its batch", async () => {
  const result = await products.updateInventoryQuantities({ graphql: async (_query, options) => {
    if (options.variables.input.quantities.some((item) => item.inventoryItemId === "inventory-5")) {
      return Response.json({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [
        { code: "INVALID_INVENTORY_ITEM", message: "Inventory item no longer exists" },
      ] } } });
    }
    return confirmed();
  } }, Array.from({ length: 250 }, (_, i) => row(i)), "location");
  assert.equal(result.updatedRows, 249);
  assert.equal(result.failedRows, 1);
  const failed = result.rowResults.filter((entry) => !entry.success);
  assert.equal(failed[0].barcode, "005");
  assert.match(failed[0].message, /no longer exists/);
});

test("missing or incorrect returned status is never reported as success", async () => {
  for (const product of [null, { id: "product-1", status: "ACTIVE" }]) {
    const result = await products.updateProductStatuses({ graphql: async () =>
      Response.json({ data: { productUpdate: { product, userErrors: [] } } }),
    }, ["product-1"], "DRAFT");
    assert.equal(result[0].success, false);
  }
});

test("failed stock blocks product status and reports each uploaded row once", async () => {
  const changed = [];
  const jobs = load("bulk-jobs.server.ts", {
    "../db.server": {}, "../shopify.server": {},
    "./bulk-products.server": {
      ...products,
      resolveStatusRowsProductIds: async (_admin, rows) => rows,
      updateProductStatuses: async (_admin, ids) => {
        changed.push(...ids);
        return ids.map((productId) => ({ productId, success: true, message: "Status updated." }));
      },
    },
  }, "\nexport { runBulkJobIntent, summarizeJobResult };\n");
  let calls = 0;
  const result = await jobs.runBulkJobIntent({ graphql: async () => {
    if (++calls === 1) throw new Error("Stock rejected");
    return confirmed();
  } }, "update-stock", { rows: Array.from({ length: 251 }, (_, i) => row(i)), locationId: "location" }, async () => {});
  assert.deepEqual(changed, ["product-250"]);
  assert.equal(result.reportRows[0].status, "Error");
  assert.match(result.reportRows[0].message, /Stock rejected/);
  assert.equal(result.reportRows[250].status, "Success");
  const counts = jobs.summarizeJobResult(251, result);
  assert.equal(counts.successRows, 1);
  assert.equal(counts.failedRows, 250);
});
