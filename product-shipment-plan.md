# Product Shipment Plan
## DocCraft AI + RepoDocs AI
### Sulagna Sasmal — Solo Founder
**April 2026**

---

## The Strategic Frame

Before any tactics: the Hyperlint post-mortem identified three failure modes that both your products must be designed around.

**Failure mode 1: Wrong buyer.** Technical writers don't hold budgets. Engineers do.
**Failure mode 2: Onboarding friction.** If it takes more than one step to see value, adoption stalls.
**Failure mode 3: The 80/20 trap.** If a general-purpose tool (Claude.ai, ChatGPT) gets users to 80% of your value, your product has to own the remaining 20% clearly and explicitly.

Every decision in this plan flows from those three lessons.

---

## DOCCRAFT AI

### What It Is Now

A browser-based documentation generator. User uploads source material (PDF, DOCX, TXT, MD, images, JSON), configures output type and audience, and DocCraft generates production-ready technical documentation. It includes gap analysis, MSTP compliance checking, Mermaid diagram generation, OCR ingestion, PDF split/merge, and a 5-step workflow (Upload → Analyse → Review → Generate → Edit).

Live at: doccraft-ten.vercel.app
Stack: Next.js, GPT-4o, Vercel

### The Core Problem It Solves

A technical writer has raw material (meeting notes, spec sheets, API logs, scanned PDFs) and needs structured, publication-ready documentation. Without DocCraft, that process takes hours. With DocCraft, it takes minutes.

### The 20% Delta (What Claude.ai Cannot Do)

This must be on the homepage. Explicitly. Visitors will ask it silently and leave if you don't answer it.

| What Claude.ai gives you | What DocCraft adds |
|---|---|
| Generic text output | Document-type-specific structure (User Guide, API Reference, Release Notes, etc.) |
| One-shot generation | 5-stage workflow with gap analysis before generation |
| No file handling | Native PDF/DOCX/image ingestion including OCR |
| No style enforcement | MSTP compliance checking built in |
| Manual formatting | Mermaid diagram auto-generation integrated in editor |
| Stateless | Cloud save, team features, GitHub publishing (sign-in tier) |

---

### Phase 1: Stabilise and Signal (Weeks 1–3)

**Goal:** Make the product look as real as it is. Right now, DocCraft has the depth of a mature tool but the surface of a prototype. Close that gap.

#### 1.1 Homepage Rewrite

The current homepage is the app itself — the generator UI loads immediately. That is the wrong first impression for a new visitor. You need a marketing layer in front of the tool.

**New homepage structure:**

```
Hero section
  Headline:    From raw notes to production-ready docs. In minutes.
  Subheadline: DocCraft AI ingests your specs, meeting notes, PDFs, and screenshots.
               It fills the gaps, applies your style, and generates structured documentation
               — User Guides, API References, Release Notes, and more.
  CTA:         Try it free  (no sign-in required)
  Visual:      60-second demo GIF showing: paste → analyse → generate → output

"Why not just use ChatGPT?" section  ← THIS IS CRITICAL
  Explicit comparison table (see 20% delta above)

How it works  (3 steps, icon + one sentence each)
  1. Drop your source material
  2. Choose your output type and audience
  3. Get publication-ready documentation

Document types supported  (grid of cards)
  User Guide / API Reference / Quick Start / Troubleshooting / Release Notes

Feature callouts
  - AI Gap Analysis: catches missing information before generation
  - MSTP Compliance: style and terminology checks built in
  - OCR Ingestion: extract text from scanned PDFs
  - Mermaid Diagrams: auto-generated flowcharts in the editor

Social proof (when available)
  Quotes, usage numbers, LinkedIn post screenshots

Footer
  Link to Help Center / Blog / GitHub / Portfolio
```

#### 1.2 Build the 60-Second Demo GIF

This is the single highest-leverage asset you can create right now. VectorLint has it on their homepage. Hyperlint didn't. That difference matters.

**What to record:**
- Paste a short block of raw text (10-line meeting note or spec)
- Select "User Guide" + "Non-Technical" + "Instructional"
- Click Analyse
- Show the gap analysis panel appearing
- Click Generate
- Show the formatted output appearing

Keep it under 60 seconds. No narration needed. Let the UI speak.

Tool to use: Loom (free), or the GIF creator tool in Chrome.

#### 1.3 Move the App to a Subdomain

Currently the marketing page and the app are the same URL. Separate them:

- `doccraft.ai` or `doccraft-ai.com` — marketing site (if you acquire a domain)
- OR use the existing Vercel URL as the app and build a GitHub Pages marketing site at `sulagnasasmal.github.io/doccraft/`

