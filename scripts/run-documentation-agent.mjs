import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ensureDirectory,
  normalizeText,
  repoRoot,
  slugify
} from "./lib/docs-automation-utils.mjs";

// ---------------------------------------------------------------------------
// AI review integration (optional — requires ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------
// When ANTHROPIC_API_KEY is set the agent calls Claude to produce a structured
// review of each generated document against the source spec.  When the key is
// absent the agent still runs the full generation + validation pipeline and
// records that AI review was skipped, so the tool is fully usable without an
// API key.
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const AI_MODEL = process.env.REPODOCS_AI_MODEL || "claude-opus-4-6";
const AI_REVIEW_ENABLED = Boolean(ANTHROPIC_API_KEY);

function formatAiReviewError(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown AI review error");
  if (/invalid x-api-key|authentication_error|401/i.test(message)) {
    return [
      "Anthropic authentication failed.",
      "Confirm ANTHROPIC_API_KEY is current and pasted without extra quotes or whitespace."
    ].join(" ");
  }
  return message;
}

async function loadAnthropicClient() {
  if (!AI_REVIEW_ENABLED) {
    return null;
  }
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  } catch {
    return null;
  }
}

async function collectMarkdownFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function buildGeneratedReviewPayload(generatedDirectoryPath) {
  try {
    const markdownFiles = await collectMarkdownFiles(generatedDirectoryPath);
    if (markdownFiles.length === 0) {
      return { content: "(no generated Markdown files found)", files: [] };
    }

    const sections = [];
    for (const filePath of markdownFiles) {
      const relativePath = path.relative(generatedDirectoryPath, filePath).replace(/\\/g, "/");
      const content = await fs.readFile(filePath, "utf8");
      sections.push([`### File: ${relativePath}`, "", content.trim()].join("\n"));
    }

    return {
      content: sections.join("\n\n"),
      files: markdownFiles.map((filePath) => path.relative(generatedDirectoryPath, filePath).replace(/\\/g, "/"))
    };
  } catch {
    return { content: "(generated documentation not available)", files: [] };
  }
}

function extractTextFromMessageContent(contentBlocks) {
  if (!Array.isArray(contentBlocks)) {
    return "";
  }

  return contentBlocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractJsonCandidate(rawResponse) {
  const fencedMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (jsonMatch?.[0]) {
    return jsonMatch[0].trim();
  }

  return rawResponse.trim();
}

function normalizeJsonCandidate(candidate) {
  return candidate
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseAiReviewResponse(rawResponse) {
  const candidate = extractJsonCandidate(rawResponse);
  const attempts = [candidate, normalizeJsonCandidate(candidate)].filter(Boolean);
  let lastError = null;

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  const parseError = new Error(lastError?.message || "Unable to parse AI review response as JSON");
  parseError.rawResponse = rawResponse;
  parseError.jsonCandidate = candidate;
  throw parseError;
}

async function repairAiReviewJson(anthropic, rawResponse) {
  const repairMessage = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: [
      "You repair malformed JSON.",
      "Return only a valid JSON object with the same semantic content as the input.",
      "Do not add commentary, markdown fences, or explanations."
    ].join("\n"),
    messages: [{
      role: "user",
      content: [
        "Repair this malformed JSON so it becomes valid JSON with the same meaning:",
        "",
        rawResponse
      ].join("\n")
    }]
  });

  return extractTextFromMessageContent(repairMessage.content);
}

function buildAiReviewFallback(rawResponse, parseError) {
  return {
    critical_issues: ["AI review response could not be parsed as valid JSON. Manual review required."],
    moderate_issues: [],
    sme_inputs_required: [],
    suggested_edits: [],
    overall_assessment: "NEEDS_REVIEW",
    confidence: 0,
    parser_warning: parseError?.message || "Unable to parse AI review response as JSON",
    raw_response: rawResponse
  };
}

