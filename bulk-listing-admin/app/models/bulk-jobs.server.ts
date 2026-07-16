import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  addProductsToCollection,
  applyProductActions,
  createProducts,
  resolveStatusRowsProductIds,
  updateInventoryQuantities,
  updateProductImages,
  updateProductStatuses,
  updateVariantPrices,
  type ProductActionRow,
  type ProductImageRow,
  type ProductRow,
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

const activeJobs = new Set<string>();

function rowCount(payload: BulkJobPayload) {
  return payload.rows?.length || payload.productIds?.length || 0;
}

export async function createBulkJob({
  shop,
  intent,
  payload,
}: {
  shop: string;
  intent: string;
  payload: BulkJobPayload;
}) {
  const job = await prisma.bulkJob.create({
    data: {
      shop,
      intent,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      totalRows: rowCount(payload),
      message: "Waiting to start.",
    },
  });

  startBulkJob(job.id);

  return job;
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

    await prisma.bulkJob.update({
      where: { id },
      data: {
        status: "completed",
        progress: 100,
        processedRows: job.totalRows,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
        completedAt: new Date(),
        message: "Completed.",
      },
    });
  } catch (error) {
    await prisma.bulkJob.update({
      where: { id },
      data: {
        status: "failed",
        progress: 100,
        error: error instanceof Error ? error.message : "Bulk job failed.",
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
