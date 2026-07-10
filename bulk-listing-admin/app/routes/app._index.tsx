import { useEffect, useState, type ReactNode } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  addProductsToCollection,
  applyProductActions,
  createProducts,
  getBulkManagerData,
  normalizeProductActionRows,
  normalizeProductRows,
  normalizeStockRows,
  parseJsonRows,
  updateInventoryQuantities,
  updateProductStatuses,
  updateVariantPrices,
  type ProductActionRow,
  type ProductRow,
  type VariantUpdateRow,
} from "../models/bulk-products.server";
import {
  normalizeStringArrayRows,
  parseWorkbookRows,
} from "../models/bulk-spreadsheets.server";
import styles from "../styles/bulk-products.module.css";

const sampleProducts = JSON.stringify(
  [
    {
      title: "Cotton T-Shirt",
      vendor: "Acme",
      productType: "Apparel",
      status: "DRAFT",
      price: "19.99",
      sku: "TEE-001",
      quantity: 20,
    },
    {
      title: "Canvas Tote",
      vendor: "Acme",
      productType: "Accessories",
      status: "ACTIVE",
      price: "24.99",
      sku: "TOTE-001",
      quantity: 15,
    },
  ],
  null,
  2,
);

const sampleVariantUpdates = JSON.stringify(
  [
    {
      productId: "gid://shopify/Product/123",
      variantId: "gid://shopify/ProductVariant/456",
      inventoryItemId: "gid://shopify/InventoryItem/789",
      price: "29.99",
      sku: "NEW-SKU-001",
      quantity: 12,
    },
  ],
  null,
  2,
);

type CreateProductReportRow = {
  row: number;
  title: string;
  sku: string;
  barcode: string;
  status: string;
  message: string;
  productId: string;
};

function escapeSpreadsheetXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadCreateProductsReport(rows: CreateProductReportRow[]) {
  const headers = ["Row", "Title", "SKU", "Barcode", "Status", "Message", "Product ID"];
  const sheetRows = rows.map((row) => [
    row.row,
    row.title,
    row.sku,
    row.barcode,
    row.status,
    row.message,
    row.productId,
  ]);
  const xmlRows = [headers, ...sheetRows]
    .map(
      (cells) =>
        `<Row>${cells
          .map(
            (cell) =>
              `<Cell><Data ss:Type="String">${escapeSpreadsheetXml(cell)}</Data></Cell>`,
          )
          .join("")}</Row>`,
    )
    .join("");
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Create products result">
  <Table>${xmlRows}</Table>
 </Worksheet>
</Workbook>`;
  const blob = new Blob([xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `create-products-result-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-")}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function getRowsFromUpload<T>(
  formData: FormData,
  fileField: string,
  fallbackField: string,
) {
  const uploadedRows = await parseWorkbookRows<T>(formData.get(fileField));

  if (uploadedRows.length > 0) {
    return uploadedRows;
  }

  return parseJsonRows<T>(formData.get(fallbackField));
}

function TemplateUpload({
  template,
  fileName,
}: {
  template:
    | "create-products"
    | "bulk-delete"
    | "update-status"
    | "update-prices"
    | "update-stock"
    | "add-to-collection";
  fileName: string;
}) {
  const location = useLocation();
  const shopify = useAppBridge() as unknown as {
    idToken?: () => Promise<string>;
    toast?: {
      show: (message: string, options?: { isError?: boolean }) => void;
    };
  };
  const [isDownloading, setIsDownloading] = useState(false);
  const downloadHref = `/app/templates/${template}${location.search}`;
  const downloadTemplate = async () => {
    setIsDownloading(true);

    try {
      const token = await shopify.idToken?.();
      const response = await fetch(downloadHref, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const contentType = response.headers.get("Content-Type") || "";

      if (!response.ok) {
        throw new Error(`Template download failed (${response.status}).`);
      }

      if (contentType.includes("text/html")) {
        throw new Error("Shopify session refreshed. Reload the app and try again.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const resolvedFileName =
        fileNameMatch?.[1] || `${template}-template.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = resolvedFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      shopify.toast?.show(
        error instanceof Error ? error.message : "Template download failed.",
        { isError: true },
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={styles.templateRow}>
      <button
        className={styles.download}
        type="button"
        disabled={isDownloading}
        onClick={downloadTemplate}
      >
        {isDownloading ? "Downloading..." : "Download template"}
      </button>
      <input
        className={styles.fileInput}
        type="file"
        name={fileName}
        accept=".xlsx,.xls,.csv"
        aria-label="Upload completed Excel template"
      />
    </div>
  );
}

function ToolCard({
  title,
  badges,
  children,
}: {
  title: string;
  badges: string[];
  children: ReactNode;
}) {
  return (
    <section className={styles.tool}>
      <div className={styles.toolHeader}>
        <div>
          <h2 className={styles.toolTitle}>{title}</h2>
          <div className={styles.toolMeta}>
            {badges.map((badge) => (
              <span className={styles.pill} key={badge}>
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  return getBulkManagerData(admin);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "create-products") {
      const rows = normalizeProductRows(
        await getRowsFromUpload<Record<string, unknown> | ProductRow>(
          formData,
          "productsFile",
          "products",
        ),
      );
      return {
        intent,
        result: await createProducts(
          admin,
          rows,
          String(formData.get("locationId") || ""),
        ),
      };
    }

    if (intent === "update-status") {
      const uploadedRows = await parseWorkbookRows<Record<string, unknown>>(
        formData.get("productIdsFile"),
      );
      const status = String(formData.get("status")) as
        | "ACTIVE"
        | "DRAFT"
        | "ARCHIVED";

      if (uploadedRows.length > 0) {
        const statusGroups = uploadedRows.reduce<Record<string, string[]>>(
          (groups, row) => {
            const productId = String(row.productId || "").trim();
            const rowStatus = String(row.status || status)
              .trim()
              .toUpperCase();

            if (!productId) {
              return groups;
            }

            groups[rowStatus] ||= [];
            groups[rowStatus].push(productId);
            return groups;
          },
          {},
        );

        const result = [];

        for (const [rowStatus, productIds] of Object.entries(statusGroups)) {
          result.push(
            await updateProductStatuses(
              admin,
              productIds,
              rowStatus as "ACTIVE" | "DRAFT" | "ARCHIVED",
            ),
          );
        }

        return { intent, result };
      }

      const productIds = parseJsonRows<string>(formData.get("productIds"));

      return {
        intent,
        result: await updateProductStatuses(admin, productIds, status),
      };
    }

    if (intent === "update-prices") {
      const rows = await getRowsFromUpload<VariantUpdateRow>(
        formData,
        "variantsFile",
        "variants",
      );
      return {
        intent,
        result: await updateVariantPrices(admin, rows),
      };
    }

    if (intent === "bulk-delete") {
      const rows = normalizeProductActionRows(
        await getRowsFromUpload<Record<string, unknown> | ProductActionRow>(
          formData,
          "productActionsFile",
          "productActions",
        ),
      );

      if (rows.length === 0) {
        throw new Error(
          "Choose Active, Draft, Unlist, or Delete in the Action column before uploading.",
        );
      }

      return {
        intent,
        result: await applyProductActions(admin, rows),
      };
    }

    if (intent === "update-stock") {
      const rows = normalizeStockRows(
        await getRowsFromUpload<Record<string, unknown> | VariantUpdateRow>(
          formData,
          "variantsFile",
          "variants",
        ),
      );
      const locationId = String(formData.get("locationId") || "");
      const stockResult = await updateInventoryQuantities(
        admin,
        rows,
        locationId,
      );
      const statusGroups = rows.reduce<
        Record<"ACTIVE" | "DRAFT" | "ARCHIVED", string[]>
      >(
        (groups, row) => {
          if (row.productId && row.productStatus) {
            groups[row.productStatus].push(row.productId);
          }

          return groups;
        },
        { ACTIVE: [], DRAFT: [], ARCHIVED: [] },
      );
      const statusResult = [];
      const totalStatusUpdates = Object.values(statusGroups).reduce(
        (count, productIds) => count + new Set(productIds).size,
        0,
      );

      if (totalStatusUpdates > 250) {
        return {
          intent,
          result: {
            stock: stockResult,
            statuses: [],
            statusWarning:
              "Stock was updated. More than 250 status changes were selected, so status changes were skipped to avoid a timeout. Upload status changes in smaller files.",
          },
        };
      }

      for (const [status, productIds] of Object.entries(statusGroups)) {
        const uniqueProductIds = Array.from(new Set(productIds));

        if (uniqueProductIds.length > 0) {
          statusResult.push(
            await updateProductStatuses(
              admin,
              uniqueProductIds,
              status as "ACTIVE" | "DRAFT" | "ARCHIVED",
            ),
          );
        }
      }

      return {
        intent,
        result: {
          stock: stockResult,
          statuses: statusResult,
        },
      };
    }

    if (intent === "add-to-collection") {
      const uploadedRows = await parseWorkbookRows<Record<string, unknown>>(
        formData.get("productIdsFile"),
      );
      const productIds =
        uploadedRows.length > 0
          ? normalizeStringArrayRows(uploadedRows)
          : parseJsonRows<string>(formData.get("productIds"));
      const collectionId = String(formData.get("collectionId") || "");
      return {
        intent,
        result: await addProductsToCollection(admin, collectionId, productIds),
      };
    }

    return { intent, error: "Unknown bulk action." };
  } catch (error) {
    return {
      intent,
      error: error instanceof Error ? error.message : "Bulk action failed.",
    };
  }
};

export default function BulkProducts() {
  const { products, productCount, collections, collectionCount, locations } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";
  const hasLocations = locations.length > 0;
  const createProductReportRows =
    fetcher.data?.intent === "create-products" &&
    fetcher.data?.result &&
    "reportRows" in fetcher.data.result
      ? (fetcher.data.result.reportRows as CreateProductReportRow[])
      : [];

  useEffect(() => {
    if (fetcher.data?.result) {
      shopify.toast.show("Bulk action completed");
    }

    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Bulk Listing Manager">
      <div className={styles.shell}>
        <div className={styles.topbar}>
          <div className={styles.titleBlock}>
            <div className={styles.eyebrow}>Catalog operations</div>
            <h1 className={styles.title}>Bulk product control center</h1>
            <p className={styles.subtitle}>
              Manage products, stock, prices, status, and collections from Excel
              files.
            </p>
          </div>
          <div className={styles.statusStrip}>
            <div className={styles.metric}>
              <div className={styles.metricValue}>
                {(productCount ?? products.length).toLocaleString()}
              </div>
              <div className={styles.metricLabel}>Products</div>
            </div>
            <div className={styles.metric}>
              <div className={styles.metricValue}>
                {(collectionCount ?? collections.length).toLocaleString()}
              </div>
              <div className={styles.metricLabel}>Collections</div>
            </div>
            <div className={styles.metric}>
              <div className={styles.metricValue}>{locations.length}</div>
              <div className={styles.metricLabel}>Locations</div>
            </div>
          </div>
        </div>

        <div className={styles.layout}>
          <div className={styles.toolGrid}>
            <ToolCard
              title="Create products"
              badges={["products", "price", "SKU", "initial stock"]}
            >
              <fetcher.Form method="post" encType="multipart/form-data">
                <input type="hidden" name="intent" value="create-products" />
                <div className={styles.toolBody}>
                  <TemplateUpload
                    template="create-products"
                    fileName="productsFile"
                  />
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="createLocation">
                      Initial inventory location
                    </label>
                    <select
                      className={styles.select}
                      id="createLocation"
                      name="locationId"
                      disabled={!hasLocations}
                    >
                      {locations.map((location: any) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!hasLocations && (
                    <div className={styles.warning}>
                      Inventory locations are unavailable until Shopify grants
                      the location scope.
                    </div>
                  )}
                  <details className={styles.details}>
                    <summary>JSON fallback</summary>
                    <textarea
                      className={styles.textarea}
                      name="products"
                      defaultValue={sampleProducts}
                    />
                  </details>
                  <div className={styles.actions}>
                    <button
                      className={styles.primaryButton}
                      type="submit"
                      disabled={isSubmitting}
                    >
                      Create products
                    </button>
                  </div>
                </div>
              </fetcher.Form>
            </ToolCard>

            <ToolCard
              title="Bulk delete / status"
              badges={["barcode", "active", "draft", "delete"]}
            >
              <fetcher.Form method="post" encType="multipart/form-data">
                <input type="hidden" name="intent" value="bulk-delete" />
                <div className={styles.toolBody}>
                  <TemplateUpload
                    template="bulk-delete"
                    fileName="productActionsFile"
                  />
                  <div className={styles.warning}>
                    Only rows with an Action selected will be changed. Delete
                    permanently removes those products from Shopify.
                  </div>
                  <details className={styles.details}>
                    <summary>JSON fallback</summary>
                    <textarea
                      className={styles.textarea}
                      name="productActions"
                      defaultValue="[]"
                    />
                  </details>
                  <div className={styles.actions}>
                    <button
                      className={styles.primaryButton}
                      type="submit"
                      disabled={isSubmitting}
                    >
                      Apply actions
                    </button>
                  </div>
                </div>
              </fetcher.Form>
            </ToolCard>

            <ToolCard title="Update prices" badges={["variants", "price", "SKU"]}>
              <fetcher.Form method="post" encType="multipart/form-data">
                <input type="hidden" name="intent" value="update-prices" />
                <div className={styles.toolBody}>
                  <TemplateUpload
                    template="update-prices"
                    fileName="variantsFile"
                  />
                  <details className={styles.details}>
                    <summary>JSON fallback</summary>
                    <textarea
                      className={styles.textarea}
                      name="variants"
                      defaultValue={sampleVariantUpdates}
                    />
                  </details>
                  <div className={styles.actions}>
                    <button
                      className={styles.primaryButton}
                      type="submit"
                      disabled={isSubmitting}
                    >
                      Update prices
                    </button>
                  </div>
                </div>
              </fetcher.Form>
            </ToolCard>

            <ToolCard title="Update stock" badges={["inventory", "location"]}>
              <fetcher.Form method="post" encType="multipart/form-data">
                <input type="hidden" name="intent" value="update-stock" />
                <div className={styles.toolBody}>
                  <TemplateUpload template="update-stock" fileName="variantsFile" />
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="stockLocation">
                      Inventory location
                    </label>
                    <select
                      className={styles.select}
                      id="stockLocation"
                      name="locationId"
                      disabled={!hasLocations}
                    >
                      {locations.map((location: any) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!hasLocations && (
                    <div className={styles.warning}>
                      Inventory locations are unavailable until Shopify grants
                      the location scope.
                    </div>
                  )}
                  <details className={styles.details}>
                    <summary>JSON fallback</summary>
                    <textarea
                      className={styles.textarea}
                      name="variants"
                      defaultValue={sampleVariantUpdates}
                    />
                  </details>
                  <div className={styles.actions}>
                    <button
                      className={styles.primaryButton}
                      type="submit"
                      disabled={isSubmitting}
                    >
                      Update stock
                    </button>
                  </div>
                </div>
              </fetcher.Form>
            </ToolCard>

          </div>

          <aside className={styles.sidePanel}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>Recent listings</div>
              <div className={styles.panelBody}>
                {products.slice(0, 8).map((product: any) => (
                  <div className={styles.productRow} key={product.id}>
                    <div>
                      <div className={styles.productTitle}>{product.title}</div>
                      <div className={styles.productMeta}>
                        {product.status} | Stock {product.totalInventory ?? 0}
                      </div>
                    </div>
                    <button
                      className={styles.editButton}
                      type="button"
                      onClick={() => {
                        shopify.intents.invoke?.("edit:shopify/Product", {
                          value: product.id,
                        });
                      }}
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {fetcher.data && (
              <section className={styles.panel}>
                <div className={styles.panelHeader}>Last action result</div>
                <div className={styles.panelBody}>
                  {createProductReportRows.length > 0 && (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() =>
                        downloadCreateProductsReport(createProductReportRows)
                      }
                    >
                      Download result Excel
                    </button>
                  )}
                  <pre className={styles.result}>
                    <code>{JSON.stringify(fetcher.data, null, 2)}</code>
                  </pre>
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
