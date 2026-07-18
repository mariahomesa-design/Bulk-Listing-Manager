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
  barcode?: string;
  action?: "ACTIVE" | "DRAFT" | "ARCHIVED" | "DELETE";
};

export type ProductImageRow = {
  barcode: string;
  productId?: string;
  imageUrls: string[];
};

export type VariationRow = {
  parentSku: string;
  barcode: string;
  option1Name?: string;
  option1Value?: string;
  option2Name?: string;
  option2Value?: string;
};

export const VARIATION_TEMPLATE_HEADERS = [
  "Parent SKU",
  "Barcode",
  "Option 1 Name",
  "Option 1 Value",
  "Option 2 Name",
  "Option 2 Value",
];

export const BULK_DELETE_TEMPLATE_HEADERS = [
  "Barcode",
  "Current stock",
  "Current status",
  "Action",
  "Product ID",
];

export const IMAGE_TEMPLATE_HEADERS = [
  "Barcode",
  ...Array.from({ length: 7 }, (_, index) => `Existing image ${index + 1}`),
  ...Array.from({ length: 7 }, (_, index) => `New image ${index + 1}`),
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

function errorMessage(error: unknown, fallback = "Bulk action failed.") {
  return error instanceof Error ? error.message : fallback;
}

function graphqlErrorMessage(errors: { message?: string }[] | undefined) {
  return (errors || [])
    .map((error) => error.message || "Shopify returned an error.")
    .join("; ");
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
    .filter(
      (row) =>
        (row.inventoryItemId && row.quantity !== undefined) ||
        Boolean(row.productStatus && (row.productId || row.barcode)),
    );
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
        barcode: rowValue(raw, ["Barcode", "barcode"]),
        action: productActionValue(rowValue(raw, ["Action", "Status", "status"])),
      };
    })
    .filter((row) => (row.productId || row.barcode) && row.action);
}

export function normalizeImageRows(
  rows: (ProductImageRow | Record<string, unknown>)[],
): ProductImageRow[] {
  return rows
    .map((row) => {
      const raw = row as Record<string, unknown>;

      if (Array.isArray(raw.imageUrls)) {
        return row as ProductImageRow;
      }

      const imageUrls = Array.from({ length: 7 }, (_, index) =>
        rowValue(raw, [`New image ${index + 1}`, `Image Link ${index + 1}`]),
      ).filter(Boolean);

      return {
        barcode: rowValue(raw, ["Barcode", "barcode"]),
        productId: rowValue(raw, ["Product ID", "productId"]),
        imageUrls,
      };
    })
    .filter((row) => row.barcode && row.imageUrls.length > 0);
}

