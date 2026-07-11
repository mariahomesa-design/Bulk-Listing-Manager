export { action, headers, loader } from "./app._index";
import { BulkProducts } from "./app._index";

export default function UpdateStockPage() {
  return <BulkProducts view="update-stock" />;
}
