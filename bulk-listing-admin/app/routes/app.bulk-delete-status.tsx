export { action, headers, loader } from "./app._index";
import { BulkProducts } from "./app._index";

export default function BulkDeleteStatusPage() {
  return <BulkProducts view="bulk-delete-status" />;
}
