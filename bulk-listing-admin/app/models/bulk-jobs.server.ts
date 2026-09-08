import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  addProductsToCollection,
  applyProductActions,
  createBulkVariations,
  createProducts,
  resolveStatusRowsProductIds,
  updateInventoryQuantities,
  updateProductImages,
  updateProductStatuses,
  updateVariantPrices,
  type ProductActionRow,
  type ProductImageRow,
  type ProductRow,
  type VariationRow,
  type VariantUpdateRow,
} from "./bulk-products.server";

type BulkJobPayload = {
  rows?: unknown[];
  productIds?: string[];
  statusGroups?: Record<string, string[]>;
  collectionId?: string;
  locationId?: string;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
};

type RowCounts = {
  successRows: number;
  failedRows: number;
};

const activeJobs = new Set<string>();
const statusPriority: Record<"ACTIVE" | "DRAFT" | "ARCHIVED", number> = {
  DRAFT: 1,
  ACTIVE: 2,
  ARCHIVED: 3,
};

function rowCount(payload: BulkJobPayload) {
  return payload.rows?.length || payload.productIds?.length || 0;
}

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSuccessfulRow(row: unknown) {
  if (!row || typeof row !== "object") {
    return false;
  }

  const value = row as Record<string, unknown>;

  if (typeof value.success === "boolean") {
    return value.success;
  }

  const status = String(value.status || value.Status || "").toLowerCase();

  if (status.includes("error") || status.includes("failed")) {
    return false;
  }

  return status.includes("success") || status.includes("warning");
}

function countBooleanRows(rows: unknown[]): RowCounts {
  return rows.reduce<RowCounts>(
    (counts, row) => {
      if (isSuccessfulRow(row)) {
        counts.successRows += 1;
      } else {
        counts.failedRows += 1;
      }

      return counts;
    },
    { successRows: 0, failedRows: 0 },
  );
}

function summarizeJobResult(
  totalRows: number,
  result: unknown,
  error?: string,
): RowCounts {
  if (error) {
    return { successRows: 0, failedRows: totalRows };
  }

  if (!result || typeof result !== "object") {
    return { successRows: totalRows, failedRows: 0 };
  }

  const value = result as Record<string, any>;

  if (Array.isArray(value.reportRows)) {
    return value.reportRows.reduce(
      (counts: { successRows: number; failedRows: number }, row: any) => {
        const status = String(row.status || "").toLowerCase();

        if (status === "success" || status === "warning") {
          counts.successRows += 1;
        } else {
          counts.failedRows += 1;
        }

        return counts;
      },
      { successRows: 0, failedRows: 0 },
    );
  }

  if (value.stock || value.statuses) {
    const stockSuccess = Math.max(
      0,
      numericValue(value.stock?.updatedRows) - numericValue(value.stock?.failedRows),
    );
    const stockFailed = numericValue(value.stock?.failedRows);
    const statusCounts: RowCounts = Array.isArray(value.statuses)
      ? countBooleanRows(value.statuses.flat())
      : { successRows: 0, failedRows: 0 };

    return {
      successRows: stockSuccess + statusCounts.successRows,
      failedRows: stockFailed + statusCounts.failedRows,
    };
  }

  if (value.summary) {
    const summary = value.summary as Record<string, unknown>;
    const successRows =
      numericValue(summary.success) ||
      numericValue(summary.variants) ||
      numericValue(summary.products);
    const failedRows =
      numericValue(summary.error) ||
      numericValue(summary.errors) ||
      numericValue(summary.failed);

    return { successRows, failedRows };
  }

  if (Array.isArray(value.rows)) {
    return countBooleanRows(value.rows);
  }

  if (Array.isArray(result)) {
    return countBooleanRows(result.flat());
  }

  if (Array.isArray(value.errors) && value.errors.length > 0) {
    const failedRows = value.errors.reduce(
      (count: number, row: Record<string, unknown>) =>
        count + numericValue(row.rows || row.variants || 1),
      0,
    );

    return { successRows: Math.max(0, totalRows - failedRows), failedRows };
  }

  return { successRows: totalRows, failedRows: 0 };
}