VectorLint model: `vectorlint.dev` (marketing) + `app.vectorlint.dev` (the tool). Follow this pattern.

#### 1.4 Custom Domain

`doccraft-ten.vercel.app` communicates "prototype." A custom domain communicates "product." Options:
- `doccraft.ai` (likely taken or expensive)
- `docraftai.com` (check availability)
- `getdoccraft.com` (available pattern, commonly used)
- `doccraft.app` (clean, available pattern)

Budget: under $20/year on Namecheap or Porkbun.

---

### Phase 2: Distribution (Weeks 3–6)

**Goal:** Get DocCraft in front of the right people through the right channels. Not volume. Precision.

#### 2.1 LinkedIn Company Page

Create a LinkedIn Company Page for DocCraft AI.
- Name: DocCraft AI
- Tagline: From raw notes to production-ready documentation. In minutes.
- Website: your domain
- Size: 1-10
- Type: Software Company
- Logo: your existing DocCraft mark
- Cover: the demo GIF still or a clean product screenshot

Post from the company page 2x per week. Link it to your personal profile as "Founder, DocCraft AI."

#### 2.2 Target Audience Expansion: Engineers, Not Just Writers

This is the Hyperlint lesson applied directly. Technical writers don't have budget. Engineers do, and they have a doc problem too: their internal tools and APIs are undocumented or poorly documented.

**New ICP addition:** Software engineers at startups who need internal tool documentation, API documentation, or onboarding guides but don't have a technical writer.

This doesn't require a product change. It requires a messaging change on the homepage and in your LinkedIn content:

*"Your engineers shouldn't be writing documentation. DocCraft turns their specs and notes into structured docs automatically."*

#### 2.3 Content: One Post Per Feature, Per Week

Each DocCraft feature is a LinkedIn post. Not a product announcement. A problem-solution narrative.

**Content calendar template:**

| Week | Feature | Angle |
|---|---|---|
| 1 | Gap Analysis | "The documentation review that catches what you missed" |
| 2 | OCR Ingestion | "Your scanned PDFs are source material now" |
| 3 | MSTP Compliance | "Style guide enforcement without Vale configuration" |
| 4 | Mermaid Diagrams | "From text to flowchart in one click" |
| 5 | 5-step workflow | "Why generation without analysis produces garbage" |
| 6 | Document types | "Not all documentation is a user guide" |

Each post ends with: "Try it free at [URL]. No sign-in required."

#### 2.4 Dev.to / Hashnode Build Log

You have a blog post at your Hugo blog. Cross-post to Dev.to and Hashnode. Engineers read those. Technical writers don't, but engineering managers do, and they're the buyer.

Topics that perform well:
- "I built a documentation generator as a solo founder. Here's what I learned."
- "Why AI-generated docs fail (and how gap analysis fixes it)"
- "From scanned PDFs to structured documentation: how DocCraft's OCR pipeline works"

---

### Phase 3: Monetisation (Weeks 6–10)

**Goal:** Move from "free tool" to "product with a revenue model." Currently DocCraft is free. That is fine for traction but not for sustainability.

#### 3.1 Tier Model

| Tier | Price | What's included |
|---|---|---|
| Free | $0 | 5 generations/month, all document types, no sign-in required, watermarked output |
| Solo | $9/month | Unlimited generations, no watermark, cloud save, export to DOCX/MD |
| Team | $29/month | Everything in Solo + GitHub publishing, team workspace, usage analytics |
| Enterprise | Custom | SSO, custom style guides, SLA, dedicated support |

