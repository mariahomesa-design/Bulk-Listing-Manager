export { action, headers, loader } from "./app._index";
import { BulkProducts } from "./app._index";

export default function BulkImagesPage() {
  return <BulkProducts view="bulk-images" />;
}
