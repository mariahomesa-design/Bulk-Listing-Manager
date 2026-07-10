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
  publish?: boolean;
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

type CreateProductReportRow = {
  row: number;
  title: string;
  sku: string;
  barcode: string;
  status: "Success" | "Error" | "Warning";
  message: string;
  productId: string;
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

export type ProductActionRow = {
  productId: string;
  action?: "ACTIVE" | "DRAFT" | "ARCHIVED" | "DELETE";
};

export const BULK_DELETE_TEMPLATE_HEADERS = [
  "Barcode",
  "Current stock",
  "Current status",
  "Action",
  "Product ID",
];

export const PRICE_TEMPLATE_HEADERS = [
  "Barcode",
  "Current price",
  "Current compare price",
  "New price",
  "New compare price",
  "Variant ID",
  "Product ID",
];

export const STOCK_TEMPLATE_HEADERS = [
  "Product title",
  "Variant title",
  "SKU",
  "Barcode",
  "Current stock",
  "New stock",
  "Current status",
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

function decimalStringValue(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal value "${value}". Use numbers like 10 or 10.50.`);
  }

  return normalized;
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

function productActionValue(
  value: string,
): ProductActionRow["action"] | undefined {
  const normalized = value.trim().toUpperCase();

  if (["DELETE", "DELET"].includes(normalized)) {
    return "DELETE";
  }

  if (["ACTIVE", "DRAFT", "ARCHIVED", "UNLIST", "UNLISTED"].includes(normalized)) {
    return statusValue(normalized);
  }

  return undefined;
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
        publish: booleanValue(
          rowValue(raw, ["Publish", "Published on online store"]),
        ),
        status: statusValue(rowValue(raw, ["Status"])),
        price: decimalStringValue(rowValue(raw, ["Price"])),
        compareAtPrice: decimalStringValue(rowValue(raw, ["Compare-at price"])),
        cost: decimalStringValue(rowValue(raw, ["Cost per item"])),
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

export function normalizePriceRows(
  rows: (VariantUpdateRow | Record<string, unknown>)[],
): VariantUpdateRow[] {
  return rows
    .map((row) => {
      const raw = row as Record<string, unknown>;

      if (raw.productId && raw.variantId) {
        return row as VariantUpdateRow;
      }

      return {
        productId: rowValue(raw, ["Product ID", "productId"]),
        variantId: rowValue(raw, ["Variant ID", "variantId"]),
        sku: rowValue(raw, ["SKU", "sku"]),
        barcode: rowValue(raw, ["Barcode", "barcode"]),
        price: decimalStringValue(rowValue(raw, ["New price", "price"])),
        compareAtPrice: decimalStringValue(
          rowValue(raw, ["New compare price", "compareAtPrice"]),
        ),
      };
    })
    .filter((row) => row.productId && row.variantId && (row.price || row.compareAtPrice));
}

export function normalizeProductActionRows(
  rows: (ProductActionRow | Record<string, unknown>)[],
): ProductActionRow[] {
  return rows
    .map((row) => {
      const raw = row as Record<string, unknown>;

      if (raw.productId && raw.action) {
        return row as ProductActionRow;
      }

      return {
        productId: rowValue(raw, ["Product ID", "productId"]),
        action: productActionValue(rowValue(raw, ["Action", "Status", "status"])),
      };
    })
    .filter((row) => row.productId && row.action);
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

const PRICE_TEMPLATE_QUERY = `#graphql
  query BulkListingPriceTemplate($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          barcode
          price
          compareAtPrice
          product {
            id
          }
        }
      }
    }
  }
