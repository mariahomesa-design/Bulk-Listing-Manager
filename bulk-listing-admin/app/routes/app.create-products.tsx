export { action, headers, loader } from "./app._index";
import { BulkProducts } from "./app._index";

export default function CreateProductsPage() {
  return <BulkProducts view="create-products" />;
}
