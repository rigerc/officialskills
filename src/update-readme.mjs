#!/usr/bin/env node
/**
 * Updates README.md with registry stats from the generated JSON files.
 *
 * Looks for a comment-delimited block in README.md:
 *   <!-- REGISTRY_STATS -->...<!-- /REGISTRY_STATS -->
 * and replaces it with updated badges.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const readmePath = join(root, "README.md");
const officialPath = join(root, "registry", "official.json");
const communityPath = join(root, "registry", "community.json");

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// ---- Gather stats (skip if registry files are missing) ----
const official = loadJson(officialPath);
const community = loadJson(communityPath);

let statsBlock = null;
if (official && community) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const fetchedAt = official?.meta?.fetched_at ?? now;
  const totalSkills = (official?.meta?.total_skills ?? 0) + (community?.meta?.total_skills ?? 0);
  const totalPublishers = (official?.meta?.total_publishers ?? 0) + (community?.meta?.total_publishers ?? 0);
  const detectedChange = fetchedAt;

  const enc = (s) => encodeURIComponent(s);
  statsBlock = [
    "<!-- REGISTRY_STATS -->",
    `<p align="center">`,
    `  <img src="https://img.shields.io/static/v1?label=last+run&message=${enc(now)}&color=blue&style=flat" alt="Last run">`,
    `  <img src="https://img.shields.io/static/v1?label=last+change&message=${enc(detectedChange)}&color=informational&style=flat" alt="Last change">`,
    `  <img src="https://img.shields.io/static/v1?label=publishers&message=${totalPublishers}&color=orange&style=flat" alt="Publishers">`,
    `  <img src="https://img.shields.io/static/v1?label=skills&message=${totalSkills}&color=green&style=flat" alt="Skills">`,
    `</p>`,
    "<!-- /REGISTRY_STATS -->",
  ].join("\n");
}

// ============================================================
// JSON Schema generation
// ============================================================

/** JSON Schema for a single Skill object */
const skillSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Skill",
  type: "object",
  required: ["id", "name", "url", "description", "publisher", "section", "repo"],
  properties: {
    id:        { type: "string", description: "Unique skill identifier, e.g. \"anthropics/algorithmic-art\"" },
    name:      { type: "string", description: "Short skill name (last path segment of id)" },
    url:       { type: "string", format: "uri", description: "GitHub source URL (resolved from officialskills.sh)" },
    description: { type: "string", description: "One-line description of what the skill does" },
    publisher: { type: "string", description: "Publisher name, e.g. \"Anthropic\"" },
    section:   { type: "string", description: "Section within publisher, e.g. \"Official\"" },
    repo:      { type: "string", nullable: true, description: "GitHub repository as \"<owner>/<repo>\", null if unresolved" },
  },
};

/** JSON Schema for the full Output structure (official.json / community.json) */
const outputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Output",
  type: "object",
  required: ["meta", "publishers", "skills"],
  properties: {
    meta: {
      type: "object",
      required: ["fetched_at", "source", "total_skills", "total_publishers", "total_categories", "total_official", "total_community"],
      properties: {
        fetched_at:       { type: "string", format: "date-time", description: "When the source README was fetched" },
        source:           { type: "string", format: "uri", description: "Source README URL" },
        total_skills:     { type: "integer", description: "Total number of skills in this file" },
        total_publishers: { type: "integer", description: "Total number of publishers" },
        total_categories: { type: "integer", description: "Unique section categories across publishers" },
        total_official:   { type: "integer", description: "Official skills count (only relevant in full output)" },
        total_community:  { type: "integer", description: "Community skills count (only relevant in full output)" },
      },
    },
    publishers: {
      type: "array",
      description: "Skills grouped by publisher, then by section",
      items: {
        type: "object",
        required: ["name", "type", "skills_count", "skills"],
        properties: {
          name:         { type: "string", description: "Publisher name" },
          type:         { type: "string", enum: ["official", "community"] },
          skills_count: { type: "integer", description: "Total skills for this publisher" },
          skills: {
            type: "array",
            description: "Sections within this publisher",
            items: {
              type: "object",
              required: ["section", "skills_count", "skills"],
              properties: {
                section:       { type: "string", description: "Section name, e.g. \"Official\" or \"Core Skills\"" },
                skills_count:  { type: "integer" },
                skills:        { type: "array", items: skillSchema },
              },
            },
          },
        },
      },
    },
    skills: {
      type: "array",
      description: "Flat list of all skills in this file, sorted by publisher then id",
      items: skillSchema,
    },
  },
};

