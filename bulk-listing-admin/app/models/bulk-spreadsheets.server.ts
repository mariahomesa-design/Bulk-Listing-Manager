import * as XLSX from "xlsx";

export type TemplateKey =
  | "create-products"
  | "update-status"
  | "update-prices"
  | "update-stock"
  | "add-to-collection";

type TemplateDefinition = {
  fileName: string;
  sheetName: string;
  rows: Record<string, string | number>[];
};

export const templateDefinitions: Record<TemplateKey, TemplateDefinition> = {
  "create-products": {
    fileName: "bulk-create-products-template.xlsx",
    sheetName: "Create products",
    rows: [
      {
        title: "Cotton T-Shirt",
        descriptionHtml: "<p>Soft cotton shirt</p>",
        vendor: "MARIA HOMES",
        productType: "Apparel",
        status: "DRAFT",
        price: "19.99",
        sku: "TEE-001",
        quantity: 20,
      },
    ],
  },
  "update-status": {
    fileName: "bulk-update-status-template.xlsx",
    sheetName: "Update status",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890",
        status: "ACTIVE",
      },
    ],
  },
  "update-prices": {
    fileName: "bulk-update-prices-template.xlsx",
    sheetName: "Update prices",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890",
        variantId: "gid://shopify/ProductVariant/1234567890",
        price: "29.99",
        sku: "SKU-001",
      },
    ],
  },
  "update-stock": {
    fileName: "bulk-update-stock-template.xlsx",
    sheetName: "Update stock",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890",
        variantId: "gid://shopify/ProductVariant/1234567890",
        inventoryItemId: "gid://shopify/InventoryItem/1234567890",
        quantity: 12,
      },
    ],
  },
  "add-to-collection": {
    fileName: "bulk-add-to-collection-template.xlsx",
    sheetName: "Add to collection",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890",
      },
    ],
  },
};

export function createTemplateWorkbook(templateKey: TemplateKey) {
  const template = templateDefinitions[templateKey];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(template.rows);

  XLSX.utils.book_append_sheet(workbook, worksheet, template.sheetName);

  return {
    fileName: template.fileName,
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  };
}

export async function parseWorkbookRows<T>(
  file: FormDataEntryValue | null,
): Promise<T[]> {
  if (!(file instanceof File) || file.size === 0) {
    return [];
  }

  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array" });
  const firstSheet = workbook.SheetNames[0];

  if (!firstSheet) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheet];

  return XLSX.utils.sheet_to_json<T>(worksheet, {
    defval: "",
    raw: false,
  });
}

export function normalizeStringArrayRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => String(row.productId || "").trim())
    .filter(Boolean);
}

