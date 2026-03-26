import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";

export default function PaymentsExampleEndpointsPage(): JSX.Element {
  return (
    <Layout
      title="Payments example endpoints"
      description="Published create and retrieve payment example pages for the RepoDocs AI payments example."
    >
      <main className="content-shell example-page">
        <section className="surface-card surface-card--warm example-hero">
          <p className="section-kicker">Payments example</p>
          <h1>Create and retrieve payment</h1>
          <p className="example-lead">
            These two endpoints show the core request-response shape a buyer expects to see in a
            credible payments API example: how money is created and how status is retrieved.
          </p>
          <div className="hero-actions">
            <Link className="hero-action hero-action--primary" href="/payments-example">
              Back to example index
            </Link>
            <Link
              className="hero-action hero-action--secondary"
              href="https://github.com/SulagnaSasmal/repodocs-ai/tree/main/examples/payments-api"
            >
              View source
            </Link>
          </div>
        </section>

        <section className="section-grid">
          <article className="surface-card surface-card--plain">
            <p className="section-kicker">Endpoint</p>
            <h2>Create payment</h2>
            <p>POST /payments creates a payment for a customer checkout session.</p>
            <ul className="bullet-list">
              <li>Auth: Bearer token required</li>
              <li>Body: amount, currency, customer_id, optional payment_method_id</li>
              <li>Idempotency: send Idempotency-Key on create requests</li>
            </ul>
            <pre>
              <code>{`curl -X POST "https://api.startup-payments.example/v1/payments" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":125.5,"currency":"USD","customer_id":"cus_123","payment_method_id":"pm_123"}'`}</code>
            </pre>
            <pre>
              <code>{`{
  "payment_id": "pay_123",
  "status": "pending",
  "amount": 125.5,
  "currency": "USD"
}`}</code>
            </pre>
          </article>
          <article className="surface-card surface-card--cool">
            <p className="section-kicker">Endpoint</p>
            <h2>Retrieve payment</h2>
            <p>GET /payments/{'{id}'} retrieves the current state and metadata for a payment.</p>
            <ul className="bullet-list">
              <li>Auth: Bearer token required</li>
              <li>Path parameter: id</li>
              <li>Common errors: 401 Unauthorized, 404 Payment not found</li>
            </ul>
            <pre>
              <code>{`curl -X GET "https://api.startup-payments.example/v1/payments/pay_123" \
  -H "Authorization: Bearer <token>"`}</code>
            </pre>
            <pre>
              <code>{`{
  "payment_id": "pay_123",
  "status": "completed",
  "amount": 125.5,
  "currency": "USD"
}`}</code>
            </pre>
          </article>
        </section>

        <section className="surface-card surface-card--dark">
          <p className="section-kicker">Related guidance</p>
          <h2>These endpoints depend on the shared operational model.</h2>
          <p>
            The example endpoint docs refer back to authentication, error handling, idempotency, and
            webhook delivery so the example reads like a complete API, not isolated endpoint fragments.
          </p>
          <div className="inline-links">
            <Link href="/payments-example/authentication">Authentication</Link>
            <Link href="/payments-example/operational-model">Operational model</Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}