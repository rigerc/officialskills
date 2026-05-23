#!/usr/bin/env node
/**
 * officialskills — Parse awesome-agent-skills README into structured JSON
 *
 * TypeScript rewrite of the original bash/gawk/jq script
 * (example/awesome-skills.sh).
 *
 * Why TypeScript over Bash?
 *   - Native JSON (no jq dependency)
 *   - Built-in fetch (no curl dependency)
 *   - Type safety across the entire data pipeline
 *   - Proper string/array methods instead of gawk regex gymnastics
 *   - Testable, maintainable, debuggable
 *   - Single dependency runtime (Node.js) vs 3+ CLI tools
 *
 * Usage:
 *   npx tsx officialskills.ts               Output full JSON to stdout
 *   npx tsx officialskills.ts --save <dir>   Write official.json, community.json,
 *                                            and manifest.json into <dir>
 *
 * Also prints a summary table to stderr in all modes.
 * Requires: Node.js 18+ (for global fetch)
 */

// ============================================================
// Types
// ============================================================

interface Skill {
  publisher: string;
  section: string;
  id: string;
  name: string;
  url: string;
  description: string;
  repo: string | null;
}

interface SectionGroup {
  section: string;
  skills_count: number;
  skills: Skill[];
}

interface PublisherGroup {
  name: string;
  type: "official" | "community";
  skills_count: number;
  skills: SectionGroup[];
}

interface Output {
  meta: {
    fetched_at: string;
    source: string;
    total_skills: number;
    total_publishers: number;
    total_categories: number;
    total_official: number;
    total_community: number;
  };
  publishers: PublisherGroup[];
  skills: Skill[];
}

// ============================================================
// Imports & Constants
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const READONLY_URL =
  "https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md";

function parseArgs(): { saveDir: string | null; readmePath: string | null } {
  const saveIdx = process.argv.indexOf("--save");
  const readmeIdx = process.argv.indexOf("--readme");
  return {
    saveDir: saveIdx !== -1 && saveIdx + 1 < process.argv.length
      ? process.argv[saveIdx + 1]
      : null,
    readmePath: readmeIdx !== -1 && readmeIdx + 1 < process.argv.length
      ? process.argv[readmeIdx + 1]
      : null,
  };
}

const { saveDir, readmePath } = parseArgs();

// ============================================================
// Cache helpers
// ============================================================

/** Resolved entry with staleness tracking */
interface ResolvedEntry {
  githubUrl: string;
  resolvedAt: number; // Unix ms timestamp
}

interface Cache {
  readmeEtag: string | null;
  resolved: Record<string, ResolvedEntry>;
  previousSnapshot?: Skill[];
}

/** Re-crawl a URL if it hasn't been checked within this window (24 h) */
const CACHE_TTL_MS = 86_400_000;

/** Resolve cache file path: prefer --save dir, else cwd */
function cachePath(): string {
  return saveDir
    ? join(saveDir, ".skills-cache.json")
    : join(process.cwd(), ".skills-cache.json");
}

/** Migrate old-style cache (flat string map) to current format */
function migrateEntry(entry: unknown): ResolvedEntry {
  if (typeof entry === "string") {
    return { githubUrl: entry, resolvedAt: 0 }; // stale — will be re-crawled
  }
  const e = entry as Partial<ResolvedEntry>;
  return {
    githubUrl: e.githubUrl ?? "",
    resolvedAt: e.resolvedAt ?? 0,
  };
}

function loadCache(): Cache {
  try {
    const path = cachePath();
    if (!existsSync(path)) return { readmeEtag: null, resolved: {}, previousSnapshot: undefined };
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const resolved: Record<string, ResolvedEntry> = {};
    for (const [id, entry] of Object.entries(raw.resolved ?? {})) {
      resolved[id] = migrateEntry(entry);
    }
    return { readmeEtag: raw.readmeEtag ?? null, resolved, previousSnapshot: raw.previousSnapshot };
  } catch {
    return { readmeEtag: null, resolved: {}, previousSnapshot: undefined };
  }
}

function saveCache(cache: Cache): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Non-fatal: cache is optional
  }
}

// ============================================================

