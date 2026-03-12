import fs from "node:fs/promises";
import path from "node:path";

function printUsage() {
  console.log("Usage: node aggregate-analytics.mjs <report1.json> <report2.json> ...");
  console.log("Example: node aggregate-analytics.mjs ../payments/analytics/output/report.json ../fraud/analytics/output/report.json");
}

function sumKey(reports, key) {
  return reports.reduce((total, report) => total + (Number(report[key]) || 0), 0);
}

function mergeOwnerBreakdown(reports) {
  const merged = {};
  for (const report of reports) {
    const breakdown = report.by_owner || {};
    for (const [owner, count] of Object.entries(breakdown)) {
      merged[owner] = (merged[owner] || 0) + count;
    }
  }
  return merged;
}

function mergeServiceBreakdown(reports) {
  const merged = {};
  for (const report of reports) {
    const service = report.service || report.source_directory || "unknown";
    merged[service] = (merged[service] || 0) + (Number(report.total_documents) || 0);
  }
  return merged;
}

function mergeStatusBreakdown(reports) {
  const merged = {};
  for (const report of reports) {
    const breakdown = report.by_status || {};
    for (const [status, count] of Object.entries(breakdown)) {
      merged[status] = (merged[status] || 0) + count;
    }
  }
  return merged;
}

async function loadReport(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, "utf8");
  const report = JSON.parse(raw);
  report._source_path = resolved;
  return report;
}

async function main() {
  const reportPaths = process.argv.slice(2);

  if (reportPaths.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const reports = [];
  const errors = [];

  for (const filePath of reportPaths) {
    try {
      reports.push(await loadReport(filePath));
    } catch (error) {
      errors.push(`  - ${filePath}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    console.error("Failed to load the following reports:");
    for (const error of errors) {
      console.error(error);
    }
  }

  if (reports.length === 0) {
    console.error("No reports loaded. Nothing to aggregate.");
    process.exitCode = 1;
    return;
  }

  const totalDocuments = sumKey(reports, "total_documents");
  const staleDocuments = sumKey(reports, "stale_documents");
  const missingOwner = sumKey(reports, "missing_owner_documents");
  const deprecatedDocuments = sumKey(reports, "deprecated_documents");
  const missingReviewedBy = sumKey(reports, "missing_reviewed_by_documents");

  const aggregated = {
    aggregated_at: new Date().toISOString(),
    source_count: reports.length,
    source_paths: reports.map((r) => r._source_path),
    total_documents: totalDocuments,
    stale_documents: staleDocuments,
    missing_owner_documents: missingOwner,
    deprecated_documents: deprecatedDocuments,
    missing_reviewed_by_documents: missingReviewedBy,
    coverage_pct: totalDocuments > 0 ? Math.round(((totalDocuments - staleDocuments) / totalDocuments) * 100) : 100,
    by_owner: mergeOwnerBreakdown(reports),
    by_service: mergeServiceBreakdown(reports),
    by_status: mergeStatusBreakdown(reports)
  };

  console.log("\nCross-Repo Analytics Summary");
  console.log("-----------------------------");
  console.log(`Sources aggregated   : ${reports.length}`);
  console.log(`Total documents      : ${totalDocuments}`);
  console.log(`Stale documents      : ${staleDocuments}`);
  console.log(`Missing owner        : ${missingOwner}`);
  console.log(`Deprecated           : ${deprecatedDocuments}`);
  console.log(`Missing reviewed_by  : ${missingReviewedBy}`);
  console.log(`Health coverage      : ${aggregated.coverage_pct}%`);

  if (Object.keys(aggregated.by_owner).length > 0) {
    console.log("\nDocuments by owner:");
    for (const [owner, count] of Object.entries(aggregated.by_owner).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${owner}: ${count}`);
    }
  }

  if (Object.keys(aggregated.by_service).length > 0) {
    console.log("\nDocuments by service:");
    for (const [service, count] of Object.entries(aggregated.by_service).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${service}: ${count}`);
    }
  }

  if (Object.keys(aggregated.by_status).length > 0) {
    console.log("\nDocuments by status:");
    for (const [status, count] of Object.entries(aggregated.by_status).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status}: ${count}`);
    }
  }

  console.log("\nFull aggregated report (JSON):");
  console.log(JSON.stringify(aggregated, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
