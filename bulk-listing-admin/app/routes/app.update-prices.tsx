export { action, headers, loader } from "./app._index";
import { BulkProducts } from "./app._index";

export default function UpdatePricesPage() {
  return <BulkProducts view="update-prices" />;
}
