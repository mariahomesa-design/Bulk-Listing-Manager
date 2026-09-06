const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

// Load server logic with external services mocked; no Shopify or database writes.
function load(file, mocks, extraExports = "") {
  const source = fs.readFileSync(path.join(__dirname, "../app/models", file), "utf8");
  const code = ts.transpileModule(source + extraExports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, console, Error, setTimeout, clearTimeout,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "node:crypto") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

const products = load("bulk-products.server.ts", {
  "@shopify/shopify-app-react-router/server": { ApiVersion: { April26: "2026-04" } },
  "./bulk-spreadsheets.server": { shopifyCategoryOptions: [] },
});
const row = (i) => ({
  productId: `product-${i}`, variantId: `variant-${i}`,
  inventoryItemId: `inventory-${i}`, barcode: `00${i}`, quantity: i % 2 ? 30 : 0,
});
const confirmed = () => ({ json: async () => ({ data: {
  inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: "2026-09-06" }, userErrors: [] },
} }) });

test("4360 rows use compatible API, bounded batches and distinct retry keys", async () => {
  const keys = new Set();
  const sizes = [];
  const result = await products.updateInventoryQuantities({ graphql: async (query, options) => {
    assert.equal(options.apiVersion, "2026-04");
    assert.match(query, /@idempotent\(key: \$idempotencyKey\)/);
    assert.equal(options.tries, 3);
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
    const result = await products.updateInventoryQuantities({ graphql: async () => ({ json: async () => ({ data }) }) }, [row(1)], "location");
    assert.equal(result.updatedRows, 0);
    assert.equal(result.failedRows, 1);
    assert.ok(result.rowResults[0].message.length > 0);
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