const MICROSOFT_SUBSECTIONS = new Set([
  "Core Skills",
  ".NET Skills",
  "Java Skills",
  "Python Skills",
  "Rust Skills",
  "TypeScript Skills",
]);

// ============================================================
// Helpers
// ============================================================

/**
 * Extract a clean publisher name from a "Skills by <Name>" heading.
 *
 * Handles:
 *   "Skills by VoltAgent"                                   → "VoltAgent"
 *   "Skills by Addy Osmani (Web Quality)"                    → "Addy Osmani"
 *   "Skills by Google Chrome team - Addy Osmani"             → "Addy Osmani"
 *   "Skills by Anthropic for their dev team."                → "Anthropic"
 *   "Skills by Microsoft Development Team"                   → "Microsoft"
 */
export function extractPublisher(heading: string): string {
  let p = heading.replace(/^Skills by /, "");

  // Remove " for ..." clauses (e.g. "for Terraform", "for their dev team.")
  p = p.replace(/ for .*$/, "");

  // Remove trailing punctuation
  p = p.replace(/[.]+$/, "");

  // Remove team/development/engineering suffixes (case-insensitive)
  p = p.replace(/\s+(Development Team|Engineering Team|Team)$/i, "");

  // If there is a " - " separator, take the LAST segment
  // (handles "Google Chrome team - Addy Osmani (Web Quality)")
  const segments = p.split(" - ").map((s) => s.trim());
  if (segments.length > 1) {
    p = segments[segments.length - 1];
  }

  // Strip parenthetical qualifiers at the end
  p = p.replace(/\s*\([^)]*\)$/, "");

  return p.trim();
}

/** Skill entry regex: matches `- **[path](url)** - description` */
const SKILL_LINE_RE = /^- \*\*\[([^\]]+)\]\(([^)]+)\)\*\* - (.+)$/;

/**
 * Parse a single skill entry line into its components.
 * Returns null if the line is not a valid skill entry.
 */
export function parseSkillLine(
  line: string,
): { id: string; name: string; url: string; description: string; repo: string | null } | null {
  const match = line.match(SKILL_LINE_RE);
  if (!match) return null;

  const id = match[1];
  const url = match[2];
  const description = match[3].trim();

  // Extract the filename as the name (last path segment)
  const parts = id.split("/");
  const name = parts[parts.length - 1];

  return { id, name, url, description, repo: repoFromUrl(url) };
}

/**
 * Extract the heading text from an `<h3>` HTML tag.
 * Returns null if no `<h3>` is found.
 */
function extractH3(text: string): string | null {
  const match = text.match(/<h3[^>]*>\s*([^<]+)\s*<\/h3>/);
  if (!match) return null;
  let heading = match[1].replace(/<[^>]*>/g, "").trim();
  return heading || null;
}

// ============================================================
// State-machine Markdown parser
// ============================================================

/**
 * Parse the raw markdown text from the awesome-agent-skills README
 * and return a flat list of extracted Skill objects.
 *
 * The state machine handles:
 *   - Plain `### Skills by <Name>` section headers
 *   - HTML-wrapped `<details><summary><h3>Skills by <Name></h3></summary>` blocks
 *   - Special handling for Microsoft (sub-sections like "Core Skills", ".NET Skills")
 *   - Community Skills block with sub-categories
 *   - Skill entries in `- **[path](url)** - description` format
 */
