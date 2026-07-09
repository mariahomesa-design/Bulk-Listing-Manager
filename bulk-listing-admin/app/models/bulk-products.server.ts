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
  productType?: string;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  price?: string;
  sku?: string;
  quantity?: number;
};

export type VariantUpdateRow = {
  productId: string;
  variantId: string;
  price?: string;
  sku?: string;
  inventoryItemId?: string;
  quantity?: number;
};

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
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingProductCreate($product: ProductCreateInput!) {
          productCreate(product: $product) {
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
            productType: row.productType || undefined,
            status: row.status || "DRAFT",
          },
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

    if (variant && (row.price || row.sku)) {
      await updateVariantPrices(admin, [
        {
          productId: product.id,
          variantId: variant.id,
          price: row.price,
          sku: row.sku,
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
          variants: variants.map((variant) => ({
            id: variant.variantId,
            price: variant.price,
            inventoryItem: variant.sku ? { sku: variant.sku } : undefined,
          })),
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

  const response = await admin.graphql(
    `#graphql
      mutation BulkListingInventory($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            createdAt
            reason
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        input: {
          name: "available",
          reason: "correction",
          quantities: rows
            .filter((row) => row.inventoryItemId && row.quantity !== undefined)
            .map((row) => ({
              inventoryItemId: row.inventoryItemId,
              locationId,
              quantity: row.quantity,
              compareQuantity: null,
            })),
        },
      },
    },
  );

  const json = await response.json();
  return json.data?.inventorySetQuantities;
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