**Why this structure:**
- Free tier removes onboarding friction entirely (Hyperlint's fatal flaw)
- Solo tier is priced at "one coffee meeting" — easy to expense or self-fund
- Team tier targets the engineering team buyer, not the solo writer
- Enterprise is the long-term revenue ceiling

#### 3.2 Gating Strategy

Gate on volume, not features. The worst thing you can do is put gap analysis or MSTP compliance behind a paywall — those are your 20% delta features. They must be free to try. Gate on output volume and collaboration features instead.

#### 3.3 Payment Stack

- Stripe for billing (standard)
- Lemon Squeezy as an alternative (easier for solo founders, handles VAT)
- No enterprise billing until you have 3+ enterprise-tier conversations

---

### Phase 4: Retention and Trust (Ongoing)

#### 4.1 Help Center

You already have this at `sulagnasasmal.github.io/doccraft-help-center/`. Make sure it is:
- Linked from the marketing homepage
- Linked from inside the app (you have this)
- Kept current with every feature change

#### 4.2 Release Notes

Publish release notes every 2 weeks, even for small changes. This signals to visitors that the product is actively maintained. Bill's post-mortem noted that "model improvements" made his product irrelevant. Your release notes communicate the opposite: this product evolves.

#### 4.3 Feedback Loop

Add a one-question survey trigger after generation: "Did this output meet your needs? Yes / Partially / No." Even without a response pipeline, showing the prompt builds trust. With responses, it tells you what to fix.

---

---

## REPODOCS AI

### What It Is Now

A GitHub Pages-hosted tool that generates structured documentation for GitHub repositories. A user provides a repo URL and RepoDocs generates a Docusaurus-formatted documentation site covering the repo's architecture, setup, API, and usage.

Live at: sulagnasasmal.github.io/repodocs-ai
Stack: Docusaurus, GitHub Pages

### The Core Problem It Solves

A developer pushes code. Nobody documents it. Months later, a new engineer joins the team and spends three days reading the codebase to understand what it does. RepoDocs eliminates those three days.

### The 20% Delta (What Claude.ai Cannot Do)

| What Claude.ai gives you | What RepoDocs adds |
|---|---|
| Generic repo summary | Docusaurus-structured, publish-ready documentation site |
| One-shot text output | Multi-page doc structure: Overview, Setup, API, Architecture, Contributing |
| No deployment | GitHub Pages output, ready to host immediately |
| Manual organisation | Auto-generated navigation, sidebar, and cross-linking |
| Stateless | Persistent output at a stable URL |

---

### Phase 1: Reposition the Buyer (Weeks 1–2)

This is RepoDocs' most important strategic shift and it costs nothing to execute.

**Current implicit buyer:** Technical writers who want to document repos.
**New primary buyer:** Software engineers and engineering leads who need their repos documented.

Why this matters: An engineer does not need a budget meeting to justify a tool that saves their team's onboarding time. A technical writer does. The product is identical. The homepage copy changes completely.

**New hero copy:**

```
Headline:    Your repo is undocumented. Fix that in 60 seconds.
Subheadline: Paste a GitHub URL. RepoDocs reads your codebase and generates
             a complete, structured documentation site — ready to publish on
             GitHub Pages.
CTA:         Document a repo now
```

**Remove from prominent placement:**
- Any language that positions this as a "technical writing tool"
- Any language about documentation workflows or style guides

**Add to homepage:**
- "Works on public repos. No installation. No configuration."
- An explicit answer to: "Why not just ask Claude to summarise my repo?"

---

### Phase 2: Standalone Product Identity (Weeks 2–4)

RepoDocs currently lives at a GitHub Pages subdirectory path. That is fine for hosting but signals "project" not "product." The steps to fix this:

#### 2.1 Custom Domain

Options (all available pattern, check current availability):
- `repodocs.dev`
- `repodocs.app`
- `getrepodocs.com`

Even pointing the existing GitHub Pages deployment to a custom domain takes under 30 minutes and costs under $15/year.

#### 2.2 LinkedIn Company Page

Same approach as DocCraft:
- Name: RepoDocs AI
- Tagline: Instant documentation for GitHub repos.
- Website: your domain
- Post 1-2x per week from the company page

#### 2.3 README as a Product Showcase

Your GitHub repo for RepoDocs should have a README that reads like a product page, not a setup guide. Structure:

```
# RepoDocs AI

[Product screenshot / GIF]

Instant, structured documentation for any GitHub repository.
Paste a URL. Get a complete doc site. Deploy to GitHub Pages in one click.

## What it generates
- Project overview and architecture
- Setup and installation guide
- API reference
- Contributing guide

## Why not just use ChatGPT?
[Your 20% delta, in 3 bullet points]

## Try it
[URL]

## Built with
Docusaurus · GitHub Pages · [LLM you're using]

## Roadmap
[3-5 items — signals active development]
```

---

### Phase 3: Distribution (Weeks 3–6)

RepoDocs has a structural distribution advantage that DocCraft doesn't: every repo it documents becomes a demonstration of the product. Lean into this.

#### 3.1 The Demo Repo Strategy

Create 5 public repos with RepoDocs-generated documentation. Pick well-known or interesting open source projects. Generate their documentation with RepoDocs and publish it. Then:
- Link to those repos from your RepoDocs homepage as "Examples"
- Post each one on LinkedIn: "I documented [repo] in 60 seconds. Here's what RepoDocs generated."
- Tag the original repo authors where appropriate

This is your best content and your best proof simultaneously.

#### 3.2 GitHub-Native Distribution

RepoDocs belongs in GitHub discussions and issues. Specifically:
- When developers post "our repo has no documentation, where do we start" in GitHub Discussions or Dev.to — that is your entry point
- Add RepoDocs to lists like "awesome-developer-tools" repositories on GitHub
- Submit to Product Hunt once you have a custom domain and demo GIF

#### 3.3 Hacker News "Show HN"

RepoDocs is a strong "Show HN" candidate. The format is:
"Show HN: RepoDocs AI – paste a GitHub URL, get a full documentation site"

Rules for success on Show HN:
- Post on a Tuesday or Wednesday morning (US Eastern time)
- Lead with what it does, not what you used to build it
- Respond to every comment personally within the first two hours
- Have the demo working perfectly before you post

This alone can drive hundreds of users in 24 hours if the timing and framing are right.

#### 3.4 Content: Engineer-First Framing

LinkedIn content for RepoDocs follows a different template than DocCraft:

| Week | Topic | Angle |
|---|---|---|
| 1 | The undocumented repo problem | "Every engineering team has a repo nobody wants to touch" |
| 2 | Onboarding cost | "Three days to understand a codebase. RepoDocs fixes that." |
| 3 | Demo of a real repo | "I documented [well-known repo] in 60 seconds" |
| 4 | Architecture docs | "The diagram your README never had" |
| 5 | Contributing guides | "Why nobody contributes to your open source project" |
| 6 | The solo engineer problem | "No tech writer on staff. Here's the alternative." |

---

### Phase 4: Monetisation (Weeks 6–10)

RepoDocs' natural monetisation path is different from DocCraft's because the buyer is different.

#### 4.1 Tier Model

| Tier | Price | What's included |
|---|---|---|
| Free | $0 | 3 repo documentations/month, public repos only, RepoDocs branding in footer |
| Developer | $7/month | Unlimited public repos, no branding, DOCX/MD export |
| Team | $19/month | Private repo support, team workspace, custom domain for generated sites |
| Enterprise | Custom | On-premise, SSO, custom templates, SLA |

#### 4.2 The Private Repo Unlock

Private repo support is your most natural paid feature. It requires authentication (GitHub OAuth), which you build once. It gates on a real differentiator: "Your internal projects, documented." That is an enterprise pitch, not a consumer pitch.

#### 4.3 Priority Order

Do not build the Team or Enterprise tiers until you have 20 Developer-tier paying customers. The signal that someone will pay $7/month is more valuable than building features you assume people want.

---

### Phase 5: The Combined Portfolio Signal

This is the layer that matters for your job search as much as for the products themselves.

DocCraft AI and RepoDocs AI together tell a story that neither tells alone:

- **DocCraft** proves you can build AI-powered generation tools for documentation practitioners
- **RepoDocs** proves you understand the developer tooling market and can build for engineers
- **Together** they prove systems thinking: you didn't build one tool, you built a documentation ecosystem

The LinkedIn framing for your personal profile should reflect this:

```
Founder, DocCraft AI — AI-powered documentation generator for technical writers
Founder, RepoDocs AI — Instant documentation sites for GitHub repositories
```

Both with company pages linked. Both with active posting cadences. This is what "builder, not just a writer" looks like in practice, on a profile.

---

## Master Timeline

| Week | DocCraft | RepoDocs |
|---|---|---|
| 1 | Record demo GIF | Rewrite homepage hero copy |
| 2 | Build marketing homepage layer | Create LinkedIn company page |
| 3 | Launch marketing homepage | Register custom domain |
| 4 | Create LinkedIn company page | Build 3 demo repo examples |
| 5 | Publish first content series post | Post demo repos on LinkedIn |
| 6 | Implement free/paid tier gating | Submit to Show HN |
| 7 | Launch Stripe/Lemon Squeezy billing | Start Developer tier gating |
| 8 | First pricing page live | Cross-post to Dev.to / Hashnode |
| 9 | Release notes cadence begins | Add private repo OAuth (if resources allow) |
| 10 | Review analytics, adjust content | Review traction, adjust pricing |

---

## The Non-Negotiable Three

If nothing else, do these three things in the first two weeks:

1. **Build and publish the demo GIF** for both products. This is the single highest-leverage hour you can spend.

2. **Write the "why not just use Claude.ai" section** on both homepages. Visitors are asking this silently. Answer it explicitly.

3. **Create LinkedIn company pages** for both products and link them to your personal profile. This costs nothing and immediately changes how your profile reads to a hiring manager or potential user.

Everything else in this plan is important. These three are urgent.

---

*Plan prepared: April 2026*
*Based on: Hyperlint post-mortem analysis, VectorLint product study, DocCraft AI live product audit, RepoDocs AI product knowledge*
