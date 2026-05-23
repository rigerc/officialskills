#!/usr/bin/env node
/**
 * awesome-skills — Parse awesome-agent-skills README into JSON
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
 *   npx tsx awesome-skills.ts               Output full JSON to stdout
 *   npx tsx awesome-skills.ts --save <dir>   Write official.json, community.json,
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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const READONLY_URL =
  "https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md";

function parseArgs(): { saveDir: string | null } {
  const saveIdx = process.argv.indexOf("--save");
  if (saveIdx !== -1 && saveIdx + 1 < process.argv.length) {
    return { saveDir: process.argv[saveIdx + 1] };
  }
  return { saveDir: null };
}

const { saveDir } = parseArgs();

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
function extractPublisher(heading: string): string {
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
function parseSkillLine(
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
function parseSkills(readme: string): Skill[] {
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

function buildOutput(skills: Skill[]): Output {
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
function repoFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match?.[1] ?? null;
}

/**
 * Resolve all officialskills.sh URLs to their GitHub source URLs
 * by crawling the pages with controlled concurrency.
 */
async function resolveSkillUrls(
  skills: Skill[],
  concurrency = 10,
): Promise<Skill[]> {
  const toResolve = skills.filter((s) => s.url.includes("officialskills.sh"));
  if (toResolve.length === 0) return skills;

  console.error(`  Resolving ${toResolve.length} GitHub URLs ...`);

  let completed = 0;
  const replacements = new Map<string, string>();

  for (let i = 0; i < toResolve.length; i += concurrency) {
    const chunk = toResolve.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (s) => ({
        id: s.id,
        url: (await resolveGithubUrl(s.url)) ?? s.url,
      })),
    );
    for (const r of results) {
      replacements.set(r.id, r.url);
    }
    completed += chunk.length;
    console.error(`    ${completed}/${toResolve.length} resolved`);
  }

  const updated = skills.map((s) => {
    const newUrl = replacements.get(s.id);
    return newUrl && newUrl !== s.url ? { ...s, url: newUrl, repo: repoFromUrl(newUrl) } : s;
  });

  const changed = updated.filter((s, i) => s.url !== skills[i].url).length;
  console.error(`  Updated ${changed} URLs to GitHub source`);

  return updated;
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.error("Fetching README from awesome-agent-skills ...");

  const response = await fetch(READONLY_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch README: ${response.status} ${response.statusText}`,
    );
  }

  const readme = await response.text();

  console.error("Parsing skills ...");
  let skills = parseSkills(readme);
  console.error(`  Extracted ${skills.length} skills`);

  console.error("Resolving GitHub source URLs ...");
  skills = await resolveSkillUrls(skills);

  // Enrich repo field for all skills (already set for resolved ones)
  skills = skills.map((s) => ({ ...s, repo: s.repo ?? repoFromUrl(s.url) }));

  console.error("Building JSON structure ...");
  const output = buildOutput(skills);

  if (saveDir) {
    // ---- Split output into files ----
    mkdirSync(saveDir, { recursive: true });

    // Rebuild full Output (with grouped publishers & metadata) for each type
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
    console.error(
      `  Wrote official.json (${Buffer.byteLength(officialJson, "utf-8")} bytes)`,
    );

    const communityJson = JSON.stringify(communityOutput, null, 2);
    writeFileSync(join(saveDir, "community.json"), communityJson, "utf-8");
    console.error(
      `  Wrote community.json (${Buffer.byteLength(communityJson, "utf-8")} bytes)`,
    );

    // Publisher-keyed manifest for fast programmatic lookup
    const manifestPublishers: Record<string, { skills_count: number; skills: { id: string; name: string; url: string; repo: string | null }[] }> = {};
    for (const pub of output.publishers) {
      manifestPublishers[pub.name] = {
        skills_count: pub.skills_count,
        skills: pub.skills.flatMap((s) =>
          s.skills.map((sk) => ({
            id: sk.id,
            name: sk.name,
            url: sk.url,
            repo: sk.repo,
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
    console.error(
      `  Wrote manifest.json (${Buffer.byteLength(manifestJson, "utf-8")} bytes)`,
    );
  } else {
    // ---- No --save: full JSON to stdout ----
    const json = JSON.stringify(output, null, 2);
    console.log(json);
  }

  // Pretty-print summary to stderr
  printSummary(output);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
