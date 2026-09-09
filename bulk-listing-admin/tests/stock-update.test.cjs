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
    exports, console, Error, setTimeout, clearTimeout, setInterval, clearInterval, Response, ...globals,
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
}, "\nexport { findExistingVariantByBarcode };\n");
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

const noAdjustment = () => Response.json({ data: {
  inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [] },
} });
const inventoryNode = (id, quantity) => ({ id, inventoryLevel: { quantities: [{ name: "available", quantity }] } });

test("4360 unchanged quantities are verified at the selected location, not falsely failed", async () => {
  let writes = 0;
  let reads = 0;
  const input = Array.from({ length: 4360 }, (_, i) => row(i));
  const expected = new Map(input.map((entry) => [entry.inventoryItemId, entry.quantity]));
  const result = await products.updateInventoryQuantities({ graphql: async (query, options) => {
    if (query.includes("mutation BulkListingInventory")) {
      writes++;
      return noAdjustment();
    }
    reads++;
    assert.match(query, /inventoryLevel\(locationId: \$locationId\)/);
    assert.equal(options.variables.locationId, "location");
    assert.equal(options.apiVersion, "2026-04");
    assert.ok(options.variables.ids.length <= 100);
    return Response.json({ data: { nodes: options.variables.ids.map((id) => inventoryNode(id, expected.get(id))).reverse() } });
  } }, input, "location");
  assert.equal(writes, 18);
  assert.equal(reads, 53);
  assert.equal(result.updatedRows, 4360);
  assert.equal(result.failedRows, 0);
  assert.equal(result.rowResults.length, 4360);
  assert.ok(result.rowResults.every((entry) => entry.success && /verified successfully/.test(entry.message)));
});

test("verification reports exact mismatches, missing items and missing location without replaying writes", async () => {
  let writes = 0;
  const result = await products.updateInventoryQuantities({ graphql: async (query) => {
    if (query.includes("mutation")) { writes++; return noAdjustment(); }
    return Response.json({ data: { nodes: [
      inventoryNode("inventory-0", 0), inventoryNode("inventory-1", 5), null,
      { id: "inventory-3", inventoryLevel: null }, inventoryNode("inventory-4", null),
    ] } });
  } }, Array.from({ length: 5 }, (_, i) => row(i)), "location");
  assert.equal(writes, 1);
  assert.equal(result.updatedRows, 1);
  assert.equal(result.failedRows, 4);
  assert.equal(result.rowResults[1].barcode, "001");
  assert.match(result.rowResults[1].message, /requested 30, but Shopify reports 5/);
  assert.match(result.rowResults[2].message, /not found/);
  assert.match(result.rowResults[3].message, /not stocked/);
  assert.match(result.rowResults[4].message, /did not return/);
});

test("verification failure preserves earlier confirmed rows and duplicate source rows", async () => {
  let reads = 0;
  const input = [...Array.from({ length: 101 }, (_, i) => row(i)), row(0)];
  const result = await products.updateInventoryQuantities({ graphql: async (query, options) => {
    if (query.includes("mutation")) return noAdjustment();
    if (++reads === 2) throw new Error("Read unavailable");
    return Response.json({ data: { nodes: options.variables.ids.map((id) => inventoryNode(id, input.find((entry) => entry.inventoryItemId === id).quantity)) } });
  } }, input, "location");
  assert.equal(result.updatedRows, 101);
  assert.equal(result.failedRows, 1);
  assert.equal(result.rowResults.length, 102);
  assert.equal(result.rowResults.filter((entry) => entry.inventoryItemId === "inventory-0" && entry.success).length, 2);
  assert.match(result.rowResults.find((entry) => !entry.success).message, /Read unavailable/);
});

