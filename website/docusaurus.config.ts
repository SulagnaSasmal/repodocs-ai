import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "RepoDocs AI",
  tagline: "A repository-based documentation system for API teams.",
  favicon: "img/favicon.svg",
  url: "https://sulagnasasmal.github.io",
  baseUrl: "/repodocs-ai/",
  organizationName: "SulagnaSasmal",
  projectName: "repodocs-ai",
  deploymentBranch: "gh-pages",
  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn"
    }
  },
  presets: [
    [
      "classic",
      {
        docs: {
          path: "../docs",
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/SulagnaSasmal/repodocs-ai/tree/main/"
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css"
        }
      } satisfies Preset.Options
    ]
  ],
  themeConfig: {
    image: "img/og-card.svg",
    colorMode: {
      defaultMode: "light",
      disableSwitch: true,
      respectPrefersColorScheme: false
    },
    navbar: {
      title: "RepoDocs AI",
      hideOnScroll: true,
      items: [
        {
          to: "/docs",
          label: "Docs",
          position: "left"
        },
        {
          to: "/demo",
          label: "Demo",
          position: "left"
        },
        {
          to: "/payments-example",
          label: "Payments Example",
          position: "left"
        },
        {
          href: "https://github.com/SulagnaSasmal/repodocs-ai",
          label: "GitHub",
          position: "right"
        }
      ]
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Start",
          items: [
            {
              label: "Install",
              to: "/docs/installation"
            },
            {
              label: "Product Guide",
              to: "/docs/product-guide"
            },
            {
              label: "Docs Hub",
              to: "/docs"
            }
          ]
        },
        {
          title: "Evaluate",
          items: [
            {
              label: "Demo",
              to: "/demo"
            },
            {
              label: "Payments Example",
              to: "/payments-example"
            },
            {
              label: "Validation",
              to: "/docs/testing-strategy"
            },
            {
              label: "Product Specification",
              to: "/docs/product-specification"
            }
          ]
        },
        {
          title: "Repository",
          items: [
            {
              label: "Templates",
              href: "https://github.com/SulagnaSasmal/repodocs-ai/tree/main/templates"
            },
            {
              label: "Prompts",
              href: "https://github.com/SulagnaSasmal/repodocs-ai/tree/main/prompts"
            },
            {
              label: "Examples",
              href: "https://github.com/SulagnaSasmal/repodocs-ai/tree/main/examples"
            }
          ]
        }
      ],
      copyright: `Copyright ${new Date().getFullYear()} RepoDocs AI`
    }
  } satisfies Preset.ThemeConfig
};

export default config;