function rowsFromPayload(payload: BulkJobPayload) {
  if (Array.isArray(payload.rows)) {
    return payload.rows;
  }

  if (Array.isArray(payload.productIds)) {
    return payload.productIds.map((productId) => ({ productId }));
  }

  if (payload.statusGroups) {
    return Object.entries(payload.statusGroups).flatMap(([status, productIds]) =>
      productIds.map((productId) => ({ productId, action: status })),
    );
  }

  return [];
}

function failureResultForPayload(
  intent: string,
  payload: BulkJobPayload,
  message: string,
) {
  const sourceRows = rowsFromPayload(payload);
  const rows =
    sourceRows.length > 0
      ? sourceRows.map((row, index) => ({
          Row: index + 2,
          Intent: intent,
          ...(row && typeof row === "object"
            ? (row as Record<string, unknown>)
            : { Value: row }),
          Status: "Error",
          Message: message,
        }))
      : [
          {
            Row: "",
            Intent: intent,
            Status: "Error",
            Message: message,
          },
        ];

  return {
    rows,
    summary: {
      total: rows.length,
      success: 0,
      error: rows.length,
      message,
    },
  };
}

function desiredStockStatus(row: VariantUpdateRow) {
  if (row.productStatus) {
    return row.productStatus;
  }

  if (row.quantity === undefined) {
    return undefined;
  }

  return row.quantity > 0 ? "ACTIVE" : "DRAFT";
}

export async function createBulkJob({
  shop,
  intent,
  payload,
  fileName,
  uploadedBy,
}: {
  shop: string;
  intent: string;
  payload: BulkJobPayload;
  fileName?: string;
  uploadedBy?: string;
}) {
  const job = await prisma.bulkJob.create({
    data: {
      shop,
      intent,
      fileName,
      uploadedBy,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      totalRows: rowCount(payload),
      message: "Waiting to start.",
    },
  });

  startBulkJob(job.id);

  return job;
}

export async function recordFailedBulkJob({
  shop,
  intent,
  fileName,
  uploadedBy,
  error,
}: {
  shop: string;
  intent: string;
  fileName?: string;
  uploadedBy?: string;
  error: string;
}) {
  const result = failureResultForPayload(intent, {}, error);

  return prisma.bulkJob.create({
    data: {
      shop,
      intent,
      fileName,
      uploadedBy,
      status: "failed",
      progress: 100,
      totalRows: 0,
      processedRows: 0,
      successRows: 0,
      failedRows: 0,
      payload: {},
      result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
      error,
      message: "Failed before processing.",
      completedAt: new Date(),
    },
  });
}