test("verified unchanged stock still allows requested product statuses to update", async () => {
  const changed = [];
  const jobs = load("bulk-jobs.server.ts", {
    "../db.server": {}, "../shopify.server": {},
    "./bulk-products.server": {
      ...products,
      resolveStatusRowsProductIds: async (_admin, rows) => rows,
      getProductStockStates: async (_admin, ids) => new Map(ids.map((id) => [id, { quantity: 0, status: "ACTIVE" }])),
      updateProductStatuses: async (_admin, ids, status) => {
        changed.push(...ids.map((id) => ({ id, status })));
        return ids.map((productId) => ({ productId, success: true, message: `Status updated to ${status}.` }));
      },
    },
  }, "\nexport { runBulkJobIntent, summarizeJobResult };\n");
  const result = await jobs.runBulkJobIntent({ graphql: async (query) => {
    if (query.includes("mutation")) return noAdjustment();
    return Response.json({ data: { nodes: [inventoryNode("inventory-0", 0)] } });
  } }, "update-stock", { rows: [{ ...row(0), productStatus: "DRAFT" }], locationId: "location" }, async () => {});
  assert.equal(changed.length, 1);
  assert.equal(changed[0].status, "DRAFT");
  assert.equal(result.reportRows[0].status, "Success");
  assert.match(result.reportRows[0].message, /Stock verified successfully/);
  assert.match(result.reportRows[0].message, /Status updated to DRAFT/);
  assert.equal(jobs.summarizeJobResult(1, result).failedRows, 0);
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
      getProductStockStates: async (_admin, ids) => new Map(ids.map((id) => [id, { quantity: 0, status: "ACTIVE" }])),
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

test("blank stock cells are untouched, explicit zero is retained and source rows survive filtering", () => {
  const result = products.normalizeStockRows([
    { "Inventory item ID": "one", "Product ID": "p1", "New stock": "", Status: "" },
    { "Inventory item ID": "two", "Product ID": "p2", "New stock": "0", Status: "" },
    { "Inventory item ID": "three", "Product ID": "p3", "New stock": "", Status: "Draft" },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].quantity, 0);
  assert.equal(result[0].sourceRow, 3);
  assert.equal(result[1].quantity, undefined);
  assert.equal(result[1].productStatus, "DRAFT");
});

test("invalid stock and mistyped status stop validation with a row and barcode", () => {
  for (const value of ["bad", "1.5", "Infinity", "2147483648"]) {
    assert.throws(() => products.normalizeStockRows([{ Barcode: "001", "New stock": value }]), /Row 2, barcode 001/);
  }
  assert.throws(() => products.normalizeStockRows([{ Barcode: "001", Status: "Draf" }]), /Invalid status/);
});

test("conflicting inventory duplicates fail before writing while identical duplicates are sent once", async () => {
  const written = [];
  const result = await products.updateInventoryQuantities({ graphql: async (_query, options) => {
    written.push(...options.variables.input.quantities);
    return confirmed();
  } }, [row(1), { ...row(1), quantity: 7 }, row(2), row(2)], "location");
  assert.equal(written.length, 1);
  assert.equal(written[0].inventoryItemId, "inventory-2");
  assert.equal(result.failedRows, 2);
  assert.equal(result.updatedRows, 2);
});

test("barcode lookup requires one exact match", async () => {
  const lookup = (nodes) => products.findExistingVariantByBarcode({ graphql: async () =>
    Response.json({ data: { productVariants: { edges: nodes.map((node) => ({ node })) } } }),
  }, "001");
  assert.equal(await lookup([{ barcode: "0019" }]), undefined);
  await assert.rejects(lookup([{ barcode: "001" }, { barcode: "001" }]), /more than one/);
  assert.equal((await lookup([{ barcode: "001", id: "v1" }])).id, "v1");
});

test("price reports account for every requested variant and reject missing confirmations", async () => {
  const result = await products.updateVariantPrices({ graphql: async () => Response.json({ data: {
    productVariantsBulkUpdate: { productVariants: [{ id: "variant-1" }], userErrors: [] },
  } }) }, [ { ...row(1), sourceRow: 9, price: "20" }, { ...row(2), productId: "product-1", price: "30" } ]);
  assert.equal(result.summary.variants, 1);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.reportRows.length, 2);
  assert.equal(result.reportRows[0].row, 9);
  assert.equal(result.reportRows[0].status, "Success");
  assert.equal(result.reportRows[1].barcode, "002");
  assert.equal(result.reportRows[1].status, "Error");
});

test("clients for one store share rate budget; different stores are isolated", async () => {
  const start = delays.length;
  const response = () => Response.json({ data: {}, extensions: { cost: {
    requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 0, maximumAvailable: 1000, restoreRate: 50 },
  } } });
  const first = { graphql: async () => response() };
  const second = { graphql: async () => response() };
  const other = { graphql: async () => response() };
  requests.bindShopifyClient(first, "first.myshopify.com");
  requests.bindShopifyClient(second, "first.myshopify.com");
  requests.bindShopifyClient(other, "other.myshopify.com");
  await requests.shopifyRequest(first, "query budget");
  await requests.shopifyRequest(second, "query budget");
  await requests.shopifyRequest(other, "query budget");
  assert.deepEqual(delays.slice(start), [300]);
});

test("dashboard avoids catalog queries, paginates locations and skips counts for tool pages", async () => {
  const queries = [];
  const result = await products.getBulkManagerData({ graphql: async (query, options) => {
    queries.push(query);
    return Response.json({ data: { locations: {
      edges: [{ node: { id: options.variables.cursor ? "loc2" : "loc1", name: "Warehouse" } }],
      pageInfo: { hasNextPage: !options.variables.cursor, endCursor: "next" },
    } } });
  } }, false);
  assert.equal(result.locations.length, 2);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => !query.includes("products(first:")));
  assert.equal(result.productCount, undefined);
});