export function parseSkills(readme: string): Skill[] {
  const skills: Skill[] = [];

  let publisher = "Unknown";
  let section = "General";
  let inCommunity = false;
  let inMicrosoft = false;

  // Normalize line endings
  const lines = readme.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // ---- Empty lines ----
    if (line.length === 0) continue;

    // ---- Close details block ----
    if (line.startsWith("</details>")) {
      if (inMicrosoft) inMicrosoft = false;
      continue;
    }

    // ---- Skill entry ----
    const skill = parseSkillLine(line);
    if (skill) {
      skills.push({ ...skill, publisher, section });
      continue;
    }

    // ---- Section headers (bare ###) ----
    if (line.startsWith("### ")) {
      let heading = line.replace(/^###\s+/, "");
      heading = heading.replace(/<[^>]*>/g, "").trim();

      // Microsoft sub-sections (only inside the Microsoft details block)
      if (inMicrosoft && MICROSOFT_SUBSECTIONS.has(heading)) {
        section = heading;
        continue;
      }

      // Community Skills top-level section
      if (heading === "Community Skills") {
        inCommunity = true;
        publisher = "Community";
        section = "Community";
        continue;
      }

      // Official "Skills by <Name>" sections
      if (heading.startsWith("Skills by ")) {
        inCommunity = false;
        inMicrosoft = false;
        publisher = extractPublisher(heading);
        section = "Official";
        continue;
      }

      continue;
    }

    // ---- Collapsible section headers (<details><summary><h3>) ----
    if (line.includes("<summary>") && line.includes("<h3")) {
      const heading = extractH3(line);
      if (!heading) continue;

      applyHeading(heading);
      continue;
    }

    // ---- <details> on its own line, summary on next line ----
    if (line.includes("<details>")) {
      // Look ahead up to 2 lines for the <summary><h3> pattern
      const lookahead = lines.slice(i + 1, Math.min(i + 3, lines.length));
      for (const nextLine of lookahead) {
        const trimmed = nextLine.trim();
        if (trimmed.includes("</details>")) break; // empty details — skip
        if (trimmed.includes("<summary>") && trimmed.includes("<h3")) {
          const heading = extractH3(trimmed);
          if (heading) applyHeading(heading);
          break;
        }
      }
      continue;
    }
  }

  return skills;

  // ---- Inner helper to apply a heading to the state machine ----
  function applyHeading(heading: string) {
    // Official Claude Skills → Anthropic
    if (heading === "Official Claude Skills") {
      publisher = "Anthropic";
      section = "Official";
      inCommunity = false;
      inMicrosoft = false;
      return;
    }

    // Skills by Microsoft (has sub-sections: Core, .NET, Java, Python, Rust, TS)
    if (heading.startsWith("Skills by Microsoft")) {
      inMicrosoft = true;
      publisher = "Microsoft";
      section = "Official";
      inCommunity = false;
      return;
    }

    // Other official "Skills by <Name>" sections
    if (heading.startsWith("Skills by ")) {
      publisher = extractPublisher(heading);
      section = "Official";
      inCommunity = false;
      inMicrosoft = false;
      return;
    }

    // Community sub-category (inside Community Skills block)
    if (inCommunity) {
      section = heading;
      return;
    }
  }
}

// ============================================================
// Output construction
// ============================================================

export function buildOutput(skills: Skill[]): Output {
  const sorted = [...skills].sort((a, b) =>
    a.publisher.localeCompare(b.publisher) || a.id.localeCompare(b.id),
  );

  // Group skills by publisher
  const publisherMap = new Map<string, Skill[]>();
  for (const s of sorted) {
    const arr = publisherMap.get(s.publisher);
    if (arr) arr.push(s);
    else publisherMap.set(s.publisher, [s]);
  }

  const publishers: PublisherGroup[] = [];
  for (const [name, pubSkills] of publisherMap) {
    // Group by section within each publisher
    const sectionMap = new Map<string, Skill[]>();
    for (const s of pubSkills) {
      const arr = sectionMap.get(s.section);
      if (arr) arr.push(s);
      else sectionMap.set(s.section, [s]);
    }

    const sections: SectionGroup[] = [];
    for (const [secName, secSkills] of sectionMap) {
      sections.push({
        section: secName,
        skills_count: secSkills.length,
        skills: secSkills,
      });
    }

    publishers.push({
      name,
      type: name === "Community" ? "community" : "official",
      skills_count: pubSkills.length,
      skills: sections,
    });
  }

  // Sort publishers by name
  publishers.sort((a, b) => a.name.localeCompare(b.name));

  const totalOfficial = publishers
    .filter((p) => p.type === "official")
    .reduce((sum, p) => sum + p.skills_count, 0);

  const totalCommunity = publishers
    .filter((p) => p.type === "community")
    .reduce((sum, p) => sum + p.skills_count, 0);

  const allCategories = new Set(
    publishers.flatMap((p) => p.skills.map((s) => s.section)),
  );

  return {
    meta: {
      fetched_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      source: READONLY_URL,
      total_skills: sorted.length,
      total_publishers: publishers.length,
      total_categories: allCategories.size,
      total_official: totalOfficial,
      total_community: totalCommunity,
    },
    publishers,
    skills: sorted,
  };
}