/** JSON Schema for manifest.json */
const manifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Manifest",
  type: "object",
  required: ["generated_at", "total_skills", "publishers"],
  properties: {
    generated_at: { type: "string", format: "date-time", description: "When this manifest was generated" },
    total_skills: { type: "integer", description: "Total skills across all publishers" },
    publishers: {
      type: "object",
      description: "Publisher-keyed map for O(1) lookup",
      additionalProperties: {
        type: "object",
        required: ["skills_count", "skills"],
        properties: {
          skills_count: { type: "integer" },
          skills: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "name", "url", "repo"],
              properties: {
                id:   { type: "string", description: "Unique skill identifier" },
                name: { type: "string", description: "Short skill name" },
                url:  { type: "string", format: "uri", description: "GitHub source URL" },
                repo: { type: "string", nullable: true, description: "GitHub repository as \"<owner>/<repo>\"" },
              },
            },
          },
        },
      },
    },
  },
};

/** Format a JSON Schema as a markdown details/summary block */
function schemaToMarkdown(title, schema) {
  const json = JSON.stringify(schema, null, 2);
  return [
    `<details>`,//
    `<summary><strong>${title}</strong></summary>`,//
    ``,
    '```json',//
    json,//
    '```',//
    `</details>`,//
  ].join("\n");
}

const schemaBlock = [
  "<!-- JSON_SCHEMA -->",
  "",
  "### Registry schemas",//
  "",
  "These JSON Schemas describe the structure of the generated files. They are automatically regenerated when the registry is updated.",//
  "",
  schemaToMarkdown("official.json / community.json — Output", outputSchema),
  "",
  schemaToMarkdown("manifest.json — Manifest", manifestSchema),
  "",
  schemaToMarkdown("Skill (inner type)", skillSchema),
  "",
  "<!-- /JSON_SCHEMA -->",
].join("\n");

// ============================================================
// Update README
// ============================================================

function replaceBlock(readme, startMarker, endMarker, replacement) {
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  if (start !== -1 && end !== -1) {
    return readme.slice(0, start) + replacement + readme.slice(end + endMarker.length);
  }
  return null;
}

let readme = readFileSync(readmePath, "utf-8");

// Replace stats block (only if registry files were available)
if (statsBlock) {
  const updated = replaceBlock(readme, "<!-- REGISTRY_STATS -->", "<!-- /REGISTRY_STATS -->", statsBlock);
  if (updated) {
    readme = updated;
    console.log("README: registry stats updated.");
  } else {
    const insertAfter = readme.indexOf("\n## ");
    if (insertAfter === -1) {
      console.error("ERROR: Could not find insertion point in README");
      process.exit(1);
    }
    readme =
      readme.slice(0, insertAfter) + "\n\n" + statsBlock + "\n" + readme.slice(insertAfter);
    console.log("README: REGISTRY_STATS markers added.");
  }
} else {
  console.log("README: registry files not found, stats skipped.");
}

// Replace schema block (only if content actually changed)
const schemaStart = "<!-- JSON_SCHEMA -->";
const schemaEnd = "<!-- /JSON_SCHEMA -->";
const schemaStartIdx = readme.indexOf(schemaStart);
const schemaEndIdx = readme.indexOf(schemaEnd);

if (schemaStartIdx !== -1 && schemaEndIdx !== -1) {
  const currentBlock = readme.slice(schemaStartIdx, schemaEndIdx + schemaEnd.length);
  if (currentBlock !== schemaBlock) {
    readme = readme.slice(0, schemaStartIdx) + schemaBlock + readme.slice(schemaEndIdx + schemaEnd.length);
    console.log("README: JSON schemas updated (content changed).");
  } else {
    console.log("README: JSON schemas unchanged, skipped.");
  }
} else {
  // Insert before "## Output structure"
  const insertAt = readme.indexOf("## Output structure");
  if (insertAt !== -1) {
    readme = readme.slice(0, insertAt) + schemaBlock + "\n\n" + readme.slice(insertAt);
    console.log("README: JSON_SCHEMA markers added.");
  }
}

writeFileSync(readmePath, readme, "utf-8");
console.log("README saved.");
