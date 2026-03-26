import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";

type LinkItem = {
  label: string;
  href: string;
  variant?: "primary" | "secondary";
};

type Stat = {
  label: string;
  value: string;
  detail: string;
};

type Pillar = {
  title: string;
  body: string;
};

type WorkflowStep = {
  title: string;
  body: string;
};

const actions: LinkItem[] = [
  { label: "Read the docs", href: "/docs", variant: "primary" },
  { label: "Install in 5 minutes", href: "/docs/installation", variant: "primary" },
  {
    label: "Inspect the payments example",
    href: "/payments-example",
    variant: "secondary"
  },
  {
    label: "View the repository",
    href: "https://github.com/SulagnaSasmal/repodocs-ai",
    variant: "secondary"
  }
];

const stats: Stat[] = [
  {
    label: "Setup",
    value: "5 minutes",
    detail: "Install, validate, and inspect the system before you commit to it."
  },
  {
    label: "Proof",
    value: "Payments example",
    detail: "Review a realistic API doc set instead of guessing from homepage promises."
  },
  {
    label: "Quality",
    value: "Built-in checks",
    detail: "Use validation and review rules so documentation quality does not depend on memory."
  }
];

const pillars: Pillar[] = [
  {
    title: "Standardize how your APIs are documented",
    body: "Use one documentation structure across services instead of letting each team invent its own format."
  },
  {
    title: "Draft from source material, not guesswork",
    body: "Generate from OpenAPI inputs, work from reusable templates, and keep reviewers anchored in the actual product contract."
  },
  {
    title: "Ship docs that can survive product change",
    body: "Validation, review workflows, and publishable examples help teams keep documentation useful after the first draft."
  }
];

const workflow: WorkflowStep[] = [
  {
    title: "Install",
    body: "Clone the repository, install dependencies, and run the validation path in a few minutes."
  },
  {
    title: "Inspect",
    body: "Review the payments example, templates, and prompts to see the expected output quality."
  },
  {
    title: "Adapt",
    body: "Copy the template packs into your own docs repository and tailor them to your APIs and workflows."
  },
  {
    title: "Publish",
    body: "Use the same repository workflow for review, validation, and documentation publishing."
  }
];

const proofPoints: Pillar[] = [
  {
    title: "A working payments API example",
    body: "Start with the example output so you can judge whether the structure and quality match what your team needs."
  },
  {
    title: "Templates and prompts in the repo",
    body: "Inspect the actual building blocks you would copy into your own documentation workflow."
  },
  {
    title: "Validation before publication",
    body: "Run the repository checks to confirm the system enforces structure instead of relying on manual review alone."
  }
];

export default function Home(): JSX.Element {
  return (
    <Layout
      title="Repo-native documentation operations"
      description="RepoDocs AI helps API teams turn scattered documentation work into a structured, validated, repository-native system."
    >
      <main className="homepage">
        <section className="hero-band">
          <div className="hero-shell">
            <div className="hero-copy">
              <p className="eyebrow">Documentation system</p>
              <h1>Ship API docs with structure, proof, and review built in.</h1>
              <p className="hero-text">
                RepoDocs AI gives API teams one repository-based workflow for drafting, validating, and publishing
                documentation without stitching together templates, prompts, and review steps by hand.
              </p>
              <div className="hero-actions">
                {actions.map((action) => (
                  <Link
                    key={action.label}
                    className={`hero-action hero-action--${action.variant ?? "secondary"}`}
                    href={action.href}
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="hero-rail">
              <div className="hero-panel hero-panel--accent">
                <p className="panel-label">What this is</p>
                <h2>Start with the product path, then inspect the repository internals.</h2>
                <p>
                  Installation, the payments example, and the docs hub are the shortest way to judge whether RepoDocs AI
                  is useful. GitHub is still there when you want to inspect the source assets in detail.
                </p>
              </div>
              <div className="stats-grid">
                {stats.map((stat) => (
                  <article key={stat.label} className="stat-card">
                    <p className="panel-label">{stat.label}</p>
                    <strong>{stat.value}</strong>
                    <p>{stat.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="content-shell section-grid">
          <article className="surface-card surface-card--warm">
            <p className="section-kicker">Problem</p>
            <h2>Most API teams still document too slowly, too differently, and too late.</h2>
            <p>
              Teams can generate drafts quickly, but they still struggle to keep format consistent,
              tie content back to the product contract, and publish docs that survive release pressure.
            </p>
          </article>
          <article className="surface-card surface-card--cool">
            <p className="section-kicker">Approach</p>
            <h2>RepoDocs AI gives teams one practical system for drafting, checking, and publishing docs.</h2>
            <ul className="bullet-list">
              {pillars.map((pillar) => (
                <li key={pillar.title}>
                  <strong>{pillar.title}</strong>
                  <span>{pillar.body}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="content-shell narrative-band">
          <div className="section-heading">
            <p className="section-kicker">Evaluate</p>
            <h2>Use the site the way a buyer would evaluate the product.</h2>
          </div>
          <div className="workflow-grid">
            {workflow.map((step, index) => (
              <article key={step.title} className="workflow-card">
                <span className="workflow-index">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="content-shell section-grid">
          <article className="surface-card surface-card--dark">
            <p className="section-kicker">How to evaluate</p>
            <h2>Follow the shortest path from claim to proof.</h2>
            <p>
              Start with installation, inspect the payments reference, and review how validation works.
              That gives you enough evidence to decide whether RepoDocs AI is useful without reading every internal planning document.
            </p>
            <div className="inline-links">
              <Link href="/docs/installation">Installation</Link>
              <Link href="/docs/product-guide">Product guide</Link>
              <Link href="/docs/testing-strategy">Testing strategy</Link>
            </div>
          </article>
          <div className="stack-grid">
            {proofPoints.map((item) => (
              <article key={item.title} className="surface-card surface-card--plain stack-card">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="content-shell callout-band">
          <div>
            <p className="section-kicker">Choose a starting point</p>
            <h2>Use the docs site to evaluate the product, and GitHub to inspect the working assets.</h2>
            <p>
              The public site now focuses on adoption and proof. GitHub remains the place to inspect the templates,
              prompts, examples, and automation that power the system.
            </p>
          </div>
          <div className="callout-actions">
            <Link className="hero-action hero-action--primary" href="/docs">
              Explore docs
            </Link>
            <Link className="hero-action hero-action--secondary" href="https://github.com/SulagnaSasmal/repodocs-ai">
              Open GitHub
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}