import type { LoaderFunctionArgs } from "react-router";
import {
  createTemplateWorkbook,
  templateDefinitions,
  type TemplateKey,
} from "../models/bulk-spreadsheets.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const template = params.template as TemplateKey;

  if (!templateDefinitions[template]) {
    throw new Response("Template not found", { status: 404 });
  }

  const workbook = createTemplateWorkbook(template);

  return new Response(workbook.buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${workbook.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
};
