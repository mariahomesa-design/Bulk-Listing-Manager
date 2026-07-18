import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  BULK_DELETE_TEMPLATE_HEADERS,
  getBulkDeleteTemplateRows,
  getImageTemplateRows,
  getPriceTemplateRows,
  getStockTemplateRows,
  IMAGE_TEMPLATE_HEADERS,
  PRICE_TEMPLATE_HEADERS,
  STOCK_TEMPLATE_HEADERS,
  VARIATION_TEMPLATE_HEADERS,
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
      : template === "update-prices"
        ? await createPriceTemplateWorkbook(request)
      : template === "bulk-images"
        ? await createImageTemplateWorkbook(request)
      : template === "bulk-delete"
        ? await createBulkDeleteTemplateWorkbook(request)
      : template === "bulk-variations"
        ? await createVariationTemplateWorkbook()
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

async function createImageTemplateWorkbook(request: Request) {
  const { admin } = await authenticate.admin(request);

  return createWorkbookWithDropdownsFromRows({
    fileName: templateDefinitions["bulk-images"].fileName,
    sheetName: templateDefinitions["bulk-images"].sheetName,
    rows: await getImageTemplateRows(admin),
    headers: IMAGE_TEMPLATE_HEADERS,
    hiddenColumns: ["Product ID"],
    dropdowns: {},
  });
}

async function createPriceTemplateWorkbook(request: Request) {
  const { admin } = await authenticate.admin(request);

  return createWorkbookWithDropdownsFromRows({
    fileName: templateDefinitions["update-prices"].fileName,
    sheetName: templateDefinitions["update-prices"].sheetName,
    rows: await getPriceTemplateRows(admin),
    headers: PRICE_TEMPLATE_HEADERS,
    hiddenColumns: ["Variant ID", "Product ID"],
    dropdowns: {},
  });
}

async function createBulkDeleteTemplateWorkbook(request: Request) {
  const { admin } = await authenticate.admin(request);

  return createWorkbookWithDropdownsFromRows({
    fileName: templateDefinitions["bulk-delete"].fileName,
    sheetName: templateDefinitions["bulk-delete"].sheetName,
    rows: await getBulkDeleteTemplateRows(admin),
    headers: BULK_DELETE_TEMPLATE_HEADERS,
    hiddenColumns: ["Product ID"],
    dropdowns: {
      Action: ["Active", "Draft", "Unlist", "Delete"],
    },
  });
}

function createVariationTemplateWorkbook() {
  return createWorkbookWithDropdownsFromRows({
    fileName: templateDefinitions["bulk-variations"].fileName,
    sheetName: templateDefinitions["bulk-variations"].sheetName,
    rows: templateDefinitions["bulk-variations"].rows,
    headers: VARIATION_TEMPLATE_HEADERS,
    dropdowns: {
      "Option 1 Name": ["Color", "Size", "Set"],
      "Option 2 Name": ["Color", "Size", "Set"],
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
      Publish: ["TRUE", "FALSE"],
      "Charge tax": ["TRUE", "FALSE"],
      "Inventory tracker": ["shopify", ""],
      "Continue selling when out of stock": ["TRUE", "FALSE"],
    },
    dropdownSources: {
      "Product category": shopifyCategoryOptions.map((category) => category.label),
    },
  });
}
