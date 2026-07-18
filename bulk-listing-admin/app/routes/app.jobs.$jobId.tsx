import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getBulkJob } from "../models/bulk-jobs.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId || "";
  const job = await getBulkJob(session.shop, jobId);

  if (!job) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  return Response.json({
    id: job.id,
    intent: job.intent,
    fileName: job.fileName,
    uploadedBy: job.uploadedBy,
    status: job.status,
    progress: job.progress,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    successRows: job.successRows,
    failedRows: job.failedRows,
    message: job.message,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
};
