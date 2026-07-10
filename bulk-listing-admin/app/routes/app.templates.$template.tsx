import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getStockTemplateRows,
  STOCK_TEMPLATE_HEADERS,
} from "../models/bulk-products.server";
import {
  createWorkbookWithDropdownsFromRows,
  createTemplateWorkbook,
  shopifyCategoryOptions,
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
      : template === "create-products"
        ? await createProductTemplateWorkbook()
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

  return createWorkbookWithDropdownsFromRows({
    fileName: templateDefinitions["update-stock"].fileName,
    sheetName: templateDefinitions["update-stock"].sheetName,
    rows: await getStockTemplateRows(admin),
    headers: STOCK_TEMPLATE_HEADERS,
    dropdowns: {
      Status: ["Active", "Draft", "Unlist"],
    },
  });
}

async function createProductTemplateWorkbook() {
  return createWorkbookWithDropdownsFromRows({
    fileName: templateDefinitions["create-products"].fileName,
    sheetName: templateDefinitions["create-products"].sheetName,
    rows: templateDefinitions["create-products"].rows,
    headers: Object.keys(templateDefinitions["create-products"].rows[0] || {}),
    dropdowns: {
      Status: ["ACTIVE", "DRAFT", "ARCHIVED"],
      "Published on online store": ["TRUE", "FALSE"],
      "Charge tax": ["TRUE", "FALSE"],
      "Inventory tracker": ["shopify", ""],
      "Continue selling when out of stock": ["TRUE", "FALSE"],
    },
    dropdownSources: {
      "Product category": shopifyCategoryOptions.map((category) => category.label),
    },
  });
}
