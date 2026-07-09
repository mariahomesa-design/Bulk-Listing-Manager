import { jsx, jsxs } from "react/jsx-runtime";
import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, UNSAFE_withComponentProps, Meta, Links, Outlet, ScrollRestoration, Scripts, useLoaderData, useActionData, Form, redirect, UNSAFE_withErrorBoundaryProps, useRouteError, useFetcher } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import "@shopify/shopify-app-react-router/adapters/node";
import { shopifyApp, AppDistribution, ApiVersion, LoginErrorType, boundary } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { useAppBridge } from "@shopify/app-bridge-react";
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}
const prisma = global.prismaGlobal ?? new PrismaClient();
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true
  },
  ...process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}
});
ApiVersion.October25;
const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
const authenticate = shopify.authenticate;
shopify.unauthenticated;
const login = shopify.login;
shopify.registerWebhooks;
shopify.sessionStorage;
const streamTimeout = 5e3;
async function handleRequest(request, responseStatusCode, responseHeaders, reactRouterContext) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(
        ServerRouter,
        {
          context: reactRouterContext,
          url: request.url
        }
      ),
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        }
      }
    );
    setTimeout(abort, streamTimeout + 1e3);
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
const root = UNSAFE_withComponentProps(function App() {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    children: [/* @__PURE__ */ jsxs("head", {
      children: [/* @__PURE__ */ jsx("meta", {
        charSet: "utf-8"
      }), /* @__PURE__ */ jsx("meta", {
        name: "viewport",
        content: "width=device-width,initial-scale=1"
      }), /* @__PURE__ */ jsx("link", {
        rel: "preconnect",
        href: "https://cdn.shopify.com/"
      }), /* @__PURE__ */ jsx("link", {
        rel: "stylesheet",
        href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
      }), /* @__PURE__ */ jsx(Meta, {}), /* @__PURE__ */ jsx(Links, {})]
    }), /* @__PURE__ */ jsxs("body", {
      children: [/* @__PURE__ */ jsx(Outlet, {}), /* @__PURE__ */ jsx(ScrollRestoration, {}), /* @__PURE__ */ jsx(Scripts, {})]
    })]
  });
});
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: root
}, Symbol.toStringTag, { value: "Module" }));
const action$6 = async ({
  request
}) => {
  await authenticate.webhook(request);
  return new Response();
};
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$6
}, Symbol.toStringTag, { value: "Module" }));
const action$5 = async ({
  request
}) => {
  const {
    payload,
    session,
    topic,
    shop
  } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;
  if (session) {
    await prisma.session.update({
      where: {
        id: session.id
      },
      data: {
        scope: current.toString()
      }
    });
  }
  return new Response();
};
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$5
}, Symbol.toStringTag, { value: "Module" }));
const action$4 = async ({
  request
}) => {
  await authenticate.webhook(request);
  return new Response();
};
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$4
}, Symbol.toStringTag, { value: "Module" }));
const action$3 = async ({
  request
}) => {
  const {
    shop,
    session,
    topic
  } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (session) {
    await prisma.session.deleteMany({
      where: {
        shop
      }
    });
  }
  return new Response();
};
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$3
}, Symbol.toStringTag, { value: "Module" }));
const action$2 = async ({
  request
}) => {
  await authenticate.webhook(request);
  return new Response();
};
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$2
}, Symbol.toStringTag, { value: "Module" }));
function loginErrorMessage(loginErrors) {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return {};
}
const loader$5 = async ({
  request
}) => {
  const errors = loginErrorMessage(await login(request));
  return {
    errors
  };
};
const action$1 = async ({
  request
}) => {
  const errors = loginErrorMessage(await login(request));
  return {
    errors
  };
};
const route$1 = UNSAFE_withComponentProps(function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const {
    errors
  } = actionData || loaderData;
  return /* @__PURE__ */ jsx(AppProvider, {
    embedded: false,
    children: /* @__PURE__ */ jsx("s-page", {
      children: /* @__PURE__ */ jsx(Form, {
        method: "post",
        children: /* @__PURE__ */ jsxs("s-section", {
          heading: "Log in",
          children: [/* @__PURE__ */ jsx("s-text-field", {
            name: "shop",
            label: "Shop domain",
            details: "example.myshopify.com",
            value: shop,
            onChange: (e) => setShop(e.currentTarget.value),
            autocomplete: "on",
            error: errors.shop
          }), /* @__PURE__ */ jsx("s-button", {
            type: "submit",
            children: "Log in"
          })]
        })
      })
    })
  });
});
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$1,
  default: route$1,
  loader: loader$5
}, Symbol.toStringTag, { value: "Module" }));
const loader$4 = async ({
  request
}) => {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  throw redirect(query ? `/app?${query}` : "/app");
};
const route = UNSAFE_withComponentProps(function Index() {
  return null;
});
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: route,
  loader: loader$4
}, Symbol.toStringTag, { value: "Module" }));
const loader$3 = async ({
  request
}) => {
  await authenticate.admin(request);
  return null;
};
const headers$2 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  headers: headers$2,
  loader: loader$3
}, Symbol.toStringTag, { value: "Module" }));
const loader$2 = async ({
  request
}) => {
  await authenticate.admin(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || ""
  };
};
const app = UNSAFE_withComponentProps(function App2() {
  const {
    apiKey
  } = useLoaderData();
  return /* @__PURE__ */ jsxs(AppProvider, {
    embedded: true,
    apiKey,
    children: [/* @__PURE__ */ jsxs("s-app-nav", {
      children: [/* @__PURE__ */ jsx("s-link", {
        href: "/app",
        children: "Bulk products"
      }), /* @__PURE__ */ jsx("s-link", {
        href: "/app/additional",
        children: "Roadmap"
      })]
    }), /* @__PURE__ */ jsx(Outlet, {})]
  });
});
const ErrorBoundary = UNSAFE_withErrorBoundaryProps(function ErrorBoundary2() {
  return boundary.error(useRouteError());
});
const headers$1 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary,
  default: app,
  headers: headers$1,
  loader: loader$2
}, Symbol.toStringTag, { value: "Module" }));
const templateDefinitions = {
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
        quantity: 20
      }
    ]
  },
  "update-status": {
    fileName: "bulk-update-status-template.xlsx",
    sheetName: "Update status",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890",
        status: "ACTIVE"
      }
    ]
  },
  "update-prices": {
    fileName: "bulk-update-prices-template.xlsx",
    sheetName: "Update prices",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890",
        variantId: "gid://shopify/ProductVariant/1234567890",
        price: "29.99",
        sku: "SKU-001"
      }
    ]
  },
  "update-stock": {
    fileName: "bulk-update-stock-template.xlsx",
    sheetName: "Update stock",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890",
        variantId: "gid://shopify/ProductVariant/1234567890",
        inventoryItemId: "gid://shopify/InventoryItem/1234567890",
        quantity: 12
      }
    ]
  },
  "add-to-collection": {
    fileName: "bulk-add-to-collection-template.xlsx",
    sheetName: "Add to collection",
    rows: [
      {
        productId: "gid://shopify/Product/1234567890"
      }
    ]
  }
};
function createTemplateWorkbook(templateKey) {
  const template = templateDefinitions[templateKey];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(template.rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, template.sheetName);
  return {
    fileName: template.fileName,
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
  };
}
async function parseWorkbookRows(file) {
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
  return XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false
  });
}
function normalizeStringArrayRows(rows) {
  return rows.map((row) => String(row.productId || "").trim()).filter(Boolean);
}
const loader$1 = async ({
  request,
  params
}) => {
  const template = params.template;
  if (!templateDefinitions[template]) {
    throw new Response("Template not found", {
      status: 404
    });
  }
  const workbook = createTemplateWorkbook(template);
  return new Response(workbook.buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${workbook.fileName}"`,
      "Cache-Control": "no-store"
    }
  });
};
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$1
}, Symbol.toStringTag, { value: "Module" }));
const app_additional = UNSAFE_withComponentProps(function RoadmapPage() {
  return /* @__PURE__ */ jsxs("s-page", {
    heading: "App roadmap",
    children: [/* @__PURE__ */ jsx("s-section", {
      heading: "Version 1",
      children: /* @__PURE__ */ jsxs("s-unordered-list", {
        children: [/* @__PURE__ */ jsx("s-list-item", {
          children: "Bulk create products with price, SKU, and stock."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Bulk set products to active, draft, or archived."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Bulk update variant prices and SKUs."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Bulk update inventory at a selected location."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Add selected products to a collection."
        })]
      })
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Next production features",
      children: /* @__PURE__ */ jsxs("s-unordered-list", {
        children: [/* @__PURE__ */ jsx("s-list-item", {
          children: "CSV upload and validation for staff users."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Saved import templates for marketing and fulfillment."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Background jobs for catalogs larger than 100 products."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Audit log showing who changed prices, stock, and status."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Role-based limits for staff accounts."
        })]
      })
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Shopify App Store readiness",
      children: /* @__PURE__ */ jsxs("s-unordered-list", {
        children: [/* @__PURE__ */ jsx("s-list-item", {
          children: "Keep requested scopes as narrow as the final features allow."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Add privacy policy, terms, support email, and uninstall cleanup."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Implement billing before public paid launch."
        }), /* @__PURE__ */ jsx("s-list-item", {
          children: "Run Shopify CLI app review checks before submission."
        })]
      })
    })]
  });
});
const route11 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: app_additional
}, Symbol.toStringTag, { value: "Module" }));
const PRODUCT_LIST_QUERY = `#graphql
  query ProductBulkManagerProducts {
    products(first: 25, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          status
          vendor
          totalInventory
          collections(first: 5) {
            edges {
              node {
                id
                title
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                sku
                price
                inventoryQuantity
                inventoryItem {
                  id
                }
              }
            }
          }
        }
      }
    }
    collections(first: 50, sortKey: TITLE) {
      edges {
        node {
          id
          title
        }
      }
    }
    locations(first: 10) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;
async function getBulkManagerData(admin) {
  const response = await admin.graphql(PRODUCT_LIST_QUERY);
  const json = await response.json();
  if (json.errors) {
    const accessErrors = json.errors.filter(
      (error) => String(error.message || "").includes("Access denied")
    );
    if (accessErrors.length !== json.errors.length) {
      throw new Error(JSON.stringify(json.errors));
    }
  }
  return {
    products: json.data?.products?.edges.map((edge) => edge.node) || [],
    collections: json.data?.collections?.edges.map((edge) => edge.node) || [],
    locations: json.data?.locations?.edges.map((edge) => edge.node) || []
  };
}
function parseJsonRows(value) {
  if (!value || typeof value !== "string") {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Bulk input must be a JSON array.");
  }
  return parsed;
}
async function createProducts(admin, rows, locationId) {
  const created = [];
  for (const row of rows) {
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingProductCreate($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product {
              id
              title
              status
              variants(first: 1) {
                edges {
                  node {
                    id
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          product: {
            title: row.title,
            descriptionHtml: row.descriptionHtml || void 0,
            vendor: row.vendor || void 0,
            productType: row.productType || void 0,
            status: row.status || "DRAFT"
          }
        }
      }
    );
    const json = await response.json();
    const errors = json.data?.productCreate?.userErrors || [];
    if (errors.length) {
      created.push({ title: row.title, errors });
      continue;
    }
    const product = json.data.productCreate.product;
    const variant = product.variants.edges[0]?.node;
    if (variant && (row.price || row.sku)) {
      await updateVariantPrices(admin, [
        {
          productId: product.id,
          variantId: variant.id,
          price: row.price,
          sku: row.sku
        }
      ]);
    }
    if (variant?.inventoryItem?.id && locationId && row.quantity !== void 0) {
      await updateInventoryQuantities(
        admin,
        [
          {
            productId: product.id,
            variantId: variant.id,
            inventoryItemId: variant.inventoryItem.id,
            quantity: row.quantity
          }
        ],
        locationId
      );
    }
    created.push(product);
  }
  return created;
}
async function updateProductStatuses(admin, productIds, status) {
  const updated = [];
  for (const id of productIds) {
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingProductStatus($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              status
            }
            userErrors {
              field
              message
            }
          }
        }`,
      { variables: { product: { id, status } } }
    );
    const json = await response.json();
    updated.push(json.data?.productUpdate);
  }
  return updated;
}
async function updateVariantPrices(admin, rows) {
  const byProduct = rows.reduce(
    (groups, row) => {
      groups[row.productId] ||= [];
      groups[row.productId].push(row);
      return groups;
    },
    {}
  );
  const updated = [];
  for (const [productId, variants] of Object.entries(byProduct)) {
    const response = await admin.graphql(
      `#graphql
        mutation BulkListingVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
              price
              sku
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          productId,
          variants: variants.map((variant) => ({
            id: variant.variantId,
            price: variant.price,
            inventoryItem: variant.sku ? { sku: variant.sku } : void 0
          }))
        }
      }
    );
    const json = await response.json();
    updated.push(json.data?.productVariantsBulkUpdate);
  }
  return updated;
}
async function updateInventoryQuantities(admin, rows, locationId) {
  if (!locationId) {
    throw new Error("Choose an inventory location before updating stock.");
  }
  const response = await admin.graphql(
    `#graphql
      mutation BulkListingInventory($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            createdAt
            reason
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        input: {
          name: "available",
          reason: "correction",
          quantities: rows.filter((row) => row.inventoryItemId && row.quantity !== void 0).map((row) => ({
            inventoryItemId: row.inventoryItemId,
            locationId,
            quantity: row.quantity,
            compareQuantity: null
          }))
        }
      }
    }
  );
  const json = await response.json();
  return json.data?.inventorySetQuantities;
}
async function addProductsToCollection(admin, collectionId, productIds) {
  const response = await admin.graphql(
    `#graphql
      mutation BulkListingCollectionAdd($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id: collectionId, productIds } }
  );
  const json = await response.json();
  return json.data?.collectionAddProducts;
}
const shell = "_shell_19a95_1";
const topbar = "_topbar_19a95_9";
const titleBlock = "_titleBlock_19a95_16";
const eyebrow = "_eyebrow_19a95_21";
const title = "_title_19a95_16";
const subtitle = "_subtitle_19a95_35";
const statusStrip = "_statusStrip_19a95_41";
const metric = "_metric_19a95_47";
const metricValue = "_metricValue_19a95_55";
const metricLabel = "_metricLabel_19a95_62";
const layout = "_layout_19a95_68";
const toolGrid = "_toolGrid_19a95_75";
const tool = "_tool_19a95_75";
const toolHeader = "_toolHeader_19a95_88";
const toolTitle = "_toolTitle_19a95_98";
const toolMeta = "_toolMeta_19a95_105";
const pill = "_pill_19a95_112";
const toolBody = "_toolBody_19a95_125";
const templateRow = "_templateRow_19a95_131";
const download = "_download_19a95_138";
const fileInput = "_fileInput_19a95_157";
const field = "_field_19a95_164";
const label = "_label_19a95_175";
const select = "_select_19a95_181";
const textarea = "_textarea_19a95_182";
const details = "_details_19a95_203";
const actions = "_actions_19a95_215";
const primaryButton = "_primaryButton_19a95_222";
const sidePanel = "_sidePanel_19a95_240";
const panel = "_panel_19a95_245";
const panelHeader = "_panelHeader_19a95_251";
const panelBody = "_panelBody_19a95_258";
const productRow = "_productRow_19a95_264";
const productTitle = "_productTitle_19a95_275";
const productMeta = "_productMeta_19a95_284";
const editButton = "_editButton_19a95_290";
const result = "_result_19a95_302";
const warning = "_warning_19a95_313";
const styles = {
  shell,
  topbar,
  titleBlock,
  eyebrow,
  title,
  subtitle,
  statusStrip,
  metric,
  metricValue,
  metricLabel,
  layout,
  toolGrid,
  tool,
  toolHeader,
  toolTitle,
  toolMeta,
  pill,
  toolBody,
  templateRow,
  download,
  fileInput,
  field,
  label,
  select,
  textarea,
  details,
  actions,
  primaryButton,
  sidePanel,
  panel,
  panelHeader,
  panelBody,
  productRow,
  productTitle,
  productMeta,
  editButton,
  result,
  warning
};
const sampleProducts = JSON.stringify([{
  title: "Cotton T-Shirt",
  vendor: "Acme",
  productType: "Apparel",
  status: "DRAFT",
  price: "19.99",
  sku: "TEE-001",
  quantity: 20
}, {
  title: "Canvas Tote",
  vendor: "Acme",
  productType: "Accessories",
  status: "ACTIVE",
  price: "24.99",
  sku: "TOTE-001",
  quantity: 15
}], null, 2);
const sampleVariantUpdates = JSON.stringify([{
  productId: "gid://shopify/Product/123",
  variantId: "gid://shopify/ProductVariant/456",
  inventoryItemId: "gid://shopify/InventoryItem/789",
  price: "29.99",
  sku: "NEW-SKU-001",
  quantity: 12
}], null, 2);
async function getRowsFromUpload(formData, fileField, fallbackField) {
  const uploadedRows = await parseWorkbookRows(formData.get(fileField));
  if (uploadedRows.length > 0) {
    return uploadedRows;
  }
  return parseJsonRows(formData.get(fallbackField));
}
function TemplateUpload({
  template,
  fileName
}) {
  return /* @__PURE__ */ jsxs("div", {
    className: styles.templateRow,
    children: [/* @__PURE__ */ jsx("a", {
      className: styles.download,
      href: `/app/templates/${template}`,
      download: true,
      target: "_blank",
      rel: "noreferrer",
      children: "Download template"
    }), /* @__PURE__ */ jsx("input", {
      className: styles.fileInput,
      type: "file",
      name: fileName,
      accept: ".xlsx,.xls,.csv",
      "aria-label": "Upload completed Excel template"
    })]
  });
}
function ToolCard({
  title: title2,
  badges,
  children
}) {
  return /* @__PURE__ */ jsxs("section", {
    className: styles.tool,
    children: [/* @__PURE__ */ jsx("div", {
      className: styles.toolHeader,
      children: /* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h2", {
          className: styles.toolTitle,
          children: title2
        }), /* @__PURE__ */ jsx("div", {
          className: styles.toolMeta,
          children: badges.map((badge) => /* @__PURE__ */ jsx("span", {
            className: styles.pill,
            children: badge
          }, badge))
        })]
      })
    }), children]
  });
}
const loader = async ({
  request
}) => {
  const {
    admin
  } = await authenticate.admin(request);
  return getBulkManagerData(admin);
};
const action = async ({
  request
}) => {
  const {
    admin
  } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  try {
    if (intent === "create-products") {
      const rows = await getRowsFromUpload(formData, "productsFile", "products");
      return {
        intent,
        result: await createProducts(admin, rows, String(formData.get("locationId") || ""))
      };
    }
    if (intent === "update-status") {
      const uploadedRows = await parseWorkbookRows(formData.get("productIdsFile"));
      const status = String(formData.get("status"));
      if (uploadedRows.length > 0) {
        const statusGroups = uploadedRows.reduce((groups, row) => {
          const productId = String(row.productId || "").trim();
          const rowStatus = String(row.status || status).trim().toUpperCase();
          if (!productId) {
            return groups;
          }
          groups[rowStatus] ||= [];
          groups[rowStatus].push(productId);
          return groups;
        }, {});
        const result2 = [];
        for (const [rowStatus, productIds2] of Object.entries(statusGroups)) {
          result2.push(await updateProductStatuses(admin, productIds2, rowStatus));
        }
        return {
          intent,
          result: result2
        };
      }
      const productIds = parseJsonRows(formData.get("productIds"));
      return {
        intent,
        result: await updateProductStatuses(admin, productIds, status)
      };
    }
    if (intent === "update-prices") {
      const rows = await getRowsFromUpload(formData, "variantsFile", "variants");
      return {
        intent,
        result: await updateVariantPrices(admin, rows)
      };
    }
    if (intent === "update-stock") {
      const rows = await getRowsFromUpload(formData, "variantsFile", "variants");
      const locationId = String(formData.get("locationId") || "");
      return {
        intent,
        result: await updateInventoryQuantities(admin, rows, locationId)
      };
    }
    if (intent === "add-to-collection") {
      const uploadedRows = await parseWorkbookRows(formData.get("productIdsFile"));
      const productIds = uploadedRows.length > 0 ? normalizeStringArrayRows(uploadedRows) : parseJsonRows(formData.get("productIds"));
      const collectionId = String(formData.get("collectionId") || "");
      return {
        intent,
        result: await addProductsToCollection(admin, collectionId, productIds)
      };
    }
    return {
      intent,
      error: "Unknown bulk action."
    };
  } catch (error) {
    return {
      intent,
      error: error instanceof Error ? error.message : "Bulk action failed."
    };
  }
};
const app__index = UNSAFE_withComponentProps(function BulkProducts() {
  const {
    products,
    collections,
    locations
  } = useLoaderData();
  const fetcher = useFetcher();
  const shopify2 = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";
  const hasLocations = locations.length > 0;
  useEffect(() => {
    if (fetcher.data?.result) {
      shopify2.toast.show("Bulk action completed");
    }
    if (fetcher.data?.error) {
      shopify2.toast.show(fetcher.data.error, {
        isError: true
      });
    }
  }, [fetcher.data, shopify2]);
  const productIdsSample = JSON.stringify(products.slice(0, 3).map((product) => product.id), null, 2);
  return /* @__PURE__ */ jsx("s-page", {
    heading: "Bulk Listing Manager",
    children: /* @__PURE__ */ jsxs("div", {
      className: styles.shell,
      children: [/* @__PURE__ */ jsxs("div", {
        className: styles.topbar,
        children: [/* @__PURE__ */ jsxs("div", {
          className: styles.titleBlock,
          children: [/* @__PURE__ */ jsx("div", {
            className: styles.eyebrow,
            children: "Catalog operations"
          }), /* @__PURE__ */ jsx("h1", {
            className: styles.title,
            children: "Bulk product control center"
          }), /* @__PURE__ */ jsx("p", {
            className: styles.subtitle,
            children: "Manage products, stock, prices, status, and collections from Excel files."
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: styles.statusStrip,
          children: [/* @__PURE__ */ jsxs("div", {
            className: styles.metric,
            children: [/* @__PURE__ */ jsx("div", {
              className: styles.metricValue,
              children: products.length
            }), /* @__PURE__ */ jsx("div", {
              className: styles.metricLabel,
              children: "Products"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: styles.metric,
            children: [/* @__PURE__ */ jsx("div", {
              className: styles.metricValue,
              children: collections.length
            }), /* @__PURE__ */ jsx("div", {
              className: styles.metricLabel,
              children: "Collections"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: styles.metric,
            children: [/* @__PURE__ */ jsx("div", {
              className: styles.metricValue,
              children: locations.length
            }), /* @__PURE__ */ jsx("div", {
              className: styles.metricLabel,
              children: "Locations"
            })]
          })]
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: styles.layout,
        children: [/* @__PURE__ */ jsxs("div", {
          className: styles.toolGrid,
          children: [/* @__PURE__ */ jsx(ToolCard, {
            title: "Create products",
            badges: ["products", "price", "SKU", "initial stock"],
            children: /* @__PURE__ */ jsxs(fetcher.Form, {
              method: "post",
              encType: "multipart/form-data",
              children: [/* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "intent",
                value: "create-products"
              }), /* @__PURE__ */ jsxs("div", {
                className: styles.toolBody,
                children: [/* @__PURE__ */ jsx(TemplateUpload, {
                  template: "create-products",
                  fileName: "productsFile"
                }), /* @__PURE__ */ jsxs("div", {
                  className: styles.field,
                  children: [/* @__PURE__ */ jsx("label", {
                    className: styles.label,
                    htmlFor: "createLocation",
                    children: "Initial inventory location"
                  }), /* @__PURE__ */ jsx("select", {
                    className: styles.select,
                    id: "createLocation",
                    name: "locationId",
                    disabled: !hasLocations,
                    children: locations.map((location) => /* @__PURE__ */ jsx("option", {
                      value: location.id,
                      children: location.name
                    }, location.id))
                  })]
                }), !hasLocations && /* @__PURE__ */ jsx("div", {
                  className: styles.warning,
                  children: "Inventory locations are unavailable until Shopify grants the location scope."
                }), /* @__PURE__ */ jsxs("details", {
                  className: styles.details,
                  children: [/* @__PURE__ */ jsx("summary", {
                    children: "JSON fallback"
                  }), /* @__PURE__ */ jsx("textarea", {
                    className: styles.textarea,
                    name: "products",
                    defaultValue: sampleProducts
                  })]
                }), /* @__PURE__ */ jsx("div", {
                  className: styles.actions,
                  children: /* @__PURE__ */ jsx("button", {
                    className: styles.primaryButton,
                    type: "submit",
                    disabled: isSubmitting,
                    children: "Create products"
                  })
                })]
              })]
            })
          }), /* @__PURE__ */ jsx(ToolCard, {
            title: "Update listing status",
            badges: ["active", "draft", "archived"],
            children: /* @__PURE__ */ jsxs(fetcher.Form, {
              method: "post",
              encType: "multipart/form-data",
              children: [/* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "intent",
                value: "update-status"
              }), /* @__PURE__ */ jsxs("div", {
                className: styles.toolBody,
                children: [/* @__PURE__ */ jsx(TemplateUpload, {
                  template: "update-status",
                  fileName: "productIdsFile"
                }), /* @__PURE__ */ jsxs("div", {
                  className: styles.field,
                  children: [/* @__PURE__ */ jsx("label", {
                    className: styles.label,
                    htmlFor: "status",
                    children: "Default status"
                  }), /* @__PURE__ */ jsxs("select", {
                    className: styles.select,
                    id: "status",
                    name: "status",
                    children: [/* @__PURE__ */ jsx("option", {
                      value: "ACTIVE",
                      children: "Active"
                    }), /* @__PURE__ */ jsx("option", {
                      value: "DRAFT",
                      children: "Draft"
                    }), /* @__PURE__ */ jsx("option", {
                      value: "ARCHIVED",
                      children: "Unlisted / archived"
                    })]
                  })]
                }), /* @__PURE__ */ jsxs("details", {
                  className: styles.details,
                  children: [/* @__PURE__ */ jsx("summary", {
                    children: "JSON fallback"
                  }), /* @__PURE__ */ jsx("textarea", {
                    className: styles.textarea,
                    name: "productIds",
                    defaultValue: productIdsSample
                  })]
                }), /* @__PURE__ */ jsx("div", {
                  className: styles.actions,
                  children: /* @__PURE__ */ jsx("button", {
                    className: styles.primaryButton,
                    type: "submit",
                    disabled: isSubmitting,
                    children: "Update status"
                  })
                })]
              })]
            })
          }), /* @__PURE__ */ jsx(ToolCard, {
            title: "Update prices",
            badges: ["variants", "price", "SKU"],
            children: /* @__PURE__ */ jsxs(fetcher.Form, {
              method: "post",
              encType: "multipart/form-data",
              children: [/* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "intent",
                value: "update-prices"
              }), /* @__PURE__ */ jsxs("div", {
                className: styles.toolBody,
                children: [/* @__PURE__ */ jsx(TemplateUpload, {
                  template: "update-prices",
                  fileName: "variantsFile"
                }), /* @__PURE__ */ jsxs("details", {
                  className: styles.details,
                  children: [/* @__PURE__ */ jsx("summary", {
                    children: "JSON fallback"
                  }), /* @__PURE__ */ jsx("textarea", {
                    className: styles.textarea,
                    name: "variants",
                    defaultValue: sampleVariantUpdates
                  })]
                }), /* @__PURE__ */ jsx("div", {
                  className: styles.actions,
                  children: /* @__PURE__ */ jsx("button", {
                    className: styles.primaryButton,
                    type: "submit",
                    disabled: isSubmitting,
                    children: "Update prices"
                  })
                })]
              })]
            })
          }), /* @__PURE__ */ jsx(ToolCard, {
            title: "Update stock",
            badges: ["inventory", "location"],
            children: /* @__PURE__ */ jsxs(fetcher.Form, {
              method: "post",
              encType: "multipart/form-data",
              children: [/* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "intent",
                value: "update-stock"
              }), /* @__PURE__ */ jsxs("div", {
                className: styles.toolBody,
                children: [/* @__PURE__ */ jsx(TemplateUpload, {
                  template: "update-stock",
                  fileName: "variantsFile"
                }), /* @__PURE__ */ jsxs("div", {
                  className: styles.field,
                  children: [/* @__PURE__ */ jsx("label", {
                    className: styles.label,
                    htmlFor: "stockLocation",
                    children: "Inventory location"
                  }), /* @__PURE__ */ jsx("select", {
                    className: styles.select,
                    id: "stockLocation",
                    name: "locationId",
                    disabled: !hasLocations,
                    children: locations.map((location) => /* @__PURE__ */ jsx("option", {
                      value: location.id,
                      children: location.name
                    }, location.id))
                  })]
                }), !hasLocations && /* @__PURE__ */ jsx("div", {
                  className: styles.warning,
                  children: "Inventory locations are unavailable until Shopify grants the location scope."
                }), /* @__PURE__ */ jsxs("details", {
                  className: styles.details,
                  children: [/* @__PURE__ */ jsx("summary", {
                    children: "JSON fallback"
                  }), /* @__PURE__ */ jsx("textarea", {
                    className: styles.textarea,
                    name: "variants",
                    defaultValue: sampleVariantUpdates
                  })]
                }), /* @__PURE__ */ jsx("div", {
                  className: styles.actions,
                  children: /* @__PURE__ */ jsx("button", {
                    className: styles.primaryButton,
                    type: "submit",
                    disabled: isSubmitting,
                    children: "Update stock"
                  })
                })]
              })]
            })
          }), /* @__PURE__ */ jsx(ToolCard, {
            title: "Add products to collection",
            badges: ["collections", "bulk assignment"],
            children: /* @__PURE__ */ jsxs(fetcher.Form, {
              method: "post",
              encType: "multipart/form-data",
              children: [/* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "intent",
                value: "add-to-collection"
              }), /* @__PURE__ */ jsxs("div", {
                className: styles.toolBody,
                children: [/* @__PURE__ */ jsx(TemplateUpload, {
                  template: "add-to-collection",
                  fileName: "productIdsFile"
                }), /* @__PURE__ */ jsxs("div", {
                  className: styles.field,
                  children: [/* @__PURE__ */ jsx("label", {
                    className: styles.label,
                    htmlFor: "collectionId",
                    children: "Collection"
                  }), /* @__PURE__ */ jsx("select", {
                    className: styles.select,
                    id: "collectionId",
                    name: "collectionId",
                    children: collections.map((collection) => /* @__PURE__ */ jsx("option", {
                      value: collection.id,
                      children: collection.title
                    }, collection.id))
                  })]
                }), /* @__PURE__ */ jsxs("details", {
                  className: styles.details,
                  children: [/* @__PURE__ */ jsx("summary", {
                    children: "JSON fallback"
                  }), /* @__PURE__ */ jsx("textarea", {
                    className: styles.textarea,
                    name: "productIds",
                    defaultValue: productIdsSample
                  })]
                }), /* @__PURE__ */ jsx("div", {
                  className: styles.actions,
                  children: /* @__PURE__ */ jsx("button", {
                    className: styles.primaryButton,
                    type: "submit",
                    disabled: isSubmitting,
                    children: "Add to collection"
                  })
                })]
              })]
            })
          })]
        }), /* @__PURE__ */ jsxs("aside", {
          className: styles.sidePanel,
          children: [/* @__PURE__ */ jsxs("section", {
            className: styles.panel,
            children: [/* @__PURE__ */ jsx("div", {
              className: styles.panelHeader,
              children: "Recent listings"
            }), /* @__PURE__ */ jsx("div", {
              className: styles.panelBody,
              children: products.slice(0, 8).map((product) => /* @__PURE__ */ jsxs("div", {
                className: styles.productRow,
                children: [/* @__PURE__ */ jsxs("div", {
                  children: [/* @__PURE__ */ jsx("div", {
                    className: styles.productTitle,
                    children: product.title
                  }), /* @__PURE__ */ jsxs("div", {
                    className: styles.productMeta,
                    children: [product.status, " | Stock ", product.totalInventory ?? 0]
                  })]
                }), /* @__PURE__ */ jsx("button", {
                  className: styles.editButton,
                  type: "button",
                  onClick: () => {
                    shopify2.intents.invoke?.("edit:shopify/Product", {
                      value: product.id
                    });
                  },
                  children: "Edit"
                })]
              }, product.id))
            })]
          }), fetcher.data && /* @__PURE__ */ jsxs("section", {
            className: styles.panel,
            children: [/* @__PURE__ */ jsx("div", {
              className: styles.panelHeader,
              children: "Last action result"
            }), /* @__PURE__ */ jsx("div", {
              className: styles.panelBody,
              children: /* @__PURE__ */ jsx("pre", {
                className: styles.result,
                children: /* @__PURE__ */ jsx("code", {
                  children: JSON.stringify(fetcher.data, null, 2)
                })
              })
            })]
          })]
        })]
      })]
    })
  });
});
const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route12 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action,
  default: app__index,
  headers,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-Dvt5pkJw.js", "imports": ["/assets/jsx-runtime-CJDK6KDG.js", "/assets/chunk-KS7C4IRE-jb2SzPw2.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/root-Dk3AGvc7.js", "imports": ["/assets/jsx-runtime-CJDK6KDG.js", "/assets/chunk-KS7C4IRE-jb2SzPw2.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.customers.data_request": { "id": "routes/webhooks.customers.data_request", "parentId": "root", "path": "webhooks/customers/data_request", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.customers.data_request-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.app.scopes_update": { "id": "routes/webhooks.app.scopes_update", "parentId": "root", "path": "webhooks/app/scopes_update", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.scopes_update-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.customers.redact": { "id": "routes/webhooks.customers.redact", "parentId": "root", "path": "webhooks/customers/redact", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.customers.redact-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.app.uninstalled": { "id": "routes/webhooks.app.uninstalled", "parentId": "root", "path": "webhooks/app/uninstalled", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.uninstalled-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.shop.redact": { "id": "routes/webhooks.shop.redact", "parentId": "root", "path": "webhooks/shop/redact", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.shop.redact-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/auth.login": { "id": "routes/auth.login", "parentId": "root", "path": "auth/login", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/route-nPyqy-Jy.js", "imports": ["/assets/chunk-KS7C4IRE-jb2SzPw2.js", "/assets/jsx-runtime-CJDK6KDG.js", "/assets/AppProxyLink-CD7MJcH7.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/_index": { "id": "routes/_index", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/route-CiJeQAPs.js", "imports": ["/assets/chunk-KS7C4IRE-jb2SzPw2.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/auth.$": { "id": "routes/auth.$", "parentId": "root", "path": "auth/*", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/auth._-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app": { "id": "routes/app", "parentId": "root", "path": "app", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/app-CPPr61n7.js", "imports": ["/assets/chunk-KS7C4IRE-jb2SzPw2.js", "/assets/jsx-runtime-CJDK6KDG.js", "/assets/AppProxyLink-CD7MJcH7.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app.templates.$template": { "id": "routes/app.templates.$template", "parentId": "routes/app", "path": "templates/:template", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/app.templates._template-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app.additional": { "id": "routes/app.additional", "parentId": "routes/app", "path": "additional", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app.additional-CW3PYq4P.js", "imports": ["/assets/chunk-KS7C4IRE-jb2SzPw2.js", "/assets/jsx-runtime-CJDK6KDG.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app._index": { "id": "routes/app._index", "parentId": "routes/app", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app._index-B7JGAaTQ.js", "imports": ["/assets/chunk-KS7C4IRE-jb2SzPw2.js", "/assets/jsx-runtime-CJDK6KDG.js"], "css": ["/assets/app-D2f9rPsb.css"], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 } }, "url": "/assets/manifest-4118ff7f.js", "version": "4118ff7f", "sri": void 0 };
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "unstable_optimizeDeps": false, "v8_passThroughRequests": false, "v8_trailingSlashAwareDataRequests": false, "unstable_previewServerPrerendering": false, "v8_middleware": false, "v8_splitRouteModules": false, "v8_viteEnvironmentApi": false };
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { "mode": "lazy", "manifestPath": "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/webhooks.customers.data_request": {
    id: "routes/webhooks.customers.data_request",
    parentId: "root",
    path: "webhooks/customers/data_request",
    index: void 0,
    caseSensitive: void 0,
    module: route1
  },
  "routes/webhooks.app.scopes_update": {
    id: "routes/webhooks.app.scopes_update",
    parentId: "root",
    path: "webhooks/app/scopes_update",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/webhooks.customers.redact": {
    id: "routes/webhooks.customers.redact",
    parentId: "root",
    path: "webhooks/customers/redact",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/webhooks.app.uninstalled": {
    id: "routes/webhooks.app.uninstalled",
    parentId: "root",
    path: "webhooks/app/uninstalled",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "routes/webhooks.shop.redact": {
    id: "routes/webhooks.shop.redact",
    parentId: "root",
    path: "webhooks/shop/redact",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/auth.login": {
    id: "routes/auth.login",
    parentId: "root",
    path: "auth/login",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route7
  },
  "routes/auth.$": {
    id: "routes/auth.$",
    parentId: "root",
    path: "auth/*",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "routes/app": {
    id: "routes/app",
    parentId: "root",
    path: "app",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "routes/app.templates.$template": {
    id: "routes/app.templates.$template",
    parentId: "routes/app",
    path: "templates/:template",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  },
  "routes/app.additional": {
    id: "routes/app.additional",
    parentId: "routes/app",
    path: "additional",
    index: void 0,
    caseSensitive: void 0,
    module: route11
  },
  "routes/app._index": {
    id: "routes/app._index",
    parentId: "routes/app",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route12
  }
};
const allowedActionOrigins = false;
export {
  allowedActionOrigins,
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  routes,
  ssr
};
