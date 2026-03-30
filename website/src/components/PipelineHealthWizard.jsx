import React, { useState } from "react";

/* ──────────────────────────────────────────────────────────
   PipelineHealthWizard — 4-step content-pipeline health checker
   Drop into Docusaurus src/components/, import in any MDX page.
   No deps beyond React. Styled with inline styles (Tailwind-like).
   ────────────────────────────────────────────────────────── */

// ─── Option data ────────────────────────────────────────

const SOURCE_FORMATS = [
  { value: "dita-xml", label: "DITA / XML" },
  { value: "markdown", label: "Markdown" },
  { value: "compiled-html", label: "Compiled HTML" },
  { value: "word-unstructured", label: "Word / Unstructured" },
];

const TRANSFORM_LAYERS = [
  { value: "direct-publish", label: "Direct publish" },
  { value: "ssg", label: "Static site generator" },
  { value: "cms-ccms", label: "CMS / CCMS" },
  { value: "compiled-reprocessed", label: "Compiled-then-reprocessed" },
];

const DELIVERY_SURFACES = [
  { value: "docs-site", label: "Docs site" },
  { value: "in-app-help", label: "In-app help" },
  { value: "ai-chatbot-rag", label: "AI chatbot / RAG" },
  { value: "api-reference", label: "API reference" },
  { value: "ai-assistant-copilot", label: "AI assistant / Copilot" },
];

const QUALITY_GATES = [
  { value: "human-review", label: "Human review" },
  { value: "automated-linting", label: "Automated linting" },
  { value: "semantic-validation", label: "Semantic validation" },
  { value: "post-publish-qa", label: "Post-publish QA" },
  { value: "none", label: "None" },
];

// ─── Risk matrix ────────────────────────────────────────

const RISK_LEVEL = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

/**
 * Returns { risk, issue, fix } for a given surface + source + transform combo.
 */
function assessSurface(surface, source, transform) {
  // Base risk score: higher = riskier  (0-4 scale)
  const sourceRisk = {
    "dita-xml": 0,
    markdown: 1,
    "compiled-html": 3,
    "word-unstructured": 4,
  };
  const transformRisk = {
    "cms-ccms": 0,
    ssg: 1,
    "direct-publish": 2,
    "compiled-reprocessed": 4,
  };
  // Surface-specific weights — AI surfaces are harder to feed cleanly
  const surfaceWeight = {
    "docs-site": 0,
    "in-app-help": 1,
    "ai-chatbot-rag": 3,
    "api-reference": 1,
    "ai-assistant-copilot": 3,
  };

  const raw = sourceRisk[source] + transformRisk[transform] + surfaceWeight[surface];
  const risk = raw >= 7 ? RISK_LEVEL.HIGH : raw >= 4 ? RISK_LEVEL.MEDIUM : RISK_LEVEL.LOW;

  // Issue + fix lookup keyed on surface
  const details = {
    "docs-site": {
      [RISK_LEVEL.HIGH]: {
        issue: "Unstructured source with weak transform produces inconsistent page layouts and broken navigation.",
        fix: "Migrate to a structured source (Markdown/DITA) and process through an SSG or CMS with defined templates.",
      },
      [RISK_LEVEL.MEDIUM]: {
        issue: "Content reaches the docs site but metadata (titles, descriptions, hierarchy) may be incomplete.",
        fix: "Add frontmatter validation in CI and enforce a metadata schema before build.",
      },
      [RISK_LEVEL.LOW]: {
        issue: "Pipeline is well-suited for docs site delivery.",
        fix: "Maintain current pipeline; add periodic link-checking and accessibility audits.",
      },
    },
    "in-app-help": {
      [RISK_LEVEL.HIGH]: {
        issue: "Bulky or poorly chunked content degrades in-app widget performance and relevance.",
        fix: "Introduce topic-based chunking at the transform layer and strip non-essential markup before delivery.",
      },
      [RISK_LEVEL.MEDIUM]: {
        issue: "Content may render but context-sensitivity (product area → help topic) is unreliable.",
        fix: "Map content IDs to product UI anchors; validate mapping in integration tests.",
      },
      [RISK_LEVEL.LOW]: {
        issue: "In-app help receives well-structured, context-relevant content.",
        fix: "Continue current approach; consider analytics to measure topic usefulness.",
      },
    },
    "ai-chatbot-rag": {
      [RISK_LEVEL.HIGH]: {
        issue: "Source format and transform layer produce content that is hard to embed — poor chunking, mixed markup, and missing semantic boundaries cause hallucination-prone retrieval.",
        fix: "Pre-process into clean Markdown with explicit section headings; add semantic metadata (topic type, product area) and run embedding quality checks before index refresh.",
      },
      [RISK_LEVEL.MEDIUM]: {
        issue: "RAG retrieval works but chunk quality is uneven; some queries return noisy or overlapping passages.",
        fix: "Standardize chunk sizes, add overlap tuning, and introduce a retrieval-evaluation test suite.",
      },
      [RISK_LEVEL.LOW]: {
        issue: "Content is well-structured for RAG ingestion.",
        fix: "Add a scheduled retrieval-accuracy benchmark against golden Q&A pairs.",
      },
    },
    "api-reference": {
      [RISK_LEVEL.HIGH]: {
        issue: "API reference generated from unstructured sources risks missing endpoints, wrong parameter types, and stale examples.",
        fix: "Generate API reference from an OpenAPI/AsyncAPI spec as the single source of truth; validate spec in CI.",
      },
      [RISK_LEVEL.MEDIUM]: {
        issue: "API docs exist but may drift from implementation; examples may not compile.",
        fix: "Add spec-diffing in CI and auto-test code samples against a sandbox.",
      },
      [RISK_LEVEL.LOW]: {
        issue: "API reference pipeline is spec-driven and well-validated.",
        fix: "Add contract testing to catch upstream spec regressions before publish.",
      },
    },
    "ai-assistant-copilot": {
      [RISK_LEVEL.HIGH]: {
        issue: "Copilot/AI-assistant context is fed unstructured or ambiguously formatted content, leading to unreliable code suggestions and wrong-context answers.",
        fix: "Restructure content into task-oriented, code-adjacent snippets with explicit metadata; validate against a Copilot-context test harness.",
      },
      [RISK_LEVEL.MEDIUM]: {
        issue: "AI assistant receives content but lacks granular metadata to scope suggestions to the correct product area.",
        fix: "Tag each content unit with product, version, and audience metadata; add a context-window budget check.",
      },
      [RISK_LEVEL.LOW]: {
        issue: "Content is well-structured and tagged for AI-assistant consumption.",
        fix: "Periodically benchmark suggestion accuracy and expand coverage to new product surfaces.",
      },
    },
  };

  const d = details[surface]?.[risk] ?? {
    issue: "Unable to assess — review pipeline manually.",
    fix: "Audit source → transform → surface path end-to-end.",
  };

  return { risk, issue: d.issue, fix: d.fix };
}

