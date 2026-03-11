import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureDirectory,
  loadMarkdownDocuments,
  repoRoot,
  slugify
} from "./lib/docs-automation-utils.mjs";

const targetDirectories = ["docs", "examples", "templates", "generated"];

function addNode(nodeMap, id, type, label) {
  if (!nodeMap.has(id)) {
    nodeMap.set(id, { id, type, label });
  }
}

function addEdge(edges, from, to, relationship) {
  edges.push({ from, to, relationship });
}

async function main() {
  const documents = (await loadMarkdownDocuments(targetDirectories)).filter((document) => document.frontmatter);
  const nodes = new Map();
  const edges = [];

  for (const document of documents) {
    const documentId = `document:${slugify(document.relativePath)}`;
    const serviceId = `service:${slugify(document.frontmatter.service || "unknown")}`;
    const componentId = `component:${slugify(document.frontmatter.component || "unknown")}`;
    const ownerId = `owner:${slugify(document.frontmatter.owner || "unknown")}`;

    addNode(nodes, documentId, "document", document.frontmatter.title || document.relativePath);
    addNode(nodes, serviceId, "service", document.frontmatter.service || "unknown");
    addNode(nodes, componentId, "component", document.frontmatter.component || "unknown");
    addNode(nodes, ownerId, "owner", document.frontmatter.owner || "unknown");

    addEdge(edges, documentId, serviceId, "describes");
    addEdge(edges, documentId, componentId, "covers");
    addEdge(edges, ownerId, documentId, "maintains");

    const dependencies = Array.isArray(document.frontmatter.dependencies) ? document.frontmatter.dependencies : [];
    for (const dependency of dependencies) {
      const dependencyId = `dependency:${slugify(dependency)}`;
      addNode(nodes, dependencyId, "dependency", dependency);
      addEdge(edges, documentId, dependencyId, "depends_on");
    }

    const endpointMatch = document.content.match(/- Method: `([A-Z]+)`\s+[\s\S]*?- URL: `([^`]+)`/);
    if (endpointMatch) {
      const endpointId = `endpoint:${slugify(`${endpointMatch[1]}-${endpointMatch[2]}`)}`;
      addNode(nodes, endpointId, "endpoint", `${endpointMatch[1]} ${endpointMatch[2]}`);
      addEdge(edges, documentId, endpointId, "documents");
      addEdge(edges, componentId, endpointId, "exposes");
    }
  }

  const graph = {
    generated_at: new Date().toISOString(),
    node_count: nodes.size,
    edge_count: edges.length,
    nodes: [...nodes.values()],
    edges
  };

  const mermaid = [
    "graph TD",
    ...graph.nodes.map((node) => `${node.id.replace(/[^a-zA-Z0-9_]/g, "_")}["${node.label}"]`),
    ...graph.edges.map((edge) => `${edge.from.replace(/[^a-zA-Z0-9_]/g, "_")} -->|${edge.relationship}| ${edge.to.replace(/[^a-zA-Z0-9_]/g, "_")}`)
  ].join("\n");

  const outputDirectory = path.join(repoRoot, "knowledge-graph", "output");
  await ensureDirectory(outputDirectory);
  await fs.writeFile(path.join(outputDirectory, "graph.json"), JSON.stringify(graph, null, 2), "utf8");
  await fs.writeFile(path.join(outputDirectory, "graph.mmd"), `${mermaid}\n`, "utf8");

  console.log(`Built knowledge graph with ${graph.node_count} nodes and ${graph.edge_count} edges.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});