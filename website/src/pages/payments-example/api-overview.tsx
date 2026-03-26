import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";

export default function PaymentsExampleApiOverviewPage(): JSX.Element {
  return (
    <Layout
      title="Payments example API overview"
      description="Published API overview for the RepoDocs AI payments example."
    >
      <main className="content-shell example-page">
        <section className="surface-card surface-card--warm example-hero">
          <p className="section-kicker">Payments example</p>
          <h1>API overview</h1>
          <p className="example-lead">
            The Startup Payments API gives product teams a compact surface for creating payments,
            retrieving payment state, and issuing refunds without losing the shared guidance a real
            integration needs.
          </p>
          <div className="hero-actions">
            <Link className="hero-action hero-action--primary" href="/payments-example">
              Back to example index
            </Link>
            <Link
              className="hero-action hero-action--secondary"
              href="https://github.com/SulagnaSasmal/repodocs-ai/blob/main/examples/payments-api/api-overview.md"
            >
              View source
            </Link>
          </div>
        </section>

        <section className="section-grid">
          <article className="surface-card surface-card--plain">
            <h2>Purpose</h2>
            <p>
              This example API supports payment creation, payment retrieval, and refund workflows for
              a startup-style payments platform.
            </p>
            <h2>Intended consumers</h2>
            <ul className="bullet-list">
              <li>checkout applications</li>
              <li>finance and reconciliation tooling</li>
              <li>customer support operations tools</li>
            </ul>
          </article>
          <article className="surface-card surface-card--cool">
            <h2>Platform model</h2>
            <ul className="bullet-list">
              <li>
                <strong>Authentication</strong>
                <span>Bearer token authentication is required for every operation.</span>
              </li>
              <li>
                <strong>Base URL</strong>
                <span>https://api.startup-payments.example/v1</span>
              </li>
              <li>
                <strong>Versioning</strong>
                <span>Breaking changes ship in new major versions; additive changes stay in-version.</span>
              </li>
              <li>
                <strong>Rate limits</strong>
                <span>Requests are rate-limited per client to protect payment and refund workflows.</span>
              </li>
            </ul>
          </article>
        </section>

        <section className="surface-card surface-card--dark">
          <p className="section-kicker">Related guidance</p>
          <h2>Shared platform topics are part of the example, not separate homework.</h2>
          <p>
            The example includes explicit guidance for error handling, idempotency, webhooks, and
            authentication because those are core trust signals in payment APIs.
          </p>
          <div className="inline-links">
            <Link href="/payments-example/authentication">Authentication</Link>
            <Link href="/payments-example/payment-endpoints">Payment endpoints</Link>
            <Link href="/payments-example/operational-model">Operational model</Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}