export async function getRecentBulkJobs(shop: string, intent?: string, take = 10) {
  return prisma.bulkJob.findMany({
    where: {
      shop,
      ...(intent ? { intent } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      intent: true,
      fileName: true,
      uploadedBy: true,
      status: true,
      totalRows: true,
      processedRows: true,
      successRows: true,
      failedRows: true,
      message: true,
      error: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
}

export async function getBulkJob(shop: string, id: string) {
  const job = await prisma.bulkJob.findFirst({
    where: { id, shop },
  });

  if (job?.status === "queued") {
    startBulkJob(job.id);
  }

  return job;
}

export function startBulkJob(id: string) {
  if (activeJobs.has(id)) {
    return;
  }

  activeJobs.add(id);
  setTimeout(() => {
    processBulkJob(id).finally(() => activeJobs.delete(id));
  }, 0);
}

async function updateJobProgress(
  id: string,
  progress: number,
  message: string,
  processedRows?: number,
) {
  await prisma.bulkJob.update({
    where: { id },
    data: {
      progress,
      message,
      ...(processedRows === undefined ? {} : { processedRows }),
    },
  });
}

async function processBulkJob(id: string) {
  const job = await prisma.bulkJob.findUnique({ where: { id } });

  if (!job || job.status === "completed" || job.status === "failed") {
    return;
  }

  await prisma.bulkJob.update({
    where: { id },
    data: {
      status: "running",
      progress: 5,
      startedAt: new Date(),
      message: "Connecting to Shopify.",
    },
  });

  try {
    const { admin } = await unauthenticated.admin(job.shop);
    const payload = job.payload as BulkJobPayload;

    await updateJobProgress(id, 15, "Processing uploaded rows.");

    const result = await runBulkJobIntent(admin, job.intent, payload, async (
      progress,
      message,
    ) => updateJobProgress(id, progress, message));
    const counts = summarizeJobResult(job.totalRows, result);

    await prisma.bulkJob.update({
      where: { id },
      data: {
        status: "completed",
        progress: 100,
        processedRows: job.totalRows,
        successRows: counts.successRows,
        failedRows: counts.failedRows,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
        completedAt: new Date(),
        message: "Completed.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk job failed.";
    const payload = job.payload as BulkJobPayload;
    const result = failureResultForPayload(job.intent, payload, message);
    const counts = summarizeJobResult(job.totalRows, result, message);

    await prisma.bulkJob.update({
      where: { id },
      data: {
        status: "failed",
        progress: 100,
        processedRows: job.totalRows,
        successRows: counts.successRows,
        failedRows: counts.failedRows,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
        error: message,
        completedAt: new Date(),
        message: "Failed.",
      },
    });
  }
}

async function runBulkJobIntent(
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"],
  intent: string,
  payload: BulkJobPayload,
  progress: (progress: number, message: string) => Promise<void>,
) {
  if (intent === "create-products") {
    await progress(25, "Creating products in Shopify.");
    return createProducts(
      admin,
      (payload.rows || []) as ProductRow[],
      payload.locationId || "",
    );
  }

  if (intent === "update-prices") {
    await progress(25, "Updating prices in Shopify.");
    return updateVariantPrices(admin, (payload.rows || []) as VariantUpdateRow[]);
  }

  if (intent === "bulk-delete") {
    await progress(25, "Applying status/delete actions.");
    return applyProductActions(admin, (payload.rows || []) as ProductActionRow[]);
  }

  if (intent === "bulk-images") {
    await progress(25, "Updating product images.");
    return updateProductImages(admin, (payload.rows || []) as ProductImageRow[]);
  }

  if (intent === "bulk-variations") {
    await progress(25, "Creating parent variation products.");
    return createBulkVariations(admin, (payload.rows || []) as VariationRow[]);
  }

  if (intent === "update-stock") {
    const rows = (payload.rows || []) as VariantUpdateRow[];
    const stockRows = rows.filter(
      (row) => row.inventoryItemId && row.quantity !== undefined,
    );
    await progress(25, "Updating stock quantities.");
    const stockResult =
      stockRows.length > 0
        ? await updateInventoryQuantities(admin, stockRows, payload.locationId || "", async (done, total) =>
            progress(25 + Math.floor(40 * done / total), `Processed stock for ${done} of ${total} rows.`))
        : {
            batches: 0,
            results: [],
            errors: [],
            rowResults: [],
            updatedRows: 0,
            failedRows: 0,
            skipped: "No New stock values were provided.",
          };
    await progress(70, "Updating product statuses.");
    const resolvedStatusRows = await resolveStatusRowsProductIds(admin, rows);
    const stockOutcomes = new Map(stockResult.rowResults.map((row) => [row.inventoryItemId, row]));
    const stockFailed = (row: VariantUpdateRow) => row.quantity !== undefined &&
      stockOutcomes.get(row.inventoryItemId)?.success !== true;
    const blockedProducts = new Set(resolvedStatusRows.filter(stockFailed).map((row) => row.productId).filter(Boolean));
    const statusPlans = new Map<
      string,
      { status: "ACTIVE" | "DRAFT" | "ARCHIVED"; rows: VariantUpdateRow[] }
    >();

    for (const row of resolvedStatusRows) {
      const status = desiredStockStatus(row);

      if (!row.productId || !status || stockFailed(row) || blockedProducts.has(row.productId)) {
        continue;
      }

      const existing = statusPlans.get(row.productId);

      if (!existing || statusPriority[status] > statusPriority[existing.status]) {
        statusPlans.set(row.productId, { status, rows: [...(existing?.rows || []), row] });
      } else {
        existing.rows.push(row);
      }
    }

    const statusGroups = Array.from(statusPlans.entries()).reduce<
      Record<"ACTIVE" | "DRAFT" | "ARCHIVED", string[]>
    >(
      (groups, [productId, plan]) => {
        groups[plan.status].push(productId);
        return groups;
      },
      { ACTIVE: [], DRAFT: [], ARCHIVED: [] },
    );
    const statusResult = [];
    let completedStatuses = 0;
    const missingStatusRows = resolvedStatusRows.filter(
      (row) => desiredStockStatus(row) && !row.productId,
    );

    for (const [status, productIds] of Object.entries(statusGroups)) {
      const uniqueProductIds = Array.from(new Set(productIds));

      if (uniqueProductIds.length > 0) {
        statusResult.push(
          await updateProductStatuses(
            admin,
            uniqueProductIds,
            status as "ACTIVE" | "DRAFT" | "ARCHIVED",
            async (done) => progress(70 + Math.floor(25 * (completedStatuses + done) / Math.max(1, statusPlans.size)),
              `Processed status for ${completedStatuses + done} of ${statusPlans.size} products.`),
          ),
        );
        completedStatuses += uniqueProductIds.length;
      }
    }

    const statusOutcomes = new Map(
      statusResult.flat().map((row) => [row.productId, row]),
    );

    return {
      stock: stockResult,
      reportRows: resolvedStatusRows.map((row, index) => {
        const stock = stockOutcomes.get(row.inventoryItemId);
        const status = desiredStockStatus(row);
        const messages: string[] = [];
        let success = true;
        if (row.quantity !== undefined) {
          success = stock?.success === true;
          messages.push(stock?.message || "Stock was not updated: no matching inventory item was found.");
        }
        if (status) {
          if (stockFailed(row) || blockedProducts.has(row.productId)) {
            success = false;
            messages.push("Product status was not changed because a stock update for this product failed.");
          } else if (!row.productId) {
            success = false;
            messages.push("Could not find a Shopify product for this barcode.");
          } else {
            const outcome = statusOutcomes.get(row.productId);
            success = success && outcome?.success === true;
            messages.push(outcome?.message || "Shopify did not confirm the status update.");
          }
        }
        return {
          row: index + 2,
          sku: row.sku || "",
          barcode: row.barcode || "",
          productId: row.productId || "",
          inventoryItemId: row.inventoryItemId || "",
          quantity: row.quantity,
          requestedStatus: status || "",
          status: success ? "Success" : "Error",
          message: messages.join(" "),
        };
      }),
      statuses: [
        missingStatusRows.map((row) => ({
          productId: "",
          barcode: row.barcode || "",
          action: desiredStockStatus(row),
          success: false,
          message: "Could not find a Shopify product for this barcode.",
        })),
        Array.from(statusPlans.entries()).map(([productId, plan]) => ({
          operation: "Stock status rule",
          productId,
          barcode: plan.rows.map((row) => row.barcode).filter(Boolean).join(", "),
          sku: plan.rows.map((row) => row.sku).filter(Boolean).join(", "),
          quantity: plan.rows
            .map((row) => row.quantity)
            .filter((value) => value !== undefined)
            .join(", "),
          action: plan.status,
          success: statusOutcomes.get(productId)?.success ?? false,
          message: statusOutcomes.get(productId)?.message || "Status update result missing.",
        })),
      ].filter((group) => Array.isArray(group) && group.length > 0),
    };
  }

  if (intent === "update-status") {
    await progress(25, "Updating product statuses.");
    if (payload.statusGroups) {
      const result = [];

      for (const [status, productIds] of Object.entries(payload.statusGroups)) {
        result.push(
          await updateProductStatuses(
            admin,
            productIds,
            status as "ACTIVE" | "DRAFT" | "ARCHIVED",
          ),
        );
      }

      return result;
    }

    return updateProductStatuses(
      admin,
      payload.productIds || [],
      payload.status || "DRAFT",
    );
  }

  if (intent === "add-to-collection") {
    await progress(25, "Adding products to collection.");
    return addProductsToCollection(
      admin,
      payload.collectionId || "",
      payload.productIds || [],
    );
  }

  throw new Error("Unknown bulk action.");
}