// ─── Gate recommendations ───────────────────────────────

function generateGates(source, transform, selectedGates) {
  const gate1 = []; // Pre-input assessment
  const gate2 = []; // Go-Live validation

  // Gate 1 — always-present baseline
  gate1.push("Verify source files parse without errors (schema/lint check).");
  gate1.push("Confirm transform pipeline builds with zero warnings.");

  if (source === "word-unstructured" || source === "compiled-html") {
    gate1.push("Run structure extraction to normalize headings, lists, and tables before transformation.");
  }
  if (source === "dita-xml") {
    gate1.push("Validate DITA maps and topic references resolve correctly.");
  }
  if (transform === "compiled-reprocessed") {
    gate1.push("Snapshot intermediate compiled output and diff against previous build for unexpected changes.");
  }
  if (transform === "direct-publish") {
    gate1.push("Ensure publish target accepts the source format without silent data loss.");
  }

  if (selectedGates.includes("automated-linting")) {
    gate1.push("Execute automated linting rules and block on any severity ≥ warning.");
  }
  if (selectedGates.includes("semantic-validation")) {
    gate1.push("Run semantic-validation suite (metadata completeness, cross-reference integrity).");
  }

  // Gate 2 — Go-Live
  gate2.push("Smoke-test every delivery surface URL / endpoint for 200 status.");
  gate2.push("Verify table of contents, search index, and navigation integrity.");

  if (selectedGates.includes("human-review")) {
    gate2.push("Obtain sign-off from a subject-matter expert on changed pages.");
  }
  if (selectedGates.includes("post-publish-qa")) {
    gate2.push("Run post-publish QA checklist: broken links, image rendering, mobile layout, accessibility.");
  }
  if (selectedGates.includes("none")) {
    gate2.push("⚠ No quality gates selected — strongly recommend adding at least automated linting and post-publish QA.");
  }

  gate2.push("Tag release in version control and archive build artifacts.");

  return { gate1, gate2 };
}

// ─── Styles (Tailwind-like, inline) ─────────────────────

const clr = {
  bg: "#f2ecdf",
  surface: "rgba(255,250,241,0.92)",
  ink: "#15211f",
  muted: "#4a5e59",
  primary: "#b04a1f",
  primaryLight: "#e28659",
  moss: "#2f6a59",
  olive: "#6e7b3b",
  line: "rgba(21,33,31,0.10)",
  lineStrong: "rgba(21,33,31,0.18)",
  glow: "rgba(176,74,31,0.16)",
  white: "#fffaf3",
  red: "#c0392b",
  amber: "#d4880f",
  green: "#27855a",
};

