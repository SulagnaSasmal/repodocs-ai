import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";

export default function PaymentsExampleAuthenticationPage(): JSX.Element {
  return (
    <Layout
      title="Payments example authentication"
      description="Published authentication guide for the RepoDocs AI payments example."
    >
      <main className="content-shell example-page">
        <section className="surface-card surface-card--warm example-hero">
          <p className="section-kicker">Payments example</p>
          <h1>Authentication</h1>
          <p className="example-lead">
            The sample API uses bearer token authentication for all server-to-server requests, with
            scope-based access across create, read, refund, and webhook access patterns.
          </p>
          <div className="hero-actions">
            <Link className="hero-action hero-action--primary" href="/payments-example">
              Back to example index
            </Link>
            <Link
              className="hero-action hero-action--secondary"
              href="https://github.com/SulagnaSasmal/repodocs-ai/blob/main/examples/payments-api/authentication.md"
            >
              View source
            </Link>
          </div>
        </section>

        <section className="section-grid">
          <article className="surface-card surface-card--plain">
            <h2>How it works</h2>
            <p>Clients send an access token in the Authorization header.</p>
            <pre>
              <code>{`curl -X GET "https://api.startup-payments.example/v1/payments/pay_123" \
  -H "Authorization: Bearer <token>"`}</code>
            </pre>
          </article>
          <article className="surface-card surface-card--cool">
            <h2>Recommended token handling</h2>
            <ul className="bullet-list">
              <li>Issue tokens per environment and client application.</li>
              <li>Rotate credentials regularly.</li>
              <li>Never expose secret tokens in browser-based flows.</li>
              <li>Store production credentials in a secret manager, not source control.</li>
            </ul>
          </article>
        </section>

        <section className="section-grid">
          <article className="surface-card surface-card--dark">
            <p className="section-kicker">Authorization model</p>
            <h2>Typical scopes</h2>
            <ul className="bullet-list">
              <li>payments:create</li>
              <li>payments:read</li>
              <li>payments:refund</li>
              <li>webhooks:read</li>
            </ul>
          </article>
          <article className="surface-card surface-card--plain">
            <p className="section-kicker">Failure mode</p>
            <h2>Unauthorized requests return structured errors.</h2>
            <p>
              Authentication failures should return 401 Unauthorized with a stable error code and a
              trace identifier so support and client teams can diagnose failures consistently.
            </p>
            <div className="inline-links">
              <Link href="/payments-example/api-overview">API overview</Link>
              <Link href="/payments-example/operational-model">Operational model</Link>
            </div>
          </article>
        </section>
      </main>
    </Layout>
  );
}