// ============================================================
// Pretty-print helpers
// ============================================================

function padRight(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - s.length));
}

function padLeft(s: string, n: number): string {
  return " ".repeat(Math.max(0, n - s.length)) + s;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function printSummary(output: Output): void {
  console.error("");
  console.error("=================================================================");
  console.error("  Awesome Agent Skills — Summary");
  console.error("=================================================================");
  console.error(`Fetched: ${output.meta.fetched_at}`);
  console.error(
    `Total skills: ${output.meta.total_skills} (${output.meta.total_official} official, ${output.meta.total_community} community)`,
  );
  console.error(`Total publishers: ${output.meta.total_publishers}`);
  console.error("");

  // Header
  console.error(
    `╔${"═".repeat(34)}╦${"═".repeat(8)}╗`,
  );
  console.error(
    `║ ${padRight("Publisher", 32)} ║ ${padRight("Skills", 6)} ║`,
  );
  console.error(
    `╠${"═".repeat(34)}╬${"═".repeat(8)}╣`,
  );

  const official = output.publishers.filter((p) => p.type === "official");
  const community = output.publishers.filter((p) => p.type === "community");

  for (const p of official) {
    console.error(
      `║ ${padRight(truncate(p.name, 32), 32)} ║ ${padLeft(String(p.skills_count), 6)} ║`,
    );
  }

  if (community.length > 0) {
    console.error(
      `╠${"═".repeat(34)}╬${"═".repeat(8)}╣`,
    );
    for (const p of community) {
      console.error(
        `║ ${padRight(truncate(p.name, 32), 32)} ║ ${padLeft(String(p.skills_count), 6)} ║`,
      );
    }
  }

  console.error(
    `╚${"═".repeat(34)}╩${"═".repeat(8)}╝`,
  );

  // All skills listing
  console.error("");
  console.error("");
  console.error("================================== ALL SKILLS ==================================");
  console.error("");
  for (const s of output.skills) {
    console.error(`${s.publisher} │ ${s.id} │ ${s.description}`);
  }
}

// ============================================================
// GitHub URL resolution
// ============================================================

/** Regex: matches a span whose text content is a raw GitHub URL */
const GITHUB_SPAN_RE = /<span[^>]*>https:\/\/github\.com\/[^<]+<\/span>/;

/**
 * Fetch an officialskills.sh page and extract the GitHub source URL
 * from the span identified by the XPath:
 *   /html/body/div[1]/div[2]/div/main/section[1]/div/div[2]/div/span
 */
async function resolveGithubUrl(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(GITHUB_SPAN_RE);
    if (!match) return null;
    const urlMatch = match[0].match(/https:\/\/github\.com\/[^<]+/);
    return urlMatch?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Extract owner/repo from a GitHub URL. Returns null for non-GitHub URLs. */
export function repoFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match?.[1] ?? null;
}

/** Stats collected during URL resolution */
interface CrawlStats {
  cacheHits: number;
  staleChecked: number;
  newCrawled: number;
  failures: number;
}

/** Crawl a batch of officialskills.sh URLs in parallel. Returns failure count. */
async function crawlBatch(
  entries: { id: string; url: string }[],
  cache: Cache,
  concurrency: number,
  label: string,
): Promise<number> {
  if (entries.length === 0) return 0;
  console.error(`  ${label} ...`);
  let completed = 0;
  let failures = 0;

  for (let i = 0; i < entries.length; i += concurrency) {
    const chunk = entries.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async ({ id, url }) => ({
        id,
        githubUrl: await resolveGithubUrl(url),
      })),
    );
    for (const r of results) {
      if (r.githubUrl) {
        cache.resolved[r.id] = {
          githubUrl: r.githubUrl,
          resolvedAt: Date.now(),
        };
      } else {
        failures++;
      }
    }
    completed += chunk.length;
    console.error(`    ${completed}/${entries.length} ${label.toLowerCase()}`);
  }
  return failures;
}

