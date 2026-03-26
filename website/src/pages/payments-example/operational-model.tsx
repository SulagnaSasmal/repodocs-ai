import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";

export default function PaymentsExampleOperationalModelPage(): JSX.Element {
  return (
    <Layout
      title="Payments example operational model"
      description="Published error handling, idempotency, and webhook guidance for the RepoDocs AI payments example."
    >
      <main className="content-shell example-page">
        <section className="surface-card surface-card--warm example-hero">
          <p className="section-kicker">Payments example</p>
          <h1>Errors, idempotency, and webhooks</h1>
          <p className="example-lead">
            Serious payments integrations are judged on failure handling and asynchronous delivery, so
            the example exposes those mechanics directly instead of hiding them in repository files.
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
            <p className="section-kicker">Error handling</p>
            <h2>Structured JSON errors</h2>
            <pre>
              <code>{`{
  "error": {
    "code": "duplicate_payment",
    "message": "A payment with this idempotency key already exists.",
    "trace_id": "trace_9f0e7c",
    "docs_url": "https://docs.startup-payments.example/errors#duplicate_payment"
  }
}`}</code>
            </pre>
            <ul className="bullet-list">
              <li>400: invalid JSON, missing fields, unsupported currency</li>
              <li>401: missing or invalid bearer token</li>
              <li>409: duplicate create or conflicting refund request</li>
              <li>429: client exceeded rate limit</li>
            </ul>
          </article>
          <article className="surface-card surface-card--cool">
            <p className="section-kicker">Idempotency</p>
            <h2>Retry-safe write operations</h2>
            <p>
              Clients should send an Idempotency-Key header on payment creation and refund requests.
              The first valid request creates the resource, repeated requests return the original
              result, and key reuse with a different payload should return a conflict.
            </p>
            <pre>
              <code>{`curl -X POST "https://api.startup-payments.example/v1/payments" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3d8f7d89-a0c5-4f54-97f2-3a4ef83da3b4" \
  -d '{"amount":125.5,"currency":"USD","customer_id":"cus_123"}'`}</code>
            </pre>
          </article>
        </section>

        <section className="surface-card surface-card--dark">
          <p className="section-kicker">Webhooks</p>
          <h2>Asynchronous payment lifecycle delivery</h2>
          <ul className="bullet-list">
            <li>Events are delivered with POST requests to a customer HTTPS endpoint.</li>
            <li>Deliveries should be signed and timestamped.</li>
            <li>Non-2xx responses trigger retries with backoff.</li>
            <li>Core example events include payment.created, payment.completed, payment.failed, and payment.refunded.</li>
          </ul>
          <pre>
            <code>{`{
  "id": "evt_123",
  "type": "payment.completed",
  "created": "2026-03-12T11:42:00Z",
  "data": {
    "payment_id": "pay_123",
    "status": "completed",
    "amount": 125.5,
    "currency": "USD"
  }
}`}</code>
          </pre>
          <div className="inline-links">
            <Link href="/payments-example/api-overview">API overview</Link>
            <Link href="/payments-example/payment-endpoints">Payment endpoints</Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}