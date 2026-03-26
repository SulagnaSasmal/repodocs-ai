import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";

const demoHighlights = [
  "Why API teams outgrow scattered templates, docs folders, and ad hoc documentation workflows.",
  "How RepoDocs AI packages templates, validation, publishing, and proof into one repository-based system.",
  "What buyers can inspect immediately: install path, live docs, payments example, and working repository assets."
];

export default function DemoPage(): JSX.Element {
  const videoUrl = useBaseUrl("/demo/repodocs-ai-demo.mp4");
  const posterUrl = useBaseUrl("/demo/repodocs-ai-demo-poster.jpg");

  return (
    <Layout
      title="Product demo"
      description="Watch the narrated RepoDocs AI product demo and evaluate the product from problem statement to proof."
    >
      <main className="demo-page content-shell">
        <div className="demo-shell">
          <section className="surface-card surface-card--warm">
            <p className="section-kicker">Narrated demo</p>
            <h1>Watch the RepoDocs AI sales demo.</h1>
            <p className="example-lead">
              This walkthrough explains the product problem, the system RepoDocs AI installs into your repository,
              and the proof points buyers can inspect before adopting it.
            </p>
            <div className="hero-actions">
              <Link className="hero-action hero-action--primary" href="/docs/installation">
                Install in 5 minutes
              </Link>
              <Link className="hero-action hero-action--secondary" href="/payments-example">
                Review the payments example
              </Link>
            </div>
          </section>

          <section className="surface-card surface-card--plain demo-video-shell">
            <video className="demo-video" controls preload="metadata" poster={posterUrl}>
              <source src={videoUrl} type="video/mp4" />
            </video>
          </section>

          <section className="demo-meta-grid">
            <article className="surface-card surface-card--cool">
              <p className="section-kicker">What this covers</p>
              <h2>A short sales narrative built around product proof.</h2>
              <ol className="demo-list">
                {demoHighlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </article>

            <article className="surface-card surface-card--dark">
              <p className="section-kicker">Next step</p>
              <h2>Use the demo as the buyer path, then inspect the live product surface.</h2>
              <p>
                Start with the narrated pitch, move into the docs hub, and verify the implementation details with
                the payments example and repository assets.
              </p>
              <div className="inline-links">
                <Link href="/docs">Docs hub</Link>
                <Link href="/payments-example">Payments example</Link>
              </div>
            </article>
          </section>
        </div>
      </main>
    </Layout>
  );
}