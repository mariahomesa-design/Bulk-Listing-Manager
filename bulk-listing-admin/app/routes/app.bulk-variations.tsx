export { action, headers, loader } from "./app._index";
import { BulkProducts } from "./app._index";

export default function BulkVariationsPage() {
  return <BulkProducts view="bulk-variations" />;
}
