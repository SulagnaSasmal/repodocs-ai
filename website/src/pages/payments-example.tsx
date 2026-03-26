import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";

type ExampleTopic = {
  title: string;
  body: string;
  href: string;
  sourceHref: string;
};

const topics: ExampleTopic[] = [
  {
    title: "API overview",
    body: "A service-level entry point that explains the payments API before endpoint detail starts.",
    href: "/payments-example/api-overview",
    sourceHref: "https://github.com/SulagnaSasmal/repodocs-ai/blob/main/examples/payments-api/api-overview.md"
  },
  {
    title: "Authentication",
    body: "Shared guidance for auth, security expectations, and how developers gain access.",
    href: "/payments-example/authentication",
    sourceHref: "https://github.com/SulagnaSasmal/repodocs-ai/blob/main/examples/payments-api/authentication.md"
  },
  {
    title: "Create and retrieve payment",
    body: "Endpoint docs that show request, response, and operational detail in a Stripe-style structure.",
    href: "/payments-example/payment-endpoints",
    sourceHref: "https://github.com/SulagnaSasmal/repodocs-ai/tree/main/examples/payments-api"
  },
  {
    title: "Errors, idempotency, and webhooks",
    body: "The shared topics developers expect in a serious payments API documentation set.",
    href: "/payments-example/operational-model",
    sourceHref: "https://github.com/SulagnaSasmal/repodocs-ai/tree/main/examples/payments-api"
  }
];

const reviewSteps = [
  "Start with the OpenAPI file to see the contract the example is based on.",
  "Read the API overview and shared topics to judge whether the system feels like real product documentation.",
  "Inspect the endpoint docs and compare them with the shipped templates and prompts."
];

export default function PaymentsExamplePage(): JSX.Element {
  return (
    <Layout
      title="Payments example"
      description="Review the RepoDocs AI payments API example as a customer-facing proof page instead of leaving the main route on GitHub."
    >
      <main className="example-page content-shell">
        <section className="example-hero surface-card surface-card--warm">
          <p className="section-kicker">Proof page</p>
          <h1>Payments API example</h1>
          <p className="example-lead">
            This is the trust path for RepoDocs AI: a complete payments documentation set built from the
            shipped templates, prompts, and OpenAPI input rather than a loose collection of starter files.
          </p>
          <div className="hero-actions">
            <Link className="hero-action hero-action--primary" href="/docs/installation">
              Start with installation
            </Link>
            <Link
              className="hero-action hero-action--secondary"
              href="https://github.com/SulagnaSasmal/repodocs-ai/tree/main/examples/payments-api"
            >
              View source on GitHub
            </Link>
          </div>
        </section>

        <section className="example-grid">
          {topics.map((topic) => (
            <article key={topic.title} className="surface-card surface-card--plain example-card">
              <h2>{topic.title}</h2>
              <p>{topic.body}</p>
              <div className="inline-links">
                <Link href={topic.href}>Open example page</Link>
                <Link href={topic.sourceHref}>View source</Link>
              </div>
            </article>
          ))}
        </section>

        <section className="section-grid">
          <article className="surface-card surface-card--cool">
            <p className="section-kicker">What this proves</p>
            <h2>The example shows a finished documentation shape, not just authoring ingredients.</h2>
            <p>
              Buyers should be able to inspect the example and decide whether RepoDocs AI creates documentation
              that looks structured, credible, and reusable before they inspect the internals of the repository.
            </p>
          </article>
          <article className="surface-card surface-card--dark">
            <p className="section-kicker">How to review it</p>
            <ol className="example-steps">
              {reviewSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        </section>
      </main>
    </Layout>
  );
}