const s = {
  card: {
    background: clr.surface,
    borderRadius: 22,
    padding: "2rem",
    maxWidth: 720,
    margin: "2rem auto",
    boxShadow: "0 22px 60px rgba(21,33,31,0.12)",
    fontFamily: '"IBM Plex Sans","Segoe UI",sans-serif',
    color: clr.ink,
  },
  heading: {
    fontFamily: '"Space Grotesk","Segoe UI",sans-serif',
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: "0.25rem",
  },
  stepLabel: {
    fontSize: "0.8rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: clr.muted,
    marginBottom: "0rem",
  },
  question: {
    fontSize: "1.1rem",
    fontWeight: 600,
    marginBottom: "1rem",
    lineHeight: 1.5,
  },
  optionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0.55rem 0.75rem",
    borderRadius: 10,
    cursor: "pointer",
    transition: "background 0.15s",
    fontSize: "0.95rem",
  },
  btnPrimary: {
    background: clr.primary,
    color: clr.white,
    border: "none",
    borderRadius: 12,
    padding: "0.6rem 1.6rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s",
  },
  btnSecondary: {
    background: "transparent",
    color: clr.muted,
    border: `1.5px solid ${clr.lineStrong}`,
    borderRadius: 12,
    padding: "0.6rem 1.4rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  progressTrack: {
    display: "flex",
    gap: 6,
    marginBottom: "1.5rem",
  },
  progressDot: (active, done) => ({
    flex: 1,
    height: 5,
    borderRadius: 5,
    background: done ? clr.moss : active ? clr.primary : clr.line,
    transition: "background 0.25s",
  }),
  riskBadge: (risk) => ({
    display: "inline-block",
    padding: "0.15rem 0.6rem",
    borderRadius: 8,
    fontSize: "0.78rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#fff",
    background:
      risk === RISK_LEVEL.HIGH
        ? clr.red
        : risk === RISK_LEVEL.MEDIUM
          ? clr.amber
          : clr.green,
  }),
  surfaceCard: {
    border: `1px solid ${clr.lineStrong}`,
    borderRadius: 14,
    padding: "1rem 1.25rem",
    marginBottom: "0.85rem",
  },
  gateBox: {
    background: clr.bg,
    borderRadius: 14,
    padding: "1rem 1.25rem",
    marginBottom: "1rem",
  },
  gateTitle: {
    fontWeight: 700,
    fontSize: "1rem",
    marginBottom: "0.5rem",
  },
  ol: {
    paddingLeft: "1.25rem",
    margin: 0,
    lineHeight: 1.75,
    fontSize: "0.92rem",
  },
};

// ─── Sub-components ─────────────────────────────────────

function ProgressBar({ step, total }) {
  return (
    <div style={s.progressTrack} role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={s.progressDot(i === step, i < step)} />
      ))}
    </div>
  );
}