async function runAiReview(anthropic, { specContent, generatedContent, promptContent }) {
  if (!anthropic) {
    return {
      enabled: false,
      skipped_reason: "ANTHROPIC_API_KEY not set — set the environment variable to enable AI review",
      result: null
    };
  }

  try {
    const systemPrompt = [
      "You are a senior documentation reviewer checking AI-generated API documentation for accuracy,",
      "completeness, and hallucination risk.",
      "",
      "Cross-reference the generated document against the source OpenAPI specification and return a structured review.",
      "",
      "Review criteria (from prompts/review/documentation-review.md):",
      "1. Spec cross-reference — every value in the document must match the spec exactly",
      "2. Completeness — all ten required sections must be present:",
      "   Summary, Endpoint, Authentication Requirements, Path Parameters, Query Parameters,",
      "   Request Body, Request Example, Response Example, Error Codes, Performance Notes",
      "3. Hallucination indicators — flag invented fields, endpoints, parameters, or status codes not in the spec",
      "4. SME input tracking — list every 'Needs SME input' label",
      "5. Language and usability — curl examples syntactically valid, tables complete, descriptions specific",
      "",
      "Return concise results. Keep each array to at most 5 items and each item must be a plain string, not an object.",
      "If more issues exist, summarize the highest-severity ones first.",
      "",
      "Return ONLY a valid JSON object:",
      "{",
      '  "critical_issues": ["..."],',
      '  "moderate_issues": ["..."],',
      '  "sme_inputs_required": ["..."],',
      '  "suggested_edits": ["..."],',
      '  "overall_assessment": "PASS | NEEDS_REVIEW | FAIL",',
      '  "confidence": 0.0',
      "}"
    ].join("\n");

    const userMessage = [
      "## Source OpenAPI Specification",
      "",
      "```yaml",
      specContent,
      "```",
      "",
      "## Review Prompt",
      "",
      promptContent,
      "",
      "## Generated Documentation to Review",
      "",
      generatedContent,
      "",
      "Review the generated documentation against the spec and return the structured JSON review."
    ].join("\n");

    const message = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    });

    const rawResponse = extractTextFromMessageContent(message.content);
    let parsed;

    try {
      parsed = parseAiReviewResponse(rawResponse);
    } catch (parseError) {
      try {
        const repairedResponse = await repairAiReviewJson(anthropic, rawResponse);
        parsed = parseAiReviewResponse(repairedResponse);
      } catch (repairError) {
        parsed = buildAiReviewFallback(rawResponse, repairError);
      }
    }

    return { enabled: true, model: AI_MODEL, result: parsed };
  } catch (error) {
    return { enabled: true, model: AI_MODEL, error: formatAiReviewError(error), result: null };
  }
}

// ---------------------------------------------------------------------------
// Workflow classification
// ---------------------------------------------------------------------------

