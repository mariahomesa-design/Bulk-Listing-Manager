import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import shopifyProductCategories from "../data/shopify-product-categories.json";

export type ShopifyProductCategory = {
  id: string;
  name: string;
  label: string;
};

export const shopifyCategoryOptions =
  shopifyProductCategories as ShopifyProductCategory[];

export type TemplateKey =
  | "create-products"
  | "bulk-delete"
  | "bulk-images"
  | "bulk-variations"
  | "update-prices"
  | "update-stock"
  | "add-to-collection"
  | "update-status";

type TemplateDefinition = {
  fileName: string;
  sheetName: string;
  rows: Record<string, string | number | boolean>[];
};

export const templateDefinitions: Record<TemplateKey, TemplateDefinition> = {
  "create-products": {
    fileName: "bulk-create-products-template.xlsx",
    sheetName: "Create products",
    rows: [
      {
        Title: "Dining Table",
        Description: "<p>Modern dining table</p>",
        Vendor: "MARIA HOMES",
        "Product category": "Furniture > Tables",
        Publish: "TRUE",
        Status: "DRAFT",
        SKU: "TABLE-001",
        Barcode: "1234567890123",
        "Option1 name": "Size",
        "Option1 value": "Medium",
        "Option1 Linked To": "",
        "Option2 name": "Color",
        "Option2 value": "White",
        Price: "19.99",
        "Compare-at price": "24.99",
        "Cost per item": "9.50",
        "Charge tax": "TRUE",
        "Inventory tracker": "shopify",
        "Inventory quantity": 20,
        "Continue selling when out of stock": "FALSE",
        "Fulfillment service": "manual",
        "Image Link 1": "https://example.com/product-image-1.jpg",
        "Image Link 2": "",
        "Image Link 3": "",
        "Image Link 4": "",
        "Image Link 5": "",
        "Image Link 6": "",
        "Image Link 7": "",
      },
    ],
  },
  "bulk-delete": {
    fileName: "bulk-delete-status-template.xlsx",
    sheetName: "Bulk delete",
    rows: [
      {
        Barcode: "1234567890123",
        Action: "",
        "Product ID": "gid://shopify/Product/1234567890",
      },
    ],
  },
  "bulk-images": {
    fileName: "bulk-image-update-template.xlsx",
    sheetName: "Bulk images",
    rows: [
      {
        Barcode: "1234567890123",
        "Existing image 1": "https://example.com/current-image.jpg",
        "New image 1": "https://example.com/new-image-1.jpg",
        "New image 2": "",
        "New image 3": "",
        "New image 4": "",
        "New image 5": "",
        "New image 6": "",
        "New image 7": "",
        "Product ID": "gid://shopify/Product/1234567890",
      },
    ],
  },
  "bulk-variations": {
    fileName: "bulk-variation-manager-template.xlsx",
    sheetName: "Bulk variations",
    rows: [
      {
        "Parent SKU": "ZH-808",
        Barcode: "30801011",
      },
      {
        "Parent SKU": "ZH-808",
        Barcode: "30801012",
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
        "Product title": "Cotton T-Shirt",
        "Variant title": "Medium / White",
        SKU: "TEE-001",
        Barcode: "1234567890123",
        "Current stock": 20,
        "New stock": "",
        "Current status": "Active",
        Status: "",
        "Inventory item ID": "gid://shopify/InventoryItem/1234567890",
        "Product ID": "gid://shopify/Product/1234567890",
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

  return createWorkbookFromRows({
    fileName: template.fileName,
    sheetName: template.sheetName,
    rows: template.rows,
  });
}

export function createWorkbookFromRows({
  fileName,
  sheetName,
  rows,
  headers,
  hiddenColumns = [],
}: {
  fileName: string;
  sheetName: string;
  rows: Record<string, string | number | boolean>[];
  headers?: string[];
  hiddenColumns?: string[];
}) {
  const workbook = XLSX.utils.book_new();
  const resolvedHeaders =
    headers ||
    Array.from(
      rows.reduce((keys, row) => {
        Object.keys(row).forEach((key) => keys.add(key));
        return keys;
      }, new Set<string>()),
    );
  const worksheetRows =
    rows.length > 0
      ? rows
      : [Object.fromEntries(resolvedHeaders.map((header) => [header, ""]))];
  const worksheet = XLSX.utils.json_to_sheet(worksheetRows, {
    header: resolvedHeaders,
  });

  worksheet["!cols"] = resolvedHeaders.map((header) => ({
    wch: Math.max(14, header.length + 2),
    hidden: hiddenColumns.includes(header),
  }));

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  return {
    fileName,
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  };
}

export async function createWorkbookWithDropdownsFromRows({
  fileName,
  sheetName,
  rows,
  headers,
  dropdowns,
  dropdownSources,
  hiddenColumns = [],
}: {
  fileName: string;
  sheetName: string;
  rows: Record<string, string | number | boolean>[];
  headers: string[];
  dropdowns: Record<string, string[]>;
  dropdownSources?: Record<string, string[]>;
  hiddenColumns?: string[];
}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length + 2),
    hidden: hiddenColumns.includes(header),
  }));

  if (rows.length > 0) {
    worksheet.addRows(rows);
  } else {
    worksheet.addRow(Object.fromEntries(headers.map((header) => [header, ""])));
  }

  for (const [header, values] of Object.entries(dropdowns)) {
    const columnIndex = headers.indexOf(header) + 1;

    if (columnIndex <= 0) {
      continue;
    }

    for (let rowIndex = 2; rowIndex <= Math.max(rows.length + 1, 10000); rowIndex += 1) {
      worksheet.getCell(rowIndex, columnIndex).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${values.join(",")}"`],
        showErrorMessage: true,
        errorTitle: "Choose a status",
        error: `Use one of: ${values.join(", ")}`,
      };
    }
  }

  for (const [header, values] of Object.entries(dropdownSources || {})) {
    const columnIndex = headers.indexOf(header) + 1;

    if (columnIndex <= 0 || values.length === 0) {
      continue;
    }

    const sourceSheetName = `${header.replace(/[^a-z0-9]/gi, "").slice(0, 20)}List`;
    const sourceSheet = workbook.addWorksheet(sourceSheetName, {
      state: "veryHidden",
    });

    values.forEach((value, index) => {
      sourceSheet.getCell(index + 1, 1).value = value;
    });

    const range = `'${sourceSheetName}'!$A$1:$A$${values.length}`;

    for (let rowIndex = 2; rowIndex <= Math.max(rows.length + 1, 10000); rowIndex += 1) {
      worksheet.getCell(rowIndex, columnIndex).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorTitle: `Choose ${header}`,
        error: `Choose a value from the ${header} dropdown.`,
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return {
    fileName,
    buffer: Buffer.from(buffer),
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
