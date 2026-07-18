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
    const counts = summarizeJobResult(job.totalRows, null, message);

    await prisma.bulkJob.update({
      where: { id },
      data: {
        status: "failed",
        progress: 100,
        processedRows: 0,
        successRows: counts.successRows,
        failedRows: counts.failedRows,
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
        ? await updateInventoryQuantities(admin, stockRows, payload.locationId || "")
        : {
            batches: 0,
            results: [],
            errors: [],
            updatedRows: 0,
            failedRows: 0,
            skipped: "No New stock values were provided.",
          };
    await progress(70, "Updating product statuses.");
    const resolvedStatusRows = await resolveStatusRowsProductIds(admin, rows);
    const statusGroups = resolvedStatusRows.reduce<
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
    const missingStatusRows = resolvedStatusRows.filter(
      (row) => row.productStatus && !row.productId,
    );

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
      stock: stockResult,
      statuses: [
        ...statusResult,
        missingStatusRows.map((row) => ({
          productId: "",
          barcode: row.barcode || "",
          action: row.productStatus,
          success: false,
          message: "Could not find a Shopify product for this barcode.",
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