/**
 * Find cache entries whose timestamp is older than TTL and re-crawl them.
 * Can be called even on a 304 to catch URL changes on skill pages.
 * Returns the number of entries that were re-checked (and failures).
 */
async function refreshStaleCache(
  cache: Cache,
  concurrency = 10,
): Promise<{ staleChecked: number; failures: number }> {
  const now = Date.now();
  const stale: { id: string; url: string }[] = [];

  for (const [id, entry] of Object.entries(cache.resolved)) {
    if (now - entry.resolvedAt > CACHE_TTL_MS) {
      const [publisher] = id.split("/");
      stale.push({
        id,
        url: `https://officialskills.sh/${publisher}/skills/${id.split("/").slice(1).join("/")}`,
      });
    }
  }

  let failures = 0;
  if (stale.length > 0) {
    failures = await crawlBatch(stale, cache, concurrency, `Re-checking ${stale.length} stale GitHub URLs`);
  }
  return { staleChecked: stale.length, failures };
}

/**
 * Resolve officialskills.sh URLs to GitHub source URLs.
 * Uses the cache to skip already-resolved skills and re-crawls stale entries.
 */
async function resolveSkillUrls(
  skills: Skill[],
  cache: Cache,
  concurrency = 10,
): Promise<{ skills: Skill[]; cache: Cache; stats: CrawlStats }> {
  // Count cache hits before any resolution
  let cacheHits = 0;
  for (const s of skills) {
    if (cache.resolved[s.id]) cacheHits++;
  }

  // 1. Re-crawl stale cache entries
  const { staleChecked, failures: staleFailures } = await refreshStaleCache(cache, concurrency);

  // 2. Find skills from the fresh README not yet in cache
  const toResolve = skills.filter(
    (s) => s.url.includes("officialskills.sh") && !cache.resolved[s.id],
  );
  let newFailures = 0;
  if (toResolve.length > 0) {
    newFailures = await crawlBatch(
      toResolve.map((s) => ({ id: s.id, url: s.url })),
      cache,
      concurrency,
      `Crawling ${toResolve.length} new officialskills.sh URLs`,
    );
  }

  // 3. Apply all cached URLs to the skills list
  for (const s of skills) {
    const entry = cache.resolved[s.id];
    if (entry) {
      s.url = entry.githubUrl;
      s.repo = repoFromUrl(entry.githubUrl);
    }
  }

  const stats: CrawlStats = {
    cacheHits,
    staleChecked,
    newCrawled: toResolve.length - newFailures,
    failures: staleFailures + newFailures,
  };

  return { skills, cache, stats };
}

// ============================================================
// Diff computation
// ============================================================

function computeDiff(
  current: Skill[],
  previous: Skill[] | undefined,
): { added: Skill[]; removed: Skill[]; changed: { id: string; from: string; to: string }[] } | null {
  if (!previous || previous.length === 0) return null;

  const prevMap = new Map(previous.map((s) => [s.id, s]));
  const currMap = new Map(current.map((s) => [s.id, s]));

  const added = current.filter((s) => !prevMap.has(s.id));
  const removed = previous.filter((s) => !currMap.has(s.id));
  const changed: { id: string; from: string; to: string }[] = [];

  for (const s of current) {
    const prev = prevMap.get(s.id);
    if (prev && prev.url !== s.url) {
      changed.push({ id: s.id, from: prev.url, to: s.url });
    }
  }

  return { added, removed, changed };
}

// ============================================================
// README update (consolidated from update-readme.mjs)
// ============================================================

const SKILL_SCHEMA = {
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

const OUTPUT_SCHEMA = {
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
                skills:        { type: "array", items: SKILL_SCHEMA },
              },
            },
          },
        },
      },
    },
    skills: {
      type: "array",
      description: "Flat list of all skills in this file, sorted by publisher then id",
      items: SKILL_SCHEMA,
    },
  },
};