function classifyWorkflow(inputPath, content) {
  const extension = path.extname(inputPath).toLowerCase();
  if ([".yaml", ".yml", ".json"].includes(extension) && /["']?openapi["']?\s*:/i.test(content)) {
    return {
      mode: "api-generation",
      template: "templates/api/endpoint-template.md",
      prompt: "prompts/api-generation/openapi-to-api-docs.md"
    };
  }

  if (/feature|workflow|user journey/i.test(content)) {
    return {
      mode: "feature-docs",
      template: "templates/features/feature-overview.md",
      prompt: "prompts/product-docs/product-overview-generation.md"
    };
  }

  return {
    mode: "product-docs",
    template: "templates/product/product-overview.md",
    prompt: "prompts/product-docs/product-overview-generation.md"
  };
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(stderr || stdout || `${scriptPath} exited with code ${code}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const inputArg = process.argv[2] || "examples/openapi/payments-openapi.yaml";
  const inputPath = path.resolve(repoRoot, inputArg);
  const raw = await fs.readFile(inputPath, "utf8");
  const workflow = classifyWorkflow(inputPath, raw);
  const outputRoot = path.join(repoRoot, "agents", "output");
  const inputSlug = slugify(path.basename(inputPath, path.extname(inputPath)));
  const generatedDirectory = `generated/${inputSlug}`;
  const execution = { generated_docs: null, openapi_validation: null, quality_validation: null };

  if (workflow.mode === "api-generation") {
    execution.generated_docs = await runNodeScript(path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"), [inputArg, generatedDirectory]);
    execution.openapi_validation = await runNodeScript(path.join(repoRoot, "scripts", "validate-openapi-examples.mjs"), []);
    execution.quality_validation = await runNodeScript(path.join(repoRoot, "scripts", "validate-doc-quality.mjs"), []);
  }

  // AI review — optional, requires ANTHROPIC_API_KEY
  const anthropic = await loadAnthropicClient();
  let aiReview = { enabled: false, skipped_reason: "not an api-generation workflow", result: null };

  if (workflow.mode === "api-generation") {
    const reviewPromptPath = path.join(repoRoot, "prompts/review/documentation-review.md");
    const generatedDirectoryPath = path.join(repoRoot, generatedDirectory);
    let generatedContent = "";
    let generatedFiles = [];
    let promptContent = "";
    ({ content: generatedContent, files: generatedFiles } = await buildGeneratedReviewPayload(generatedDirectoryPath));
    try { promptContent = await fs.readFile(reviewPromptPath, "utf8"); } catch { promptContent = ""; }
    aiReview = await runAiReview(anthropic, { specContent: raw, generatedContent, promptContent });
    if (aiReview.enabled && !aiReview.error) {
      aiReview.reviewed_files = generatedFiles;
    }
  }

  const result = {
    run_at: new Date().toISOString(),
    input: path.relative(repoRoot, inputPath).replace(/\\/g, "/"),
    workflow,
    ai_review: aiReview,
    outputs: {
      generated_directory: workflow.mode === "api-generation" ? generatedDirectory : null,
      validation_commands: workflow.mode === "api-generation"
        ? ["node scripts/validate-openapi-examples.mjs", "node scripts/validate-doc-quality.mjs"]
        : null
    },
    execution
  };

  // Build AI review section for Markdown summary
  let aiReviewSection = "";
  if (!aiReview.enabled) {
    aiReviewSection = [
      "## AI Review",
      "",
      `> ${aiReview.skipped_reason || "AI review not available."}`,
      "",
      "To enable AI review: `export ANTHROPIC_API_KEY=<your-key>` before running the agent."
    ].join("\n");
  } else if (aiReview.error) {
    aiReviewSection = ["## AI Review", "", `> AI review failed: ${aiReview.error}`].join("\n");
  } else if (aiReview.result) {
    const r = aiReview.result;
    const assessment = r.overall_assessment || "UNKNOWN";
    const confidence = typeof r.confidence === "number" ? `${Math.round(r.confidence * 100)}%` : "—";
    const fmt = (arr) => Array.isArray(arr) && arr.length > 0 ? arr.map((i) => `- ${i}`).join("\n") : "- None";
    aiReviewSection = [
      "## AI Review",
      "",
      `Model: ${aiReview.model} | Assessment: **${assessment}** | Confidence: ${confidence}`,
      aiReview.reviewed_files?.length ? `Reviewed files: ${aiReview.reviewed_files.join(", ")}` : null,
      r.parser_warning ? `Parser warning: ${r.parser_warning}` : null,
      "",
      "### Critical Issues",
      fmt(r.critical_issues),
      "",
      "### Moderate Issues",
      fmt(r.moderate_issues),
      "",
      "### SME Inputs Required",
      fmt(r.sme_inputs_required)
    ].filter(Boolean).join("\n");
  }

  const summary = [
    "# Documentation Agent Run",
    "",
    `- Input: ${result.input}`,
    `- Workflow: ${workflow.mode}`,
    `- Template: ${workflow.template}`,
    `- Prompt: ${workflow.prompt}`,
    workflow.mode === "api-generation" ? `- Generated docs: ${generatedDirectory}` : "- Generated docs: not applicable",
    workflow.mode === "api-generation" ? `- OpenAPI validation: ${normalizeText(execution.openapi_validation?.stdout, "completed")}` : "- OpenAPI validation: not applicable",
    workflow.mode === "api-generation" ? `- Quality validation: ${normalizeText(execution.quality_validation?.stdout, "completed")}` : "- Quality validation: not applicable",
    "",
    aiReviewSection,
    "",
    "## Next Review Tasks",
    "",
    "1. Confirm the generated output with an SME.",
    "2. Fill any `Needs SME input` placeholders before publication.",
    "3. Pass the output through `prompts/review/documentation-review.md` with the source spec.",
    "4. Run `npm run validate` before merge."
  ].join("\n");

  await ensureDirectory(outputRoot);
  await fs.writeFile(path.join(outputRoot, "last-run.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(outputRoot, "last-run.md"), `${summary}\n`, "utf8");

  const aiStatus = aiReview.enabled
    ? (aiReview.result ? `AI review: ${aiReview.result.overall_assessment || "completed"}` : "AI review: error")
    : "AI review: skipped (set ANTHROPIC_API_KEY to enable)";

  console.log(`Documentation agent executed ${workflow.mode} for ${result.input}. ${aiStatus}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
