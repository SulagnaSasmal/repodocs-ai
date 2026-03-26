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
    href: "https://github.com/SulagnaSasmal/repodocs-ai/tree/main/examples/payments-api",
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
    label: "Templates",
    value: "6 packs",
    detail: "API, product, feature, governance, operations, and architecture documentation."
  },
  {
    label: "Proof",
    value: "1 trust path",
    detail: "Install, validate, inspect the payments reference, and judge the system on concrete output."
  },
  {
    label: "Automation",
    value: "CI + exports",
    detail: "Validation, generation, analytics, knowledge graph jobs, and publishing workflows."
  }
];

const pillars: Pillar[] = [
  {
    title: "Stop shipping template fragments",
    body: "RepoDocs AI packages prompts, review rules, validation, examples, and publishing into one repository-native operating model."
  },
  {
    title: "Document from evidence",
    body: "OpenAPI generation, example systems, and documentation review prompts make it easier to verify that output matches the product contract."
  },
  {
    title: "Move from draft to release",
    body: "The system covers authoring, review, CI validation, export, and hosted automation rather than stopping at Markdown scaffolding."
  }
];

const workflow: WorkflowStep[] = [
  {
    title: "Bootstrap",
    body: "Create a docs repo and copy the shipped template, prompt, and diagram packs."
  },
  {
    title: "Generate",
    body: "Draft product or API docs with the prompt packs or generate endpoint docs from an OpenAPI spec."
  },
  {
    title: "Validate",
    body: "Run structural, quality, and OpenAPI checks before the content reaches production."
  },
  {
    title: "Publish",
    body: "Expose the documentation through GitHub Pages and export into downstream tools when teams need broader distribution."
  }
];

const proofPoints: Pillar[] = [
  {
    title: "A live docs hub",
    body: "Core product, installation, roadmap, and implementation docs are now navigable as a real documentation site instead of a set of disconnected HTML files."
  },
  {
    title: "A Stripe-style sample",
    body: "The payments example shows authentication, errors, idempotency, and webhooks so buyers can inspect the final quality bar."
  },
  {
    title: "Operational depth",
    body: "Control-plane, validation, analytics, and export flows remain visible as first-class product capabilities."
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
              <h1>Build docs like product infrastructure, not a pile of templates.</h1>
              <p className="hero-text">
                RepoDocs AI gives API teams a practical documentation operating model: reusable packs,
                guided AI drafting, review guardrails, validation, examples, and publishing paths that live in the repo.
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
                <p className="panel-label">Why this rebuild is better</p>
                <h2>Clearer structure, stronger proof, lower friction.</h2>
                <p>
                  The site now behaves like a documentation product: a focused homepage, a real docs hub,
                  and obvious paths into installation, validation, and reference examples.
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
            <h2>Most internal docs workflows still break at the exact points teams need trust.</h2>
            <p>
              Teams can draft faster than ever, but they still struggle to keep structure consistent,
              prove alignment with source contracts, and publish something that survives product change.
            </p>
          </article>
          <article className="surface-card surface-card--cool">
            <p className="section-kicker">Approach</p>
            <h2>RepoDocs AI turns documentation into a repeatable delivery system.</h2>
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
            <p className="section-kicker">Workflow</p>
            <h2>From repository bootstrap to published docs in four steps.</h2>
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
            <p className="section-kicker">Proof</p>
            <h2>The fast trust path is built into the site.</h2>
            <p>
              Start with installation, inspect the payments reference, then review implementation and testing artifacts.
              The visitor no longer has to infer whether the system is real.
            </p>
            <div className="inline-links">
              <Link href="/docs/installation">Installation</Link>
              <Link href="/docs/testing-strategy">Testing strategy</Link>
              <Link href="/docs/implementation-status">Implementation status</Link>
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
            <p className="section-kicker">What you can do next</p>
            <h2>Use the docs hub as the public face, and the repository as the working system.</h2>
            <p>
              The redesign keeps the product grounded in the repository. Docs pages explain the workflow,
              while GitHub remains the place to inspect templates, prompts, generated examples, and automation code.
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