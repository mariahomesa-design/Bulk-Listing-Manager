import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { createBulkJob } from "../models/bulk-jobs.server";
import {
  getBulkManagerData,
  normalizeImageRows,
  normalizeProductActionRows,
  normalizePriceRows,
  normalizeProductRows,
  normalizeStockRows,
  parseJsonRows,
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

type UpdateHistoryFile = {
  id: string;
  intent: string;
  label: string;
  status: "success" | "error";
  createdAt: string;
  rows: Record<string, unknown>[];
};

type BulkJobStatus = {
  id: string;
  intent: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  progress: number;
  totalRows: number;
  processedRows: number;
  message?: string | null;
  result?: unknown;
  error?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

function escapeSpreadsheetXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getResultRows(data: any): Record<string, unknown>[] {
  if (!data) {
    return [];
  }

  if (data.error) {
    return [
      {
        Intent: data.intent || "bulk-action",
        Status: "Error",
        Message: data.error,
      },
    ];
  }

  const result = data.result;

  if (!result) {
    return [];
  }

  if (Array.isArray(result.reportRows)) {
    return result.reportRows.map((row: CreateProductReportRow) => ({
      Row: row.row,
      Title: row.title,
      SKU: row.sku,
      Barcode: row.barcode,
      Status: row.status,
      Message: row.message,
      "Product ID": row.productId,
    }));
  }

  if (Array.isArray(result.rows)) {
    return result.rows.map((row: Record<string, unknown>) => row);
  }

  if (Array.isArray(result.errors) && result.errors.length > 0) {
    return result.errors.map((row: Record<string, unknown>) => ({
      Status: "Error",
      ...row,
    }));
  }

  if (result.stock || result.statuses) {
    const rows: Record<string, unknown>[] = [];

    if (result.stock) {
      rows.push({
        Operation: "Stock",
        Status: result.stock.errors?.length ? "Completed with errors" : "Success",
        "Updated rows": result.stock.updatedRows ?? "",
        "Failed rows": result.stock.failedRows ?? 0,
        Batches: result.stock.batches ?? "",
      });
      (result.stock.errors || []).forEach((error: Record<string, unknown>) =>
        rows.push({ Operation: "Stock", Status: "Error", ...error }),
      );
    }

    (result.statuses || [])
      .flat()
      .forEach((row: Record<string, unknown>) =>
        rows.push({ Operation: "Status", ...row }),
      );

    if (result.statusWarning) {
      rows.push({
        Operation: "Status",
        Status: "Warning",
        Message: result.statusWarning,
      });
    }

    return rows;
  }

  if (Array.isArray(result)) {
    return result.flat().map((row: Record<string, unknown>) => row);
  }

  if (result.summary) {
    return [result.summary];
  }

  return [{ Result: JSON.stringify(result) }];
}

function getResultStatus(rows: Record<string, unknown>[], data: any) {
  if (data?.error) {
    return "error";
  }

  return rows.some((row) => {
    const values = Object.values(row).map((value) => String(value).toLowerCase());
    return values.includes("error") || values.includes("false");
  })
    ? "error"
    : "success";
}

function resultFileName(file: UpdateHistoryFile) {
  return `${file.intent}-${file.status}-${file.createdAt
    .slice(0, 19)
    .replace(/[:T]/g, "-")}.xls`;
}

function downloadResultFile(file: UpdateHistoryFile) {
  const headers = Array.from(
    file.rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );
  const normalizedHeaders = headers.length ? headers : ["Status", "Message"];
  const sheetRows = file.rows.map((row) =>
    normalizedHeaders.map((header) => row[header] ?? ""),
  );
  const xmlRows = [normalizedHeaders, ...sheetRows]
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
 <Worksheet ss:Name="Result">
  <Table>${xmlRows}</Table>
 </Worksheet>
</Workbook>`;
  const blob = new Blob([xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = resultFileName(file);
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
    | "bulk-images"
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
  id,
  title,
  badges,
  children,
}: {
  id?: string;
  title: string;
  badges: string[];
  children: ReactNode;
}) {
  return (
    <section className={styles.tool} id={id}>
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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  async function enqueue(payload: Record<string, unknown>) {
    const job = await createBulkJob({
      shop: session.shop,
      intent,
      payload,
    });

    return {
      intent,
      job: {
        id: job.id,
        intent: job.intent,
        status: job.status,
        progress: job.progress,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        message: job.message,
      },
    };
  }

  try {
    if (intent === "create-products") {
      const rows = normalizeProductRows(
        await getRowsFromUpload<Record<string, unknown> | ProductRow>(
          formData,
          "productsFile",
          "products",
        ),
      );

      return enqueue({
        rows,
        locationId: String(formData.get("locationId") || ""),
      });
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

        return enqueue({
          statusGroups,
          rows: uploadedRows,
        });
      }

      const productIds = parseJsonRows<string>(formData.get("productIds"));

      return enqueue({ productIds, status });
    }

    if (intent === "update-prices") {
      const rows = normalizePriceRows(
        await getRowsFromUpload<Record<string, unknown> | VariantUpdateRow>(
          formData,
          "variantsFile",
          "variants",
        ),
      );
      return enqueue({ rows });
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

      return enqueue({ rows });
    }

    if (intent === "bulk-images") {
      const rows = normalizeImageRows(
        await getRowsFromUpload<Record<string, unknown>>(
          formData,
          "imagesFile",
          "productImages",
        ),
      );

      return enqueue({ rows });
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

      return enqueue({ rows, locationId });
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
      return enqueue({ collectionId, productIds });
    }

    return { intent, error: "Unknown bulk action." };
  } catch (error) {
    return {
      intent,
      error: error instanceof Error ? error.message : "Bulk action failed.",
    };
  }
};

export type BulkManagerView =
  | "dashboard"
  | "create-products"
  | "bulk-delete-status"
  | "update-prices"
  | "update-stock"
  | "bulk-images";

const viewContent: Record<
  Exclude<BulkManagerView, "dashboard">,
  { eyebrow: string; title: string; description: string }
> = {
  "create-products": {
    eyebrow: "Catalog creation",
    title: "Create products",
    description:
      "Prepare new listings in Excel, validate their catalog data, and create them in Shopify in one controlled import.",
  },
  "bulk-delete-status": {
    eyebrow: "Catalog governance",
    title: "Bulk delete / status",
    description:
      "Review current product state and safely move listings between active, draft, unlisted, or deleted states.",
  },
  "update-prices": {
    eyebrow: "Pricing operations",
    title: "Update prices",
    description:
      "Export current variant pricing, enter new selling and compare-at prices, then apply the changes in bulk.",
  },
  "update-stock": {
    eyebrow: "Inventory operations",
    title: "Update stock",
    description:
      "Export current inventory by SKU and barcode, enter new quantities, and synchronize the selected Shopify location.",
  },
  "bulk-images": {
    eyebrow: "Media operations",
    title: "Bulk image update",
    description:
      "Export existing listing images by barcode, add new image URLs in Excel, and attach them to matching Shopify products.",
  },
};

function Dashboard({
  products,
  productCount,
  activeProductCount,
  draftProductCount,
  collections,
  collectionCount,
  locations,
  shopify,
}: any) {
  const workflows = [
    {
      number: "01",
      title: "Create products",
      text: "Build complete listings with pricing, variants, images, taxonomy, and opening stock.",
      href: "/app/create-products",
      tone: "green",
    },
    {
      number: "02",
      title: "Bulk delete / status",
      text: "Activate, draft, unlist, or permanently delete selected products using barcode.",
      href: "/app/bulk-delete-status",
      tone: "red",
    },
    {
      number: "03",
      title: "Update prices",
      text: "Change price and compare-at price across thousands of product variants.",
      href: "/app/update-prices",
      tone: "blue",
    },
    {
      number: "04",
      title: "Update stock",
      text: "Synchronize inventory quantities and product visibility at the correct location.",
      href: "/app/update-stock",
      tone: "amber",
    },
    {
      number: "05",
      title: "Bulk image update",
      text: "Attach new listing images by barcode using exported current image columns.",
      href: "/app/bulk-images",
      tone: "blue",
    },
  ];

  return (
    <>
      <section className={styles.dashboardHero}>
        <div>
          <div className={styles.eyebrow}>Maria Homes operations</div>
          <h1 className={styles.dashboardTitle}>Catalog command center</h1>
          <p className={styles.dashboardSubtitle}>
            Run high-volume Shopify catalog changes with structured Excel
            workflows and clear results.
          </p>
        </div>
        <div className={styles.liveBadge}>
          <span className={styles.liveDot} /> Connected to Shopify
        </div>
      </section>

      <section className={styles.metricGrid} aria-label="Store overview">
        <div className={styles.metricCard}>
          <span className={styles.metricCaption}>Products</span>
          <strong>{(productCount ?? products.length).toLocaleString()}</strong>
          <span>Live catalog count</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricCaption}>Active</span>
          <strong>{(activeProductCount ?? 0).toLocaleString()}</strong>
          <span>Visible listings</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricCaption}>Draft</span>
          <strong>{(draftProductCount ?? 0).toLocaleString()}</strong>
          <span>Hidden drafts</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricCaption}>Collections</span>
          <strong>{(collectionCount ?? collections.length).toLocaleString()}</strong>
          <span>Available groups</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricCaption}>Locations</span>
          <strong>{locations.length.toLocaleString()}</strong>
          <span>Inventory destinations</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricCaption}>System</span>
          <strong className={styles.healthyValue}>Ready</strong>
          <span>Bulk tools available</span>
        </div>
      </section>

      <div className={styles.dashboardLayout}>
        <main>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Bulk workflows</h2>
              <p>Choose the operation you want to run.</p>
            </div>
          </div>
          <div className={styles.workflowGrid}>
            {workflows.map((workflow) => (
              <Link
                className={`${styles.workflowCard} ${styles[workflow.tone]}`}
                key={workflow.href}
                to={workflow.href}
              >
                <span className={styles.workflowNumber}>{workflow.number}</span>
                <div>
                  <h3>{workflow.title}</h3>
                  <p>{workflow.text}</p>
                </div>
                <span className={styles.workflowArrow} aria-hidden="true">
                  &rarr;
                </span>
              </Link>
            ))}
          </div>
        </main>

        <aside className={styles.dashboardAside}>
          <section className={styles.panel}>
            <div className={styles.panelHeaderRow}>
              <div>
                <div className={styles.panelHeader}>Recent products</div>
                <div className={styles.panelSubhead}>Latest catalog activity</div>
              </div>
              <span className={styles.countBadge}>{Math.min(products.length, 8)}</span>
            </div>
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
                    onClick={() =>
                      shopify.intents.invoke?.("edit:shopify/Product", {
                        value: product.id,
                      })
                    }
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

export function BulkProducts({ view = "dashboard" }: { view?: BulkManagerView }) {
  const {
    products,
    productCount,
    activeProductCount,
    draftProductCount,
    collections,
    collectionCount,
    locations,
  } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";
  const hasLocations = locations.length > 0;
  const historyKey = `mh-bulk-manager-history-${view}`;
  const [historyFiles, setHistoryFiles] = useState<UpdateHistoryFile[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<BulkJobStatus | null>(null);
  const recordedJobIds = useRef(new Set<string>());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      setHistoryFiles(JSON.parse(window.localStorage.getItem(historyKey) || "[]"));
    } catch {
      setHistoryFiles([]);
    }
  }, [historyKey]);

  useEffect(() => {
    if (fetcher.data && "job" in fetcher.data && fetcher.data.job) {
      setActiveJobId(fetcher.data.job.id);
      setActiveJob(fetcher.data.job as BulkJobStatus);
      shopify.toast.show("Bulk job started");
      return;
    }

    if (fetcher.data && "result" in fetcher.data && fetcher.data.result) {
      shopify.toast.show("Bulk action completed");
    }

    if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (!activeJobId) {
      return;
    }

    let cancelled = false;

    const loadJob = async () => {
      try {
        const token = await (shopify as unknown as { idToken?: () => Promise<string> }).idToken?.();
        const response = await fetch(`/app/jobs/${activeJobId}`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (!response.ok) {
          throw new Error(`Job status failed (${response.status}).`);
        }

        const job = (await response.json()) as BulkJobStatus;

        if (!cancelled) {
          setActiveJob(job);
        }
      } catch (error) {
        if (!cancelled) {
          setActiveJob((current) =>
            current
              ? {
                  ...current,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Unable to load job status.",
                }
              : current,
          );
        }
      }
    };

    loadJob();
    const interval = window.setInterval(() => {
      if (!["completed", "failed"].includes(activeJob?.status || "")) {
        loadJob();
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeJobId, activeJob?.status, shopify]);

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle" || view === "dashboard") {
      return;
    }

    const rows = getResultRows(fetcher.data);

    if (!rows.length) {
      return;
    }

    const file: UpdateHistoryFile = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      intent: String(fetcher.data.intent || view),
      label: viewContent[view]?.title || String(fetcher.data.intent || "Bulk action"),
      status: getResultStatus(rows, fetcher.data),
      createdAt: new Date().toISOString(),
      rows,
    };

    setHistoryFiles((current) => {
      const next = [file, ...current].slice(0, 6);

      try {
        window.localStorage.setItem(historyKey, JSON.stringify(next));
      } catch {
        // Browser storage can be unavailable in private sessions.
      }

      return next;
    });
  }, [fetcher.data, fetcher.state, historyKey, view]);

  useEffect(() => {
    if (
      !activeJob ||
      !["completed", "failed"].includes(activeJob.status) ||
      recordedJobIds.current.has(activeJob.id) ||
      view === "dashboard"
    ) {
      return;
    }

    const data = {
      intent: activeJob.intent,
      result: activeJob.result,
      error: activeJob.error,
    };
    const rows = getResultRows(data);

    if (!rows.length) {
      return;
    }

    recordedJobIds.current.add(activeJob.id);

    const file: UpdateHistoryFile = {
      id: activeJob.id,
      intent: activeJob.intent,
      label: viewContent[view]?.title || activeJob.intent,
      status: getResultStatus(rows, data),
      createdAt: activeJob.completedAt || new Date().toISOString(),
      rows,
    };

    setHistoryFiles((current) => {
      const next = [file, ...current.filter((item) => item.id !== file.id)].slice(
        0,
        6,
      );

      try {
        window.localStorage.setItem(historyKey, JSON.stringify(next));
      } catch {
        // Browser storage can be unavailable in private sessions.
      }

      return next;
    });

    shopify.toast.show(
      activeJob.status === "completed"
        ? "Bulk job completed"
        : "Bulk job failed",
      { isError: activeJob.status === "failed" },
    );
  }, [activeJob, historyKey, shopify, view]);

  if (view === "dashboard") {
    return (
      <s-page heading="MH Bulk Manager">
        <div className={styles.shell}>
          <Dashboard
            products={products}
            productCount={productCount}
            activeProductCount={activeProductCount}
            draftProductCount={draftProductCount}
            collections={collections}
            collectionCount={collectionCount}
            locations={locations}
            shopify={shopify}
          />
        </div>
      </s-page>
    );
  }

  const page = viewContent[view];

  return (
    <s-page heading={page.title}>
      <div className={styles.shell}>
        <div className={styles.toolPageHeader}>
          <div className={styles.titleBlock}>
            <Link className={styles.backLink} to="/app">&larr; Dashboard</Link>
            <div className={styles.eyebrow}>{page.eyebrow}</div>
            <h1 className={styles.title}>{page.title}</h1>
            <p className={styles.subtitle}>{page.description}</p>
          </div>
          <div className={styles.stepStrip}>
            <span><b>1</b> Download</span>
            <span><b>2</b> Edit Excel</span>
            <span><b>3</b> Upload &amp; apply</span>
          </div>
        </div>

        <div className={styles.layout}>
          <div className={styles.toolGrid}>
            {view === "create-products" && <ToolCard
              id="create-products"
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
            </ToolCard>}

            {view === "bulk-delete-status" && <ToolCard
              id="bulk-delete-status"
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
            </ToolCard>}

            {view === "update-prices" && <ToolCard
              id="update-prices"
              title="Update prices"
              badges={["variants", "price", "SKU"]}
            >
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
            </ToolCard>}

            {view === "update-stock" && <ToolCard
              id="update-stock"
              title="Update stock"
              badges={["inventory", "location"]}
            >
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
            </ToolCard>}

            {view === "bulk-images" && <ToolCard
              id="bulk-images"
              title="Bulk image update"
              badges={["barcode", "current images", "7 new images"]}
            >
              <fetcher.Form method="post" encType="multipart/form-data">
                <input type="hidden" name="intent" value="bulk-images" />
                <div className={styles.toolBody}>
                  <TemplateUpload template="bulk-images" fileName="imagesFile" />
                  <div className={styles.warning}>
                    Add public image URLs in the New image columns. Shopify will
                    attach those images to the matching product barcode.
                  </div>
                  <details className={styles.details}>
                    <summary>JSON fallback</summary>
                    <textarea
                      className={styles.textarea}
                      name="productImages"
                      defaultValue="[]"
                    />
                  </details>
                  <div className={styles.actions}>
                    <button
                      className={styles.primaryButton}
                      type="submit"
                      disabled={isSubmitting}
                    >
                      Update images
                    </button>
                  </div>
                </div>
              </fetcher.Form>
            </ToolCard>}

          </div>

          <aside className={styles.sidePanel}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>Update files</div>
              <div className={styles.panelBody}>
                {activeJob && (
                  <div className={styles.jobCard}>
                    <div className={styles.jobHeader}>
                      <div>
                        <div className={styles.productTitle}>
                          {viewContent[view]?.title || activeJob.intent}
                        </div>
                        <div className={styles.productMeta}>
                          {activeJob.status} | {activeJob.message || "Working"}
                        </div>
                      </div>
                      <strong>{Math.max(0, Math.min(100, activeJob.progress))}%</strong>
                    </div>
                    <div className={styles.progressTrack}>
                      <span
                        className={styles.progressBar}
                        style={{
                          width: `${Math.max(0, Math.min(100, activeJob.progress))}%`,
                        }}
                      />
                    </div>
                    <div className={styles.productMeta}>
                      Rows: {activeJob.totalRows.toLocaleString()}
                    </div>
                  </div>
                )}
                {historyFiles.length === 0 && (
                  <div className={styles.emptyHistory}>
                    Result files will appear here after an upload finishes.
                  </div>
                )}
                {historyFiles.map((file) => (
                  <div className={styles.historyRow} key={file.id}>
                    <div>
                      <div className={styles.productTitle}>{file.label}</div>
                      <div className={styles.productMeta}>
                        {file.status === "success" ? "Successful file" : "Error file"} |{" "}
                        {new Date(file.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className={styles.editButton}
                      type="button"
                      onClick={() => downloadResultFile(file)}
                    >
                      Download
                    </button>
                  </div>
                ))}
                {historyFiles.length > 0 && (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => {
                      setHistoryFiles([]);
                      window.localStorage.removeItem(historyKey);
                    }}
                  >
                    Clear history
                  </button>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export default function DashboardPage() {
  return <BulkProducts view="dashboard" />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