test("automatic status considers total inventory; explicit status wins and unchanged status skips a write", async () => {
  for (const [explicit, current, quantity, expected, writes] of [
    [undefined, "DRAFT", 30, "ACTIVE", 1],
    ["DRAFT", "ACTIVE", 30, "DRAFT", 1],
    [undefined, "ACTIVE", 30, "ACTIVE", 0],
  ]) {
    let calls = 0;
    const jobs = load("bulk-jobs.server.ts", {
      "../db.server": {}, "../shopify.server": {},
      "./bulk-products.server": {
        ...products,
        resolveStatusRowsProductIds: async (_admin, rows) => rows,
        getProductStockStates: async () => new Map([["product-1", { quantity, status: current }]]),
        updateProductStatuses: async (_admin, ids, status) => {
          calls += 1;
          assert.equal(status, expected);
          return ids.map((productId) => ({ productId, success: true, message: "Updated" }));
        },
      },
    }, "\nexport { runBulkJobIntent };\n");
    const result = await jobs.runBulkJobIntent({ graphql: async () => confirmed() }, "update-stock", {
      rows: [{ ...row(1), quantity: 0, productStatus: explicit }], locationId: "location",
    }, async () => {});
    assert.equal(calls, writes);
    assert.equal(result.reportRows[0].requestedStatus, expected);
    assert.equal(result.reportRows[0].status, "Success");
  }
});

test("atomic job claim permits only one worker to execute a queued import", async () => {
  let status = "queued";
  let mutations = 0;
  const snapshots = [];
  const db = { bulkJob: {
    findUnique: async () => ({ id: "job", status: "queued", shop: "store", intent: "update-prices", payload: { rows: [row(1)] }, totalRows: 1 }),
    updateMany: async () => {
      if (status !== "queued") return { count: 0 };
      status = "running";
      return { count: 1 };
    },
    update: async ({ data }) => { snapshots.push(data); return {}; },
  } };
  const jobs = load("bulk-jobs.server.ts", {
    "../db.server": { default: db },
    "../shopify.server": { unauthenticated: { admin: async () => ({ admin: {} }) } },
    "./bulk-products.server": { updateVariantPrices: async () => { mutations += 1; return { reportRows: [{ status: "Success" }] }; } },
  }, "\nexport { processBulkJob };\n");
  await Promise.all([jobs.processBulkJob("job"), jobs.processBulkJob("job")]);
  assert.equal(mutations, 1);
  assert.equal(snapshots.filter((value) => value.status === "completed").length, 1);
});

test("abandoned jobs are reported as interrupted rather than automatically replayed", async () => {
  let changes = 0;
  const db = { bulkJob: {
    findFirst: async () => ({ id: "job", status: "running", updatedAt: new Date(Date.now() - 20 * 60 * 1000) }),
    updateMany: async ({ data }) => { changes += 1; assert.equal(data.status, "failed"); return { count: 1 }; },
  } };
  const jobs = load("bulk-jobs.server.ts", {
    "../db.server": { default: db }, "../shopify.server": {}, "./bulk-products.server": {},
  });
  const result = await jobs.getBulkJob("store", "job");
  assert.equal(changes, 1);
  assert.match(result.error, /Some changes may have reached Shopify/);
});

test("downloaded result prefers per-row reports over batch summaries", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/app._index.tsx"), "utf8");
  const ast = ts.createSourceFile("route.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "getResultRows");
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(ast) + "\nexport { getResultRows };", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports });
  const result = exports.getResultRows({ intent: "update-prices", result: {
    rows: [{ productId: "p", updated: 1 }],
    reportRows: [{ row: 3, barcode: "001", status: "Success", message: "Updated" }, { row: 4, barcode: "002", status: "Error", message: "Invalid price" }],
  } });
  assert.equal(result.length, 2);
  assert.equal(result[1].Barcode, "002");
  assert.equal(result[1].Status, "Error");
  assert.equal(result[1].Message, "Invalid price");
});

test("conflicting product statuses are reported without an arbitrary status write", async () => {
  let calls = 0;
  const jobs = load("bulk-jobs.server.ts", {
    "../db.server": {}, "../shopify.server": {},
    "./bulk-products.server": {
      ...products,
      resolveStatusRowsProductIds: async (_admin, rows) => rows,
      getProductStockStates: async () => new Map([["product-1", { quantity: 30, status: "ACTIVE" }]]),
      updateProductStatuses: async () => { calls += 1; return []; },
    },
  }, "\nexport { runBulkJobIntent };\n");
  const result = await jobs.runBulkJobIntent({}, "update-stock", { rows: [
    { productId: "product-1", barcode: "001", productStatus: "DRAFT" },
    { productId: "product-1", barcode: "002", productStatus: "ACTIVE" },
  ] }, async () => {});
  assert.equal(calls, 0);
  assert.ok(result.reportRows.every((row) => row.status === "Error" && row.message.includes("Conflicting statuses")));
});
