import {
  shopifyCategoryOptions,
  type ShopifyProductCategory,
} from "./bulk-spreadsheets.server";

type GraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ProductRow = {
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  category?: string;
  productType?: string;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  price?: string;
  compareAtPrice?: string;
  cost?: string;
  sku?: string;
  barcode?: string;
  taxable?: boolean;
  tracked?: boolean;
  inventoryPolicy?: "CONTINUE" | "DENY";
  quantity?: number;
  option1Name?: string;
  option1Value?: string;
  option2Name?: string;
  option2Value?: string;
  imageLinks?: string[];
};

export type VariantUpdateRow = {
  productId: string;
  variantId: string;
  price?: string;
  compareAtPrice?: string;
  cost?: string;
  sku?: string;
  barcode?: string;
  taxable?: boolean;
  tracked?: boolean;
  inventoryPolicy?: "CONTINUE" | "DENY";
  inventoryItemId?: string;
  quantity?: number;
  productStatus?: "ACTIVE" | "DRAFT" | "ARCHIVED";
};

export const STOCK_TEMPLATE_HEADERS = [
  "Product title",
  "Variant title",
  "SKU",
  "Barcode",
  "Current stock",
  "New stock",
  "Status",
  "Inventory item ID",
  "Product ID",
];

function rowValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function booleanValue(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();

  if (["true", "yes", "y", "1"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "n", "0"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function numberValue(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function statusValue(value: string): "ACTIVE" | "DRAFT" | "ARCHIVED" {
  const normalized = value.trim().toUpperCase();

  if (normalized === "ACTIVE") {
    return "ACTIVE";
  }

  if (["ARCHIVED", "UNLIST", "UNLISTED"].includes(normalized)) {
    return "ARCHIVED";
  }

  if (normalized === "DRAFT") {
    return normalized;
  }

  return "DRAFT";
}

function optionalStatusValue(
  value: string,
): "ACTIVE" | "DRAFT" | "ARCHIVED" | undefined {
  return value.trim() ? statusValue(value) : undefined;
}

const categoryByLabel = new Map<string, ShopifyProductCategory>(
  shopifyCategoryOptions.map((category) => [category.label, category]),
);
const categoryById = new Map<string, ShopifyProductCategory>(
  shopifyCategoryOptions.map((category) => [category.id, category]),
);

function categoryIdValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (categoryById.has(trimmed)) {
    return trimmed;
  }

  return categoryByLabel.get(trimmed)?.id;
}

export function normalizeProductRows(
  rows: (ProductRow | Record<string, unknown>)[],
): ProductRow[] {
  return rows
    .map((row) => {
      const raw = row as Record<string, unknown>;

      if (raw.title) {
        return row as ProductRow;
      }

      const imageLinks = Array.from({ length: 7 }, (_, index) =>
        rowValue(raw, [`Image Link ${index + 1}`]),
      ).filter(Boolean);
      const continueSelling = booleanValue(
        rowValue(raw, ["Continue selling when out of stock"]),
      );
      const inventoryPolicy: ProductRow["inventoryPolicy"] =
        continueSelling === undefined
          ? undefined
          : continueSelling
            ? "CONTINUE"
            : "DENY";
      const inventoryTracker = rowValue(raw, ["Inventory tracker"]);

      return {
        title: rowValue(raw, ["Title"]),
        descriptionHtml: rowValue(raw, ["Description"]),
        vendor: rowValue(raw, ["Vendor"]),
        category: categoryIdValue(rowValue(raw, ["Product category"])),
        status: statusValue(rowValue(raw, ["Status"])),
        price: rowValue(raw, ["Price"]),
        compareAtPrice: rowValue(raw, ["Compare-at price"]),
        cost: rowValue(raw, ["Cost per item"]),
        sku: rowValue(raw, ["SKU"]),
        barcode: rowValue(raw, ["Barcode"]),
        taxable: booleanValue(rowValue(raw, ["Charge tax"])),
        tracked: inventoryTracker
          ? inventoryTracker.toLowerCase() === "shopify"
          : undefined,
        inventoryPolicy,
        quantity: numberValue(rowValue(raw, ["Inventory quantity"])),
        option1Name: rowValue(raw, ["Option1 name"]),
        option1Value: rowValue(raw, ["Option1 value"]),
        option2Name: rowValue(raw, ["Option2 name"]),
        option2Value: rowValue(raw, ["Option2 value"]),
        imageLinks,
      };
    })
    .filter((row) => row.title);
}

export function normalizeStockRows(
  rows: (VariantUpdateRow | Record<string, unknown>)[],
): VariantUpdateRow[] {
  return rows
    .map((row) => {
      const raw = row as Record<string, unknown>;

      if (raw.inventoryItemId && raw.quantity !== undefined) {
        return row as VariantUpdateRow;
      }

      return {
        productId: rowValue(raw, ["Product ID", "productId"]),
        variantId: rowValue(raw, ["variantId"]),
        inventoryItemId: rowValue(raw, ["Inventory item ID", "inventoryItemId"]),
        sku: rowValue(raw, ["SKU", "sku"]),
        barcode: rowValue(raw, ["Barcode", "barcode"]),
        quantity: numberValue(rowValue(raw, ["New stock", "Stock", "quantity"])),
        productStatus: optionalStatusValue(rowValue(raw, ["Status", "status"])),
      };
    })
    .filter((row) => row.inventoryItemId && row.quantity !== undefined);
}

const STOCK_TEMPLATE_QUERY = `#graphql
  query BulkListingStockTemplate($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          sku
          barcode
          inventoryQuantity
          product {
            id
            title
            status
          }
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

export async function getStockTemplateRows(admin: GraphqlClient) {
  const rows: Record<string, string | number>[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(STOCK_TEMPLATE_QUERY, {
      variables: { cursor },
    });
    const json = await response.json();

    if (json.errors) {
      throw new Error(JSON.stringify(json.errors));
    }

    const variants = json.data?.productVariants;

    for (const edge of variants?.edges || []) {
      const variant = edge.node;

      rows.push({
        "Product title": variant.product?.title || "",
        "Variant title": variant.title || "",
        SKU: variant.sku || "",
        Barcode: variant.barcode || "",
        "Current stock": variant.inventoryQuantity ?? "",
        "New stock": "",
        Status:
          variant.product?.status === "ACTIVE"
            ? "Active"
            : variant.product?.status === "ARCHIVED"
              ? "Unlist"
              : "Draft",
        "Inventory item ID": variant.inventoryItem?.id || "",
        "Product ID": variant.product?.id || "",
      });
    }

    hasNextPage = Boolean(variants?.pageInfo?.hasNextPage);
    cursor = variants?.pageInfo?.endCursor || null;
  }

  return rows;
}

const PRODUCT_LIST_QUERY = `#graphql
  query ProductBulkManagerProducts {
    products(first: 25, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          status
          vendor
          totalInventory
          collections(first: 5) {
            edges {
              node {
                id
                title
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                inventoryQuantity
                inventoryItem {
                  id
                }
              }
            }
          }
        }
      }
    }
    collections(first: 50, sortKey: TITLE) {
      edges {
        node {
          id
          title
        }
      }
    }
    locations(first: 10) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

export async function getBulkManagerData(admin: GraphqlClient) {
  const response = await admin.graphql(PRODUCT_LIST_QUERY);
  const json = await response.json();

  if (json.errors) {
    const accessErrors = json.errors.filter((error: any) =>
      String(error.message || "").includes("Access denied"),
    );

    if (accessErrors.length !== json.errors.length) {
      throw new Error(JSON.stringify(json.errors));
    }
  }

  return {
    products: json.data?.products?.edges.map((edge: any) => edge.node) || [],
    collections:
      json.data?.collections?.edges.map((edge: any) => edge.node) || [],
    locations: json.data?.locations?.edges.map((edge: any) => edge.node) || [],
  };
}

export function parseJsonRows<T>(value: FormDataEntryValue | null): T[] {
  if (!value || typeof value !== "string") {
    return [];
  }

  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    throw new Error("Bulk input must be a JSON array.");
  }

  return parsed;
}

export async function createProducts(
  admin: GraphqlClient,
  rows: ProductRow[],
  locationId: string,
) {
  const created = [];

  for (const row of rows) {
    const productOptions = [
      row.option1Name && row.option1Value
        ? { name: row.option1Name, values: [{ name: row.option1Value }] }
        : undefined,
      row.option2Name && row.option2Value
        ? { name: row.option2Name, values: [{ name: row.option2Value }] }
        : undefined,
    ].filter(Boolean);
    const media = (row.imageLinks || []).map((url) => ({
      mediaContentType: "IMAGE",
      originalSource: url,
    }));
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
          productCreate(product: $product, media: $media) {
            product {
              id
              title
              status
              variants(first: 1) {
                edges {
                  node {
                    id
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          product: {
            title: row.title,
            descriptionHtml: row.descriptionHtml || undefined,
            vendor: row.vendor || undefined,
            category: row.category || undefined,
            productType: row.productType || undefined,
            status: row.status || "DRAFT",
            productOptions: productOptions.length ? productOptions : undefined,
          },
          media: media.length ? media : undefined,
        },
      },
    );
    const json = await response.json();
    const errors = json.data?.productCreate?.userErrors || [];

    if (errors.length) {
      created.push({ title: row.title, errors });
      continue;
    }

    const product = json.data.productCreate.product;
    const variant = product.variants.edges[0]?.node;

    if (
      variant &&
      (row.price ||
        row.sku ||
        row.compareAtPrice ||
        row.cost ||
        row.barcode ||
        row.taxable !== undefined ||
        row.tracked !== undefined ||
        row.inventoryPolicy)
    ) {
      await updateVariantPrices(admin, [
        {
          productId: product.id,
          variantId: variant.id,
          price: row.price,
          compareAtPrice: row.compareAtPrice,
          cost: row.cost,
          sku: row.sku,
          barcode: row.barcode,
          taxable: row.taxable,
          inventoryPolicy: row.inventoryPolicy,
          tracked: row.tracked ?? row.quantity !== undefined,
        },
      ]);
    }

    if (
      variant?.inventoryItem?.id &&
      locationId &&
      row.quantity !== undefined
    ) {
      await updateInventoryQuantities(
        admin,
        [
          {
            productId: product.id,
            variantId: variant.id,
            inventoryItemId: variant.inventoryItem.id,
            quantity: row.quantity,
          },
        ],
        locationId,
      );
    }

    created.push(product);
  }

  return created;
}

export async function updateProductStatuses(
  admin: GraphqlClient,
  productIds: string[],
  status: "ACTIVE" | "DRAFT" | "ARCHIVED",
) {
  const updated = [];

  for (const id of productIds) {
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingProductStatus($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              status
            }
            userErrors {
              field
              message
            }
          }
        }`,
      { variables: { product: { id, status } } },
    );
    const json = await response.json();
    updated.push(json.data?.productUpdate);
  }

  return updated;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

export async function updateVariantPrices(
  admin: GraphqlClient,
  rows: VariantUpdateRow[],
) {
  const byProduct = rows.reduce<Record<string, VariantUpdateRow[]>>(
    (groups, row) => {
      groups[row.productId] ||= [];
      groups[row.productId].push(row);
      return groups;
    },
    {},
  );
  const updated = [];

  for (const [productId, variants] of Object.entries(byProduct)) {
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
              price
              sku
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          productId,
          variants: variants.map((variant) => {
            const inventoryItem = compactObject({
              sku: variant.sku,
              cost: variant.cost,
              tracked: variant.tracked,
            });

            return compactObject({
              id: variant.variantId,
              price: variant.price,
              compareAtPrice: variant.compareAtPrice,
              barcode: variant.barcode,
              taxable: variant.taxable,
              inventoryPolicy: variant.inventoryPolicy,
              inventoryItem:
                Object.keys(inventoryItem).length > 0
                  ? inventoryItem
                  : undefined,
            });
          }),
        },
      },
    );
    const json = await response.json();
    updated.push(json.data?.productVariantsBulkUpdate);
  }

  return updated;
}

export async function updateInventoryQuantities(
  admin: GraphqlClient,
  rows: VariantUpdateRow[],
  locationId: string,
) {
  if (!locationId) {
    throw new Error("Choose an inventory location before updating stock.");
  }

  if (!rows.some((row) => row.inventoryItemId && row.quantity !== undefined)) {
    throw new Error("Add stock values in the New stock column before uploading.");
  }

  const quantities = rows
    .filter((row) => row.inventoryItemId && row.quantity !== undefined)
    .map((row) => ({
      inventoryItemId: row.inventoryItemId,
      locationId,
      quantity: row.quantity,
      compareQuantity: null,
    }));

  const results = [];
  const mutation = `#graphql
    mutation BulkListingInventory($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          createdAt
          reason
          changes {
            name
            delta
            quantityAfterChange
          }
        }
        userErrors {
          code
          field
          message
        }
      }
    }`;

  for (const [index, quantityChunk] of chunkArray(quantities, 250).entries()) {
    const response = await admin.graphql(mutation, {
      variables: {
        input: {
          ignoreCompareQuantity: true,
          name: "available",
          reason: "correction",
          referenceDocumentUri: `bulk-listing-manager://stock-update/${Date.now()}-${index + 1}`,
          quantities: quantityChunk,
        },
      },
    });

    const json = await response.json();

    if (json.errors) {
      throw new Error(JSON.stringify(json.errors));
    }

    const result = json.data?.inventorySetQuantities;
    const userErrors = result?.userErrors || [];

    if (userErrors.length) {
      throw new Error(
        userErrors.map((error: any) => error.message).join("; "),
      );
    }

    results.push(result);
  }

  return {
    batches: results.length,
    results,
    updatedRows: quantities.length,
  };
}

export async function addProductsToCollection(
  admin: GraphqlClient,
  collectionId: string,
  productIds: string[],
) {
  const response = await admin.graphql(
    `#graphql
      mutation BulkListingCollectionAdd($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id: collectionId, productIds } },
  );

  const json = await response.json();
  return json.data?.collectionAddProducts;
}
