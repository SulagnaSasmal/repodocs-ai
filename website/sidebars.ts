import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "category",
      label: "Get Started",
      items: ["index", "installation", "product-guide", "ready-to-install-system"]
    },
    {
      type: "category",
      label: "Evaluate",
      items: ["product-specification", "testing-strategy", "hosted-control-plane", "export-integrations"]
    },
    {
      type: "category",
      label: "Adopt",
      items: ["multi-repo-guide", "migration-guides/payments-retrieve-status"]
    },
    {
      type: "category",
      label: "Community",
      items: ["developer-experience-scorecard", "community-feedback-discussion"]
    }
  ]
};

export default sidebars;