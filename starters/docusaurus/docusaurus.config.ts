import type { Config } from "@docusaurus/types";

const config: Config = {
  title: "RepoDocs AI Starter",
  tagline: "Docusaurus starter integration for RepoDocs AI",
  url: "https://example.com",
  baseUrl: "/",
  favicon: "img/favicon.ico",
  organizationName: "your-org",
  projectName: "your-docs-site",
  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts"
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css"
        }
      }
    ]
  ],
  themeConfig: {
    navbar: {
      title: "RepoDocs AI Starter",
      items: [{ to: "/docs/intro", label: "Docs", position: "left" }]
    }
  }
};

export default config;