import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getStockTemplateRows,
  STOCK_TEMPLATE_HEADERS,
} from "../models/bulk-products.server";
import {
  createWorkbookFromRows,
  createTemplateWorkbook,
  templateDefinitions,
  type TemplateKey,
} from "../models/bulk-spreadsheets.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const template = params.template as TemplateKey;

  if (!templateDefinitions[template]) {
    throw new Response("Template not found", { status: 404 });
  }

  const workbook =
    template === "update-stock"
      ? await createStockTemplateWorkbook(request)
      : createTemplateWorkbook(template);

  return new Response(workbook.buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${workbook.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
};

async function createStockTemplateWorkbook(request: Request) {
  const { admin } = await authenticate.admin(request);

  return createWorkbookFromRows({
    fileName: templateDefinitions["update-stock"].fileName,
    sheetName: templateDefinitions["update-stock"].sheetName,
    rows: await getStockTemplateRows(admin),
    headers: STOCK_TEMPLATE_HEADERS,
    hiddenColumns: ["Inventory item ID"],
  });
}