`;

export async function getPriceTemplateRows(admin: GraphqlClient) {
  const rows: Record<string, string>[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PRICE_TEMPLATE_QUERY, {
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
        Barcode: variant.barcode || "",
        "Current price": variant.price || "",
        "Current compare price": variant.compareAtPrice || "",
        "New price": "",
        "New compare price": "",
        "Variant ID": variant.id || "",
        "Product ID": variant.product?.id || "",
      });
    }

    hasNextPage = Boolean(variants?.pageInfo?.hasNextPage);
    cursor = variants?.pageInfo?.endCursor || null;
  }

  return rows;
}

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
        "Current status":
          variant.product?.status === "ACTIVE"
            ? "Active"
            : variant.product?.status === "ARCHIVED"
              ? "Unlist"
              : "Draft",
        Status: "",
        "Inventory item ID": variant.inventoryItem?.id || "",
        "Product ID": variant.product?.id || "",
      });
    }

    hasNextPage = Boolean(variants?.pageInfo?.hasNextPage);
    cursor = variants?.pageInfo?.endCursor || null;
  }

  return rows;
}

const BULK_DELETE_TEMPLATE_QUERY = `#graphql
  query BulkListingProductActionTemplate($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          status
          variants(first: 1) {
            edges {
              node {
                barcode
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`;

export async function getBulkDeleteTemplateRows(admin: GraphqlClient) {
  const rows: Record<string, string>[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(BULK_DELETE_TEMPLATE_QUERY, {
      variables: { cursor },
    });
    const json = await response.json();

    if (json.errors) {
      throw new Error(JSON.stringify(json.errors));
    }

    const products = json.data?.products;

    for (const edge of products?.edges || []) {
      const product = edge.node;
      const variant = product.variants?.edges?.[0]?.node;

      rows.push({
        Barcode: variant?.barcode || "",
        "Current stock": variant?.inventoryQuantity ?? "",
        "Current status":
          product.status === "ACTIVE"
            ? "Active"
            : product.status === "ARCHIVED"
              ? "Unlist"
              : "Draft",
        Action: "",
        "Product ID": product.id || "",
      });
    }

    hasNextPage = Boolean(products?.pageInfo?.hasNextPage);
    cursor = products?.pageInfo?.endCursor || null;
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

const STORE_COUNT_QUERY = `#graphql
  query ProductBulkManagerCounts {
    productsCount {
      count
    }
    collectionsCount {
      count
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

  let counts: { productCount?: number; collectionCount?: number } = {};

  try {
    const countResponse = await admin.graphql(STORE_COUNT_QUERY);
    const countJson = await countResponse.json();

    if (!countJson.errors?.length) {
      counts = {
        productCount: countJson.data?.productsCount?.count,
        collectionCount: countJson.data?.collectionsCount?.count,
      };
    }
  } catch {
    counts = {};
  }

  return {
    products: json.data?.products?.edges.map((edge: any) => edge.node) || [],
    productCount: counts.productCount,
    collections:
      json.data?.collections?.edges.map((edge: any) => edge.node) || [],
    collectionCount: counts.collectionCount,
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

async function getPublicationIds(admin: GraphqlClient) {
  const publicationIds: string[] = [];
  let cursor: string | null = null;

  do {
    const response = await admin.graphql(
      `#graphql
        query BulkListingPublications($cursor: String) {
          publications(first: 250, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
              }
            }
          }
        }`,
      { variables: { cursor } },
    );
    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(json.errors.map((error: { message: string }) => error.message).join(", "));
    }

    publicationIds.push(
      ...(json.data?.publications?.edges || []).map(
        (edge: { node: { id: string } }) => edge.node.id,
      ),
    );
    cursor = json.data?.publications?.pageInfo?.hasNextPage
      ? json.data.publications.pageInfo.endCursor
      : null;
  } while (cursor);

  return publicationIds;
}

async function publishProductToPublications(
  admin: GraphqlClient,
  productId: string,
  publicationIds: string[],
) {
  if (!publicationIds.length) {
    return;
  }

  const response = await admin.graphql(
    `#graphql
      mutation BulkListingPublishProduct(
        $id: ID!
        $input: [PublicationInput!]!
      ) {
        publishablePublish(id: $id, input: $input) {
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        id: productId,
        input: publicationIds.map((publicationId) => ({ publicationId })),
      },
    },
  );
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors.map((error: { message: string }) => error.message).join(", "));
  }

  const errors = json.data?.publishablePublish?.userErrors || [];

  if (errors.length) {
    throw new Error(
      errors.map((error: { message: string }) => error.message).join(", "),
    );
  }
}

function barcodeSearchQuery(barcode: string) {
  return `barcode:"${barcode.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function findExistingVariantByBarcode(
  admin: GraphqlClient,
  barcode: string,
) {
  const response = await admin.graphql(
    `#graphql
      query BulkListingFindBarcode($query: String!) {
        productVariants(first: 1, query: $query) {
          edges {
            node {
              id
              barcode
              product {
                id
                title
              }
            }
          }
        }
      }`,
    { variables: { query: barcodeSearchQuery(barcode) } },
  );
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors.map((error: { message: string }) => error.message).join(", "));
  }

  return json.data?.productVariants?.edges?.[0]?.node;
}

async function getExistingBarcodes(
  admin: GraphqlClient,
  rows: ProductRow[],
) {
  const barcodes = Array.from(
    new Set(rows.map((row) => row.barcode?.trim()).filter(Boolean)),
  ) as string[];
  const existing = new Map<string, { productId: string; title: string }>();

  for (const barcode of barcodes) {
    const variant = await findExistingVariantByBarcode(admin, barcode);

    if (variant?.barcode === barcode) {
      existing.set(barcode, {
        productId: variant.product?.id || "",
        title: variant.product?.title || "",
      });
    }
  }

  return existing;
}

function duplicateUploadedBarcodes(rows: ProductRow[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const barcode = row.barcode?.trim();

    if (barcode) {
      counts.set(barcode, (counts.get(barcode) || 0) + 1);
    }
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([barcode]) => barcode),
  );
}

export async function createProducts(
  admin: GraphqlClient,
  rows: ProductRow[],
  locationId: string,
) {
  const created = [];
  const reportRows: CreateProductReportRow[] = [];
  const existingBarcodes = await getExistingBarcodes(admin, rows);
  const duplicateBarcodes = duplicateUploadedBarcodes(rows);
  let publicationIds: string[] | undefined;

  for (const [index, row] of rows.entries()) {
    const reportBase = {
      row: index + 2,
      title: row.title,
      sku: row.sku || "",
      barcode: row.barcode || "",
    };
    const existingBarcode = row.barcode
      ? existingBarcodes.get(row.barcode.trim())
      : undefined;

    if (row.barcode && duplicateBarcodes.has(row.barcode.trim())) {
      reportRows.push({
        ...reportBase,
        status: "Error",
        message: "Barcode is duplicated in the uploaded file.",
        productId: "",
      });
      continue;
    }

    if (existingBarcode) {
      reportRows.push({
        ...reportBase,
        status: "Error",
        message: `Barcode already exists on product "${existingBarcode.title}".`,
        productId: existingBarcode.productId,
      });
      continue;
    }

    const status = row.publish ? "ACTIVE" : row.status || "DRAFT";
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
            status,
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
      reportRows.push({
        ...reportBase,
        status: "Error",
        message: errors.map((error: { message: string }) => error.message).join("; "),
        productId: "",
      });
      continue;
    }

    const product = json.data.productCreate.product;
    const variant = product.variants.edges[0]?.node;

    try {
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

      if (row.publish) {
        publicationIds = publicationIds || (await getPublicationIds(admin));
        await publishProductToPublications(admin, product.id, publicationIds);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Product was created, but a follow-up update failed.";
      created.push({
        ...product,
        warning: message,
      });
      reportRows.push({
        ...reportBase,
        status: "Warning",
        message: `Product created, but follow-up update failed: ${message}`,
        productId: product.id,
      });
      continue;
    }

    created.push(product);
    reportRows.push({
      ...reportBase,
      status: "Success",
      message: "Product created successfully.",
      productId: product.id,
    });
  }

  return {
    created,
    summary: {
      total: reportRows.length,
      success: reportRows.filter((row) => row.status === "Success").length,
      warning: reportRows.filter((row) => row.status === "Warning").length,
      error: reportRows.filter((row) => row.status === "Error").length,
    },
    reportRows,
  };
}

export async function updateProductStatuses(
  admin: GraphqlClient,
  productIds: string[],
  status: "ACTIVE" | "DRAFT" | "ARCHIVED",
) {
  return mapWithConcurrency(Array.from(new Set(productIds)), 6, async (id) => {
    try {
      const response = await admin.graphql(
        `#graphql
          mutation BulkListingProductStatus($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              product {
                id
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

      if (json.errors?.length) {
        return {
          productId: id,
          action: status,
          success: false,
          message: json.errors.map((error: any) => error.message).join("; "),
        };
      }

      const result = json.data?.productUpdate;
      const userErrors = result?.userErrors || [];

      if (userErrors.length) {
        return {
          productId: id,
          action: status,
          success: false,
          message: userErrors.map((error: any) => error.message).join("; "),
        };
      }

      return {
        productId: id,
        action: status,
        success: true,
        message: "Status updated.",
      };
    } catch (error) {
      return {
        productId: id,
        action: status,
        success: false,
        message: error instanceof Error ? error.message : "Status update failed.",
      };
    }
  });
}

export async function deleteProducts(admin: GraphqlClient, productIds: string[]) {
  return mapWithConcurrency(Array.from(new Set(productIds)), 4, async (id) => {
    try {
      const response = await admin.graphql(
        `#graphql
          mutation BulkListingProductDelete($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
              userErrors {
                field
                message
              }
            }
          }`,
        { variables: { input: { id } } },
      );
      const json = await response.json();

      if (json.errors?.length) {
        return {
          productId: id,
          action: "DELETE",
          success: false,
          message: json.errors.map((error: any) => error.message).join("; "),
        };
      }

      const result = json.data?.productDelete;
      const userErrors = result?.userErrors || [];

      if (userErrors.length) {
        return {
          productId: id,
          action: "DELETE",
          success: false,
          message: userErrors.map((error: any) => error.message).join("; "),
        };
      }

      return {
        productId: result?.deletedProductId || id,
        action: "DELETE",
        success: true,
        message: "Product deleted.",
      };
    } catch (error) {
      return {
        productId: id,
        action: "DELETE",
        success: false,
        message: error instanceof Error ? error.message : "Delete failed.",
      };
    }
  });
}

export async function applyProductActions(
  admin: GraphqlClient,
  rows: ProductActionRow[],
) {
  const statusGroups: Record<"ACTIVE" | "DRAFT" | "ARCHIVED", string[]> = {
    ACTIVE: [],
    DRAFT: [],
    ARCHIVED: [],
  };
  const deleteIds: string[] = [];

  for (const row of rows) {
    if (row.action === "DELETE") {
      deleteIds.push(row.productId);
      continue;
    }

    if (row.action) {
      statusGroups[row.action].push(row.productId);
    }
  }

  const statuses = [];

  for (const [status, productIds] of Object.entries(statusGroups)) {
    const uniqueProductIds = Array.from(new Set(productIds));

    if (uniqueProductIds.length > 0) {
      statuses.push(
        await updateProductStatuses(
          admin,
          uniqueProductIds,
          status as "ACTIVE" | "DRAFT" | "ARCHIVED",
        ),
      );
    }
  }

  const deleted = await deleteProducts(admin, Array.from(new Set(deleteIds)));
  const statusRows = statuses.flat();
  const allRows = [...statusRows, ...deleted];

  return {
    summary: {
      total: allRows.length,
      success: allRows.filter((row) => row.success).length,
      error: allRows.filter((row) => !row.success).length,
    },
    rows: allRows,
  };
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

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );

  return results;
}

export async function updateVariantPrices(
  admin: GraphqlClient,
  rows: VariantUpdateRow[],
) {
  if (!rows.length) {
    throw new Error("Add values in New price or New compare price before uploading.");
  }

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
    for (const chunk of chunkArray(variants, 100)) {
      const response = await admin.graphql(
        `#graphql
          mutation BulkListingVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
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
            variants: chunk.map((variant) => {
              const inventoryItem = compactObject({
                sku: variant.sku,
                cost: decimalStringValue(String(variant.cost || "")),
                tracked: variant.tracked,
              });

              return compactObject({
                id: variant.variantId,
                price: decimalStringValue(String(variant.price || "")),
                compareAtPrice: decimalStringValue(
                  String(variant.compareAtPrice || ""),
                ),
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

      if (json.errors) {
        throw new Error(JSON.stringify(json.errors));
      }

      const result = json.data?.productVariantsBulkUpdate;
      const userErrors = result?.userErrors || [];

      if (userErrors.length) {
        throw new Error(
          userErrors.map((error: any) => error.message).join("; "),
        );
      }

      updated.push({
        productId,
        updated: result?.productVariants?.length || chunk.length,
      });
    }
  }

  return {
    summary: {
      products: updated.length,
      variants: updated.reduce((count, row) => count + row.updated, 0),
    },
    rows: updated,
  };
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