export function normalizeVariationRows(
  rows: (VariationRow | Record<string, unknown>)[],
): VariationRow[] {
  return rows
    .map((row) => {
      const raw = row as Record<string, unknown>;

      return {
        parentSku: rowValue(raw, ["Parent SKU", "Parent Sku", "parentSku"]),
        barcode: rowValue(raw, ["Barcode", "barcode"]),
        option1Name:
          rowValue(raw, ["Option 1 Name", "Option1 Name", "option1Name"]) ||
          (rowValue(raw, ["Color", "color"]) ? "Color" : ""),
        option1Value:
          rowValue(raw, ["Option 1 Value", "Option1 Value", "option1Value"]) ||
          rowValue(raw, ["Color", "color"]),
        option2Name:
          rowValue(raw, ["Option 2 Name", "Option2 Name", "option2Name"]) ||
          (rowValue(raw, ["Size", "size"]) ? "Size" : ""),
        option2Value:
          rowValue(raw, ["Option 2 Value", "Option2 Value", "option2Value"]) ||
          rowValue(raw, ["Size", "size"]),
      };
    })
    .filter((row) => row.parentSku && row.barcode);
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

const IMAGE_TEMPLATE_QUERY = `#graphql
  query BulkListingImageTemplate($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          barcode
          product {
            id
            media(first: 50) {
              edges {
                node {
                  id
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function getImageTemplateRows(admin: GraphqlClient) {
  const rows: Record<string, string>[] = [];
  const seenProductBarcodes = new Set<string>();
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(IMAGE_TEMPLATE_QUERY, {
      variables: { cursor },
    });
    const json = await response.json();

    if (json.errors) {
      throw new Error(JSON.stringify(json.errors));
    }

    const variants = json.data?.productVariants;

    for (const edge of variants?.edges || []) {
      const variant = edge.node;
      const barcode = variant.barcode || "";
      const productId = variant.product?.id || "";
      const dedupeKey = `${productId}:${barcode}`;

      if (!barcode || seenProductBarcodes.has(dedupeKey)) {
        continue;
      }

      seenProductBarcodes.add(dedupeKey);

      const imageUrls = (variant.product?.media?.edges || [])
        .map((mediaEdge: any) => mediaEdge.node?.image?.url || "")
        .filter(Boolean);
      const row: Record<string, string> = {
        Barcode: barcode,
        "Product ID": productId,
      };

      IMAGE_TEMPLATE_HEADERS.forEach((header) => {
        if (header.startsWith("Existing image ")) {
          const index = Number(header.replace("Existing image ", "")) - 1;
          row[header] = imageUrls[index] || "";
        } else if (header.startsWith("New image ")) {
          row[header] = "";
        }
      });

      rows.push(row);
    }

    hasNextPage = Boolean(variants?.pageInfo?.hasNextPage);
    cursor = variants?.pageInfo?.endCursor || null;
  }

  return rows;
}

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
    activeProductsCount: productsCount(query: "status:active") {
      count
    }
    draftProductsCount: productsCount(query: "status:draft") {
      count
    }
    collectionsCount {
      count
    }
  }
`;

export async function getBulkManagerData(admin: GraphqlClient) {
  let json: any = {};

  try {
    const response = await admin.graphql(PRODUCT_LIST_QUERY);
    json = await response.json();

    if (json.errors) {
      const accessErrors = json.errors.filter((error: any) =>
        String(error.message || "").includes("Access denied"),
      );

      if (accessErrors.length !== json.errors.length) {
        json = {};
      }
    }
  } catch {
    json = {};
  }

  let counts: {
    productCount?: number;
    activeProductCount?: number;
    draftProductCount?: number;
    collectionCount?: number;
  } = {};

  try {
    const countResponse = await admin.graphql(STORE_COUNT_QUERY);
    const countJson = await countResponse.json();

    if (!countJson.errors?.length) {
      counts = {
        productCount: countJson.data?.productsCount?.count,
        activeProductCount: countJson.data?.activeProductsCount?.count,
        draftProductCount: countJson.data?.draftProductsCount?.count,
        collectionCount: countJson.data?.collectionsCount?.count,
      };
    }
  } catch {
    counts = {};
  }

  return {
    products: json.data?.products?.edges.map((edge: any) => edge.node) || [],
    productCount: counts.productCount,
    activeProductCount: counts.activeProductCount,
    draftProductCount: counts.draftProductCount,
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

async function getProductMediaIds(admin: GraphqlClient, productId: string) {
  const mediaIds: string[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query BulkListingProductMediaIds($id: ID!, $cursor: String) {
          product(id: $id) {
            media(first: 250, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  __typename
                }
              }
            }
          }
        }`,
      { variables: { id: productId, cursor } },
    );
    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(graphqlErrorMessage(json.errors));
    }

    const media = json.data?.product?.media;

    mediaIds.push(
      ...(media?.edges || [])
        .map((edge: { node?: { id?: string; __typename?: string } }) =>
          edge.node?.__typename === "MediaImage" ? edge.node.id || "" : "",
        )
        .filter(Boolean),
    );
    hasNextPage = Boolean(media?.pageInfo?.hasNextPage);
    cursor = media?.pageInfo?.endCursor || null;
  }

  return mediaIds;
}

async function deleteProductMedia(
  admin: GraphqlClient,
  productId: string,
  mediaIds: string[],
) {
  if (!mediaIds.length) {
    return { deleted: 0 };
  }

  const deleted = [];
  const errors = [];

  for (const chunk of chunkArray(mediaIds, 250)) {
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingDeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            mediaUserErrors {
              field
              message
            }
          }
        }`,
      { variables: { productId, mediaIds: chunk } },
    );
    const json = await response.json();

    if (json.errors?.length) {
      errors.push(graphqlErrorMessage(json.errors));
      continue;
    }

    const result = json.data?.productDeleteMedia;
    const userErrors = result?.mediaUserErrors || [];

    if (userErrors.length) {
      errors.push(userErrors.map((error: any) => error.message).join("; "));
      continue;
    }

    deleted.push(...(result?.deletedMediaIds || []));
  }

  if (errors.length) {
    throw new Error(errors.join("; "));
  }

  return { deleted: deleted.length };
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
              title
              sku
              barcode
              price
              compareAtPrice
              inventoryPolicy
              taxable
              inventoryItem {
                tracked
                unitCost {
                  amount
                }
              }
              product {
                id
                title
                descriptionHtml
                vendor
                productType
                status
                category {
                  id
                }
                featuredMedia {
                  preview {
                    image {
                      url
                    }
                  }
                }
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

function groupVariationRows(rows: VariationRow[]) {
  return rows.reduce<Record<string, VariationRow[]>>((groups, row) => {
    groups[row.parentSku] ||= [];
    groups[row.parentSku].push(row);
    return groups;
  }, {});
}

type VariationSource = {
  row: VariationRow;
  variant: any;
};

function normalizedVariationOptions(row: VariationRow) {
  return [
    {
      name: row.option1Name || "",
      value: row.option1Value || "",
    },
    {
      name: row.option2Name || "",
      value: row.option2Value || "",
    },
  ].filter((option) => option.name && option.value);
}

function variationOptionNames(sources: VariationSource[]) {
  const optionNames = Array.from(
    new Set(
      sources.flatMap((source) =>
        normalizedVariationOptions(source.row).map((option) => option.name),
      ),
    ),
  );

  if (!optionNames.length) {
    optionNames.push("Barcode");
  }

  return optionNames;
}

function variationOptionValues(source: VariationSource, optionNames: string[]) {
  const rowOptions = normalizedVariationOptions(source.row);

  return optionNames.map((optionName) => {
    const option = rowOptions.find((rowOption) => rowOption.name === optionName);

    return {
      name: option?.value || source.row.barcode,
      optionName,
    };
  });
}

function variationReportFields(parentSku: string, barcode: string, rows: VariationRow[]) {
  const row = rows.find((variationRow) => variationRow.barcode.trim() === barcode);

  return {
    parentSku,
    barcode,
    option1Name: row?.option1Name || "",
    option1Value: row?.option1Value || "",
    option2Name: row?.option2Name || "",
    option2Value: row?.option2Value || "",
  };
}

async function createVariationProduct(
  admin: GraphqlClient,
  parentSku: string,
  sources: VariationSource[],
) {
  const firstVariant = sources[0]?.variant;
  const firstProduct = firstVariant?.product || {};
  const optionNames = variationOptionNames(sources);
  const mediaSrc = sources
    .map((source) => source.variant.product?.featuredMedia?.preview?.image?.url || "")
    .filter(Boolean);
  const productResponse = await admin.graphql(
    `#graphql
      mutation BulkVariationProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $product, media: $media) {
          product {
            id
            title
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
          title: parentSku,
          descriptionHtml: firstProduct.descriptionHtml || undefined,
          vendor: firstProduct.vendor || undefined,
          productType: firstProduct.productType || undefined,
          category: firstProduct.category?.id || undefined,
          status: "DRAFT",
          productOptions: optionNames.map((optionName) => {
            const values = sources.map((source) => {
              const option = normalizedVariationOptions(source.row).find(
                (rowOption) => rowOption.name === optionName,
              );

              return option?.value || source.row.barcode;
            });

            return {
              name: optionName,
              values: Array.from(new Set(values)).map((name) => ({ name })),
            };
          }),
        },
        media: mediaSrc.length
          ? Array.from(new Set(mediaSrc)).map((url) => ({
              mediaContentType: "IMAGE",
              originalSource: url,
            }))
          : undefined,
      },
    },
  );
  const productJson = await productResponse.json();

  if (productJson.errors?.length) {
    throw new Error(graphqlErrorMessage(productJson.errors));
  }

  const productCreate = productJson.data?.productCreate;
  const productErrors = productCreate?.userErrors || [];

  if (productErrors.length) {
    throw new Error(productErrors.map((error: any) => error.message).join("; "));
  }

  const productId = productCreate?.product?.id;

  if (!productId) {
    throw new Error("Shopify did not return a parent variation product.");
  }

  const variants = sources.map((source) => {
    const variant = source.variant;
    const inventoryItem = compactObject({
      sku: variant.sku || `${parentSku}-${variant.barcode}`,
      cost: decimalStringValue(String(variant.inventoryItem?.unitCost?.amount || "")),
      tracked: variant.inventoryItem?.tracked,
    });

    return compactObject({
      barcode: variant.barcode || undefined,
      price: decimalStringValue(String(variant.price || "")),
      compareAtPrice: decimalStringValue(String(variant.compareAtPrice || "")),
      taxable: variant.taxable,
      inventoryPolicy: variant.inventoryPolicy,
      inventoryItem:
        Object.keys(inventoryItem).length > 0 ? inventoryItem : undefined,
      optionValues: variationOptionValues(source, optionNames),
      mediaSrc: variant.product?.featuredMedia?.preview?.image?.url
        ? [variant.product.featuredMedia.preview.image.url]
        : undefined,
    });
  });
  const variantsResponse = await admin.graphql(
    `#graphql
      mutation BulkVariationVariantsCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(
          productId: $productId,
          variants: $variants,
          strategy: REMOVE_STANDALONE_VARIANT
        ) {
          product {
            id
          }
          productVariants {
            id
            title
            barcode
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
        variants,
      },
    },
  );
  const variantsJson = await variantsResponse.json();

  if (variantsJson.errors?.length) {
    throw new Error(graphqlErrorMessage(variantsJson.errors));
  }

  const variantsCreate = variantsJson.data?.productVariantsBulkCreate;
  const variantErrors = variantsCreate?.userErrors || [];

  if (variantErrors.length) {
    throw new Error(variantErrors.map((error: any) => error.message).join("; "));
  }

  return {
    productId,
    variantsCreated: variantsCreate?.productVariants?.length || variants.length,
  };
}

export async function createBulkVariations(
  admin: GraphqlClient,
  rows: VariationRow[],
) {
  if (!rows.length) {
    throw new Error("Add Parent SKU and Barcode rows before uploading.");
  }

  const reportRows = [];
  const grouped = groupVariationRows(rows);

  for (const [parentSku, groupRows] of Object.entries(grouped)) {
    const uniqueBarcodes = Array.from(
      new Set(groupRows.map((row) => row.barcode.trim()).filter(Boolean)),
    );

    if (uniqueBarcodes.length < 2) {
      reportRows.push({
        ...variationReportFields(parentSku, uniqueBarcodes[0] || "", groupRows),
        status: "Error",
        message: "At least 2 barcodes are required to create variations.",
        productId: "",
      });
      continue;
    }

    if (uniqueBarcodes.length > 20) {
      uniqueBarcodes.forEach((barcode) =>
        reportRows.push({
          ...variationReportFields(parentSku, barcode, groupRows),
          status: "Error",
          message: "A parent SKU can contain maximum 20 barcodes.",
          productId: "",
        }),
      );
      continue;
    }

    const sourceVariants = [];
    const missingBarcodes = [];

    for (const barcode of uniqueBarcodes) {
      const row = groupRows.find((variationRow) => variationRow.barcode.trim() === barcode);
      const variant = await findExistingVariantByBarcode(admin, barcode);

      if (!variant?.id) {
        missingBarcodes.push(barcode);
      } else if (row) {
        sourceVariants.push({ row, variant });
      }
    }

    if (missingBarcodes.length) {
      missingBarcodes.forEach((barcode) =>
        reportRows.push({
          ...variationReportFields(parentSku, barcode, groupRows),
          status: "Error",
          message: "Could not find an existing Shopify variant for this barcode.",
          productId: "",
        }),
      );
      continue;
    }

    try {
      const result = await createVariationProduct(admin, parentSku, sourceVariants);

      uniqueBarcodes.forEach((barcode) =>
        reportRows.push({
          ...variationReportFields(parentSku, barcode, groupRows),
          status: "Success",
          message: `Created under parent SKU ${parentSku}. Original listing was not deleted.`,
          productId: result.productId,
        }),
      );
    } catch (error) {
      uniqueBarcodes.forEach((barcode) =>
        reportRows.push({
          ...variationReportFields(parentSku, barcode, groupRows),
          status: "Error",
          message: errorMessage(error, "Variation product create failed."),
          productId: "",
        }),
      );
    }
  }

  return {
    summary: {
      total: reportRows.length,
      success: reportRows.filter((row) => row.status === "Success").length,
      error: reportRows.filter((row) => row.status === "Error").length,
      parents: Object.keys(grouped).length,
    },
    rows: reportRows,
  };
}

async function resolveProductIdFromBarcode(
  admin: GraphqlClient,
  barcode: string | undefined,
  cache: Map<string, string>,
) {
  const normalizedBarcode = barcode?.trim();

  if (!normalizedBarcode) {
    return "";
  }

  if (cache.has(normalizedBarcode)) {
    return cache.get(normalizedBarcode) || "";
  }

  const variant = await findExistingVariantByBarcode(admin, normalizedBarcode);
  const productId = variant?.product?.id || "";

  cache.set(normalizedBarcode, productId);
  return productId;
}

export async function resolveStatusRowsProductIds(
  admin: GraphqlClient,
  rows: VariantUpdateRow[],
) {
  const barcodeCache = new Map<string, string>();
  const resolved = [];

  for (const row of rows) {
    if (!row.productStatus) {
      continue;
    }

    const productId =
      row.productId ||
      (await resolveProductIdFromBarcode(admin, row.barcode, barcodeCache));

    if (!productId) {
      resolved.push({
        ...row,
        productId: "",
      });
      continue;
    }

    resolved.push({
      ...row,
      productId,
    });
  }

  return resolved;
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
    let json: any;

    try {
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
      json = await response.json();
    } catch (error) {
      reportRows.push({
        ...reportBase,
        status: "Error",
        message: errorMessage(error, "Product create request failed."),
        productId: "",
      });
      continue;
    }

    if (json.errors?.length) {
      reportRows.push({
        ...reportBase,
        status: "Error",
        message: graphqlErrorMessage(json.errors),
        productId: "",
      });
      continue;
    }

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

    const product = json.data?.productCreate?.product;

    if (!product) {
      reportRows.push({
        ...reportBase,
        status: "Error",
        message: "Shopify did not return the created product.",
        productId: "",
      });
      continue;
    }
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

export async function updateProductImages(
  admin: GraphqlClient,
  rows: ProductImageRow[],
) {
  if (!rows.length) {
    throw new Error("Add at least one URL in the New image columns before uploading.");
  }

  const grouped = new Map<string, ProductImageRow>();

  for (const row of rows) {
    let productId = row.productId;

    if (!productId && row.barcode) {
      const variant = await findExistingVariantByBarcode(admin, row.barcode);
      productId = variant?.product?.id || "";
    }

    if (!productId) {
      grouped.set(`missing:${row.barcode}`, {
        ...row,
        productId: "",
      });
      continue;
    }

    const existing = grouped.get(productId);

    grouped.set(productId, {
      barcode: existing?.barcode || row.barcode,
      productId,
      imageUrls: Array.from(
        new Set([...(existing?.imageUrls || []), ...row.imageUrls]),
      ),
    });
  }

  const mutation = `#graphql
    mutation BulkListingProductImages($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          id
          status
        }
        mediaUserErrors {
          field
          message
        }
      }
    }`;
  const rowsResult = [];

  for (const row of grouped.values()) {
    if (!row.productId) {
      rowsResult.push({
        barcode: row.barcode,
        productId: "",
        images: row.imageUrls.length,
        success: false,
        message: "Could not find a Shopify product for this barcode.",
      });
      continue;
    }

    try {
      const oldMediaIds = await getProductMediaIds(admin, row.productId);
      const response = await admin.graphql(mutation, {
        variables: {
          productId: row.productId,
          media: row.imageUrls.map((url) => ({
            mediaContentType: "IMAGE",
            originalSource: url,
          })),
        },
      });
      const json = await response.json();

      if (json.errors?.length) {
        rowsResult.push({
          barcode: row.barcode,
          productId: row.productId,
          images: row.imageUrls.length,
          success: false,
          message: graphqlErrorMessage(json.errors),
        });
        continue;
      }

      const result = json.data?.productCreateMedia;
      const userErrors = result?.mediaUserErrors || [];

      if (userErrors.length) {
        rowsResult.push({
          barcode: row.barcode,
          productId: row.productId,
          images: row.imageUrls.length,
          success: false,
          message: userErrors.map((error: any) => error.message).join("; "),
        });
        continue;
      }

      const deleteResult = await deleteProductMedia(
        admin,
        row.productId,
        oldMediaIds,
      );

      rowsResult.push({
        barcode: row.barcode,
        productId: row.productId,
        images: result?.media?.length || row.imageUrls.length,
        success: true,
        message: `Images replaced. Removed ${deleteResult.deleted} previous image(s).`,
      });
    } catch (error) {
      rowsResult.push({
        barcode: row.barcode,
        productId: row.productId,
        images: row.imageUrls.length,
        success: false,
        message: errorMessage(error, "Image update failed."),
      });
    }
  }

  return {
    summary: {
      products: rowsResult.length,
      success: rowsResult.filter((row) => row.success).length,
      error: rowsResult.filter((row) => !row.success).length,
      images: rowsResult
        .filter((row) => row.success)
        .reduce((count, row) => count + row.images, 0),
    },
    rows: rowsResult,
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
  const missingRows = [];
  const barcodeCache = new Map<string, string>();

  for (const row of rows) {
    const productId =
      row.productId ||
      (await resolveProductIdFromBarcode(admin, row.barcode, barcodeCache));

    if (!productId) {
      missingRows.push({
        barcode: row.barcode || "",
        productId: "",
        action: row.action || "",
        success: false,
        message: "Could not find a Shopify product for this barcode.",
      });
      continue;
    }

    if (row.action === "DELETE") {
      deleteIds.push(productId);
      continue;
    }

    if (row.action) {
      statusGroups[row.action].push(productId);
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
  const allRows = [...statusRows, ...deleted, ...missingRows];

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
  const errors = [];

  for (const [productId, variants] of Object.entries(byProduct)) {
    for (const chunk of chunkArray(variants, 100)) {
      try {
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

        if (json.errors?.length) {
          errors.push({
            productId,
            variants: chunk.length,
            message: graphqlErrorMessage(json.errors),
          });
          continue;
        }

        const result = json.data?.productVariantsBulkUpdate;
        const userErrors = result?.userErrors || [];

        if (userErrors.length) {
          errors.push({
            productId,
            variants: chunk.length,
            message: userErrors.map((error: any) => error.message).join("; "),
          });
          continue;
        }

        updated.push({
          productId,
          updated: result?.productVariants?.length || chunk.length,
        });
      } catch (error) {
        errors.push({
          productId,
          variants: chunk.length,
          message: errorMessage(error, "Price update failed."),
        });
      }
    }
  }

  return {
    summary: {
      products: updated.length,
      variants: updated.reduce((count, row) => count + row.updated, 0),
      errors: errors.length,
    },
    rows: updated,
    errors,
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
  const errors = [];
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
    try {
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

      if (json.errors?.length) {
        errors.push({
          batch: index + 1,
          rows: quantityChunk.length,
          message: graphqlErrorMessage(json.errors),
        });
        continue;
      }

      const result = json.data?.inventorySetQuantities;
      const userErrors = result?.userErrors || [];

      if (userErrors.length) {
        errors.push({
          batch: index + 1,
          rows: quantityChunk.length,
          message: userErrors.map((error: any) => error.message).join("; "),
        });
        continue;
      }

      results.push({
        batch: index + 1,
        rows: quantityChunk.length,
        changedAt: result?.inventoryAdjustmentGroup?.createdAt || null,
      });
    } catch (error) {
      errors.push({
        batch: index + 1,
        rows: quantityChunk.length,
        message: errorMessage(error, "Stock update failed."),
      });
    }
  }

  return {
    batches: results.length,
    results,
    errors,
    updatedRows: quantities.length,
    failedRows: errors.reduce((count, error) => count + error.rows, 0),
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
