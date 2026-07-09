export default function RoadmapPage() {
  return (
    <s-page heading="App roadmap">
      <s-section heading="Version 1">
        <s-unordered-list>
          <s-list-item>Bulk create products with price, SKU, and stock.</s-list-item>
          <s-list-item>Bulk set products to active, draft, or archived.</s-list-item>
          <s-list-item>Bulk update variant prices and SKUs.</s-list-item>
          <s-list-item>Bulk update inventory at a selected location.</s-list-item>
          <s-list-item>Add selected products to a collection.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Next production features">
        <s-unordered-list>
          <s-list-item>CSV upload and validation for staff users.</s-list-item>
          <s-list-item>Saved import templates for marketing and fulfillment.</s-list-item>
          <s-list-item>Background jobs for catalogs larger than 100 products.</s-list-item>
          <s-list-item>Audit log showing who changed prices, stock, and status.</s-list-item>
          <s-list-item>Role-based limits for staff accounts.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Shopify App Store readiness">
        <s-unordered-list>
          <s-list-item>Keep requested scopes as narrow as the final features allow.</s-list-item>
          <s-list-item>Add privacy policy, terms, support email, and uninstall cleanup.</s-list-item>
          <s-list-item>Implement billing before public paid launch.</s-list-item>
          <s-list-item>Run Shopify CLI app review checks before submission.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

