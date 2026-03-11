import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureDirectory,
  loadMarkdownDocuments,
  repoRoot
} from "./lib/docs-automation-utils.mjs";

const targetDirectories = ["docs", "examples", "templates", "generated"];
const staleThresholdDays = 90;

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

async function main() {
  const documents = (await loadMarkdownDocuments(targetDirectories)).filter((document) => document.frontmatter);
  const now = new Date();
  const statusCounts = {};
  const serviceCounts = {};
  let staleDocuments = 0;
  let missingOwners = 0;
  let deprecatedDocuments = 0;

  for (const document of documents) {
    const status = document.frontmatter.status || "unknown";
    const service = document.frontmatter.service || "unknown";
    increment(statusCounts, status);
    increment(serviceCounts, service);

    if (!document.frontmatter.owner) {
      missingOwners += 1;
    }

    if (status === "deprecated") {
      deprecatedDocuments += 1;
    }

    if (document.frontmatter.last_reviewed) {
      const reviewedDate = new Date(document.frontmatter.last_reviewed);
      const ageDays = Math.floor((now - reviewedDate) / (1000 * 60 * 60 * 24));
      if (!Number.isNaN(ageDays) && ageDays > staleThresholdDays) {
        staleDocuments += 1;
      }
    }
  }

  const report = {
    generated_at: now.toISOString(),
    total_documents: documents.length,
    stale_threshold_days: staleThresholdDays,
    stale_documents: staleDocuments,
    missing_owner_documents: missingOwners,
    deprecated_documents: deprecatedDocuments,
    status_breakdown: sortObject(statusCounts),
    service_breakdown: sortObject(serviceCounts)
  };

  const summary = [
    "# Documentation Analytics Report",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Total documents with frontmatter: ${report.total_documents}`,
    `- Stale documents: ${report.stale_documents}`,
    `- Missing owner documents: ${report.missing_owner_documents}`,
    `- Deprecated documents: ${report.deprecated_documents}`,
    "",
    "## Status Breakdown",
    "",
    ...Object.entries(report.status_breakdown).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Service Breakdown",
    "",
    ...Object.entries(report.service_breakdown).map(([service, count]) => `- ${service}: ${count}`)
  ].join("\n");

  const outputDirectory = path.join(repoRoot, "analytics", "output");
  await ensureDirectory(outputDirectory);
  await fs.writeFile(path.join(outputDirectory, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(path.join(outputDirectory, "report.md"), `${summary}\n`, "utf8");

  console.log(`Generated analytics report for ${documents.length} documents.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});