function RadioGroup({ options, value, onChange }) {
  return (
    <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {options.map((opt) => (
        <label
          key={opt.value}
          style={{
            ...s.optionLabel,
            background: value === opt.value ? clr.glow : "transparent",
          }}
        >
          <input
            type="radio"
            name={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ accentColor: clr.primary }}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function CheckboxGroup({ options, selected, onChange }) {
  const toggle = (val) => {
    if (val === "none") {
      onChange(selected.includes("none") ? [] : ["none"]);
      return;
    }
    const without = selected.filter((v) => v !== "none");
    onChange(
      without.includes(val) ? without.filter((v) => v !== val) : [...without, val]
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {options.map((opt) => (
        <label
          key={opt.value}
          style={{
            ...s.optionLabel,
            background: selected.includes(opt.value) ? clr.glow : "transparent",
          }}
        >
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            style={{ accentColor: clr.primary }}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function Nav({ onBack, onNext, disableNext, nextLabel = "Next →", showBack = true }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
      {showBack ? (
        <button type="button" style={s.btnSecondary} onClick={onBack}>
          ← Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        style={{ ...s.btnPrimary, opacity: disableNext ? 0.45 : 1 }}
        onClick={onNext}
        disabled={disableNext}
      >
        {nextLabel}
      </button>
    </div>
  );
}

// ─── Report ─────────────────────────────────────────────

function Report({ source, transform, surfaces, gates, onRestart }) {
  const surfaceResults = surfaces.map((surf) => {
    const meta = DELIVERY_SURFACES.find((d) => d.value === surf);
    return { ...assessSurface(surf, source, transform), label: meta?.label ?? surf };
  });

  const { gate1, gate2 } = generateGates(source, transform, gates);

  return (
    <div>
      <p style={s.stepLabel}>Report</p>
      <h2 style={{ ...s.heading, marginBottom: "1.25rem" }}>Pipeline Health Assessment</h2>

      {/* Summary line */}
      <p style={{ fontSize: "0.92rem", color: clr.muted, marginBottom: "1.25rem", lineHeight: 1.6 }}>
        <strong>Source:</strong> {SOURCE_FORMATS.find((o) => o.value === source)?.label} &nbsp;→&nbsp;{" "}
        <strong>Transform:</strong> {TRANSFORM_LAYERS.find((o) => o.value === transform)?.label}
      </p>

      {/* Surface break-point map */}
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>
        Surface Break-Point Map
      </h3>
      {surfaceResults.map((r) => (
        <div key={r.label} style={s.surfaceCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            <span style={s.riskBadge(r.risk)}>{r.risk}</span>
          </div>
          <p style={{ fontSize: "0.88rem", color: clr.muted, margin: "0.3rem 0" }}>
            <strong>Issue:</strong> {r.issue}
          </p>
          <p style={{ fontSize: "0.88rem", color: clr.moss, margin: "0.3rem 0" }}>
            <strong>Fix:</strong> {r.fix}
          </p>
        </div>
      ))}

      {/* Two-gate output */}
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "1.25rem 0 0.75rem" }}>
        Quality Gates
      </h3>

      <div style={s.gateBox}>
        <p style={s.gateTitle}>Gate 1 — Pre-Input Assessment</p>
        <ol style={s.ol}>
          {gate1.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      </div>

      <div style={s.gateBox}>
        <p style={s.gateTitle}>Gate 2 — Go-Live Validation</p>
        <ol style={s.ol}>
          {gate2.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      </div>

      {/* Restart */}
      <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
        <button type="button" style={s.btnPrimary} onClick={onRestart}>
          ↻ Start Over
        </button>
      </div>
    </div>
  );
}

// ─── Main Wizard ────────────────────────────────────────

export default function PipelineHealthWizard() {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState("");
  const [transform, setTransform] = useState("");
  const [surfaces, setSurfaces] = useState([]);
  const [gates, setGates] = useState([]);

  const TOTAL_STEPS = 4; // 0-3

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const restart = () => {
    setStep(0);
    setSource("");
    setTransform("");
    setSurfaces([]);
    setGates([]);
  };

  const stepContent = () => {
    switch (step) {
      case 0:
        return (
          <>
            <p style={s.stepLabel}>Step 1 of 4</p>
            <p style={s.question}>What is your primary source format?</p>
            <RadioGroup options={SOURCE_FORMATS} value={source} onChange={setSource} />
            <Nav showBack={false} onNext={next} disableNext={!source} />
          </>
        );
      case 1:
        return (
          <>
            <p style={s.stepLabel}>Step 2 of 4</p>
            <p style={s.question}>Which transformation layer does your content pass through?</p>
            <RadioGroup options={TRANSFORM_LAYERS} value={transform} onChange={setTransform} />
            <Nav onBack={back} onNext={next} disableNext={!transform} />
          </>
        );
      case 2:
        return (
          <>
            <p style={s.stepLabel}>Step 3 of 4</p>
            <p style={s.question}>Which delivery surfaces does your content reach? (select all that apply)</p>
            <CheckboxGroup options={DELIVERY_SURFACES} selected={surfaces} onChange={setSurfaces} />
            <Nav onBack={back} onNext={next} disableNext={surfaces.length === 0} />
          </>
        );
      case 3:
        return (
          <>
            <p style={s.stepLabel}>Step 4 of 4</p>
            <p style={s.question}>Which quality gates are currently in place? (select all that apply)</p>
            <CheckboxGroup options={QUALITY_GATES} selected={gates} onChange={setGates} />
            <Nav onBack={back} onNext={next} disableNext={gates.length === 0} nextLabel="Generate Report →" />
          </>
        );
      default:
        return (
          <Report
            source={source}
            transform={transform}
            surfaces={surfaces}
            gates={gates}
            onRestart={restart}
          />
        );
    }
  };

  return (
    <div style={s.card}>
      {step < TOTAL_STEPS && <ProgressBar step={step} total={TOTAL_STEPS} />}
      <h2 style={{ ...s.heading, marginBottom: step < TOTAL_STEPS ? "1.25rem" : 0 }}>
        {step < TOTAL_STEPS ? "Content Pipeline Health Checker" : ""}
      </h2>
      {stepContent()}
    </div>
  );
}