const MANIFEST_SCHEMA = {
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

function schemaToMarkdown(title: string, schema: object): string {
  const json = JSON.stringify(schema, null, 2);
  return [
    `<details>`,
    `<summary><strong>${title}</strong></summary>`,
    "",
    "```json",
    json,
    "```",
    `</details>`,
  ].join("\n");
}

function updateReadme(readmePath: string, output: Output, now: string): void {
  let readme = readFileSync(readmePath, "utf-8");

  // --- Stats badges ---
  const official = output.meta.total_official + output.meta.total_community;
  const totalPublishers = output.meta.total_publishers;
  const fetchedAt = output.meta.fetched_at;
  const statsBlock = [
    "<!-- REGISTRY_STATS -->",
    `<p align="center">`,
    `  <img src="https://img.shields.io/static/v1?label=last+run&message=${encodeURIComponent(now)}&color=blue&style=flat" alt="Last run">`,
    `  <img src="https://img.shields.io/static/v1?label=last+change&message=${encodeURIComponent(fetchedAt)}&color=informational&style=flat" alt="Last change">`,
    `  <img src="https://img.shields.io/static/v1?label=publishers&message=${totalPublishers}&color=orange&style=flat" alt="Publishers">`,
    `  <img src="https://img.shields.io/static/v1?label=skills&message=${official}&color=green&style=flat" alt="Skills">`,
    `</p>`,
    "<!-- /REGISTRY_STATS -->",
  ].join("\n");

  const statsStart = "<!-- REGISTRY_STATS -->";
  const statsEnd = "<!-- /REGISTRY_STATS -->";
  const ss = readme.indexOf(statsStart);
  const se = readme.indexOf(statsEnd);
  if (ss !== -1 && se !== -1) {
    readme = readme.slice(0, ss) + statsBlock + readme.slice(se + statsEnd.length);
  }

  // --- JSON Schemas ---
  const schemaBlock = [
    "<!-- JSON_SCHEMA -->",
    "",
    "### Registry schemas",
    "",
    "These JSON Schemas describe the structure of the generated files.",
    "",
    schemaToMarkdown("official.json / community.json — Output", OUTPUT_SCHEMA),
    "",
    schemaToMarkdown("manifest.json — Manifest", MANIFEST_SCHEMA),
    "",
    schemaToMarkdown("Skill (inner type)", SKILL_SCHEMA),
    "",
    "<!-- /JSON_SCHEMA -->",
  ].join("\n");

  const schemaStart = "<!-- JSON_SCHEMA -->";
  const schemaEnd = "<!-- /JSON_SCHEMA -->";
  const scs = readme.indexOf(schemaStart);
  const sce = readme.indexOf(schemaEnd);
  if (scs !== -1 && sce !== -1) {
    const currentBlock = readme.slice(scs, sce + schemaEnd.length);
    if (currentBlock !== schemaBlock) {
      readme = readme.slice(0, scs) + schemaBlock + readme.slice(sce + schemaEnd.length);
    }
  } else {
    const insertAt = readme.indexOf("## Output structure");
    if (insertAt !== -1) {
      readme = readme.slice(0, insertAt) + schemaBlock + "\n\n" + readme.slice(insertAt);
    }
  }

  writeFileSync(readmePath, readme, "utf-8");
  console.error(`  Updated ${readmePath}`);
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const cache = loadCache();

  // --readme only: update README from existing registry files, no fetch
  if (readmePath && !saveDir && !process.argv.includes("--save") && process.argv.includes("--readme")) {
    const officialPath = join(process.cwd(), "registry", "official.json");
    try {
      const output = JSON.parse(readFileSync(officialPath, "utf-8")) as Output;
      updateReadme(readmePath, output, now);
      return;
    } catch {
      console.error("ERROR: No registry/official.json found. Run with --save first.");
      process.exit(1);
    }
  }

  // ---- Fetch README with conditional request ----
  console.error("Fetching README from awesome-agent-skills ...");
  const headers: Record<string, string> = {};
  if (cache.readmeEtag) headers["If-None-Match"] = cache.readmeEtag;

  const response = await fetch(READONLY_URL, { headers });

  if (response.status === 304) {
    console.error("  README unchanged (304). Checking stale cache entries ...");
    const r = await refreshStaleCache(cache);
    if (r.staleChecked > 0) {
      saveCache(cache);
      console.error(`  Cache: ${r.staleChecked} stale, ${r.failures} failures`);
    }
    console.error("  Done.");
    return;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch README: ${response.status} ${response.statusText}`,
    );
  }

  // ---- Parse new README ----
  const etag = response.headers.get("etag");
  if (etag) cache.readmeEtag = etag;

  const readme = await response.text();

  console.error("Parsing skills ...");
  let skills = parseSkills(readme);
  console.error(`  Extracted ${skills.length} skills`);

  // ---- Resolve GitHub URLs ----
  console.error("Resolving GitHub source URLs ...");
  const { stats } = await resolveSkillUrls(skills, cache);

  // Enrich repo field for all skills
  skills = skills.map((s) => ({ ...s, repo: s.repo ?? repoFromUrl(s.url) }));

  // ---- Build output ----
  console.error("Building JSON structure ...");
  const output = buildOutput(skills);

  // ---- Diff against previous snapshot ----
  const diff = computeDiff(skills, cache.previousSnapshot);
  if (diff) {
    if (diff.added.length > 0) console.error(`  + ${diff.added.length} skills added`);
    if (diff.removed.length > 0) console.error(`  - ${diff.removed.length} skills removed`);
    if (diff.changed.length > 0) console.error(`  ~ ${diff.changed.length} URLs changed`);
  }

  // ---- Save snapshot for next diff ----
  cache.previousSnapshot = skills.map((s) => ({
    id: s.id, url: s.url, name: s.name, description: s.description,
    publisher: s.publisher, section: s.section, repo: s.repo,
  }));

  // ---- Write output ----
  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    saveCache(cache);

    const officialOutput = buildOutput(
      output.skills.filter((s) => {
        const p = output.publishers.find((pub) => pub.name === s.publisher);
        return p && p.type === "official";
      }),
    );
    const communityOutput = buildOutput(
      output.skills.filter((s) => {
        const p = output.publishers.find((pub) => pub.name === s.publisher);
        return p && p.type === "community";
      }),
    );

    const officialJson = JSON.stringify(officialOutput, null, 2);
    writeFileSync(join(saveDir, "official.json"), officialJson, "utf-8");
    console.error(`  Wrote official.json (${Buffer.byteLength(officialJson, "utf-8")} bytes)`);

    const communityJson = JSON.stringify(communityOutput, null, 2);
    writeFileSync(join(saveDir, "community.json"), communityJson, "utf-8");
    console.error(`  Wrote community.json (${Buffer.byteLength(communityJson, "utf-8")} bytes)`);

    const manifestPublishers: Record<string, {
      skills_count: number;
      skills: { id: string; name: string; url: string; repo: string | null; publisher: string }[];
    }> = {};
    for (const pub of output.publishers) {
      manifestPublishers[pub.name] = {
        skills_count: pub.skills_count,
        skills: pub.skills.flatMap((s) =>
          s.skills.map((sk) => ({
            id: sk.id, name: sk.name, url: sk.url, repo: sk.repo,
            publisher: pub.name,
          })),
        ),
      };
    }
    const manifest = {
      generated_at: output.meta.fetched_at,
      total_skills: output.meta.total_skills,
      publishers: manifestPublishers,
    };
    const manifestJson = JSON.stringify(manifest, null, 2);
    writeFileSync(join(saveDir, "manifest.json"), manifestJson, "utf-8");
    console.error(`  Wrote manifest.json (${Buffer.byteLength(manifestJson, "utf-8")} bytes)`);

    // ---- Update README if --readme was passed ----
    if (readmePath) {
      updateReadme(readmePath, output, now);
    }
  } else {
    const json = JSON.stringify(output, null, 2);
    console.log(json);
    saveCache(cache);
  }

  // ---- Print crawl stats ----
  console.error(`  Stats: ${stats.cacheHits} cached, ${stats.staleChecked} stale, ${stats.newCrawled} new, ${stats.failures} failures`);

  // ---- Print summary ----
  printSummary(output);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
