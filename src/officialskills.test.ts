import { beforeAll, describe, expect, it } from "vitest";
// ESM convention: even though source is .ts, import path uses .js extension
// as required by TypeScript when moduleResolution is "bundler" (or "node16").
import {
  buildOutput,
  extractPublisher,
  parseSkillLine,
  parseSkills,
  repoFromUrl,
  type Output,
  type Skill,
} from "./officialskills.js";

// ----------------------------------------------------------------
// parseSkillLine
// ----------------------------------------------------------------

describe("parseSkillLine", () => {
  it("parses a standard skill line", () => {
    const line =
      '- **[addyosmani/accessibility](https://officialskills.sh/addyosmani/skills/accessibility)** - WCAG compliance, screen reader support, and keyboard navigation';
    const result = parseSkillLine(line);
    expect(result).toEqual({
      id: "addyosmani/accessibility",
      name: "accessibility",
      url: "https://officialskills.sh/addyosmani/skills/accessibility",
      description: "WCAG compliance, screen reader support, and keyboard navigation",
      repo: null, // not a github URL
    });
  });

  it("parses a line with a GitHub URL", () => {
    const line =
      '- **[user/repo](https://github.com/user/repo)** - A great skill';
    const result = parseSkillLine(line);
    expect(result).toEqual({
      id: "user/repo",
      name: "repo",
      url: "https://github.com/user/repo",
      description: "A great skill",
      repo: "user/repo",
    });
  });

  it("extracts name from the last path segment", () => {
    const line =
      '- **[deeply/nested/skill-name](https://example.com/url)** - Does something';
    const result = parseSkillLine(line);
    expect(result).toEqual({
      id: "deeply/nested/skill-name",
      name: "skill-name",
      url: "https://example.com/url",
      description: "Does something",
      repo: null,
    });
  });

  it("returns null for a non-skill line", () => {
    expect(parseSkillLine("### Skills by Anthropic")).toBeNull();
    expect(parseSkillLine("")).toBeNull();
    expect(parseSkillLine("- just a bullet point")).toBeNull();
    expect(parseSkillLine("```json")).toBeNull();
  });

  it("handles descriptions with special characters", () => {
    const line =
      '- **[test/skill](https://example.com)** - Uses `code` and "quotes" & more';
    const result = parseSkillLine(line);
    expect(result?.description).toBe('Uses `code` and "quotes" & more');
  });
});

// ----------------------------------------------------------------
// extractPublisher
// ----------------------------------------------------------------

describe("extractPublisher", () => {
  it("extracts simple publisher name", () => {
    expect(extractPublisher("Skills by VoltAgent")).toBe("VoltAgent");
  });

  it("strips parenthetical qualifiers", () => {
    expect(extractPublisher("Skills by Addy Osmani (Web Quality)")).toBe("Addy Osmani");
  });

  it("takes the last segment after ' - '", () => {
    expect(extractPublisher("Skills by Google Chrome team - Addy Osmani")).toBe("Addy Osmani");
  });

  it("removes trailing ' for ...' clauses", () => {
    expect(extractPublisher("Skills by Anthropic for their dev team.")).toBe("Anthropic");
  });

  it("removes ' Team' suffix", () => {
    expect(extractPublisher("Skills by Microsoft Development Team")).toBe("Microsoft");
  });

  it("removes ' Engineering Team' suffix", () => {
    expect(extractPublisher("Skills by Vercel Engineering Team")).toBe("Vercel");
  });

  it("strips trailing punctuation", () => {
    expect(extractPublisher("Skills by Some Publisher.")).toBe("Some Publisher");
  });

  it("handles complex nested publisher names", () => {
    expect(extractPublisher("Skills by Google Chrome team - Addy Osmani (Web Quality)")).toBe("Addy Osmani");
  });
});

// ----------------------------------------------------------------
// repoFromUrl
// ----------------------------------------------------------------

describe("repoFromUrl", () => {
  it("extracts owner/repo from a GitHub URL", () => {
    expect(repoFromUrl("https://github.com/anthropics/skills/tree/main/skills/algorithmic-art")).toBe("anthropics/skills");
  });

  it("extracts owner/repo from a root GitHub URL", () => {
    expect(repoFromUrl("https://github.com/AgriciDaniel/claude-seo")).toBe("AgriciDaniel/claude-seo");
  });

  it("returns null for non-GitHub URLs", () => {
    expect(repoFromUrl("https://officialskills.sh/addyosmani/skills/accessibility")).toBeNull();
    expect(repoFromUrl("")).toBeNull();
  });
});

// ----------------------------------------------------------------
// parseSkills (integration — state machine over realistic markdown)
// ----------------------------------------------------------------

describe("parseSkills", () => {
  const README_SNIPPET = `
# Awesome Agent Skills

## Official Skills

### Skills by Anthropic

- **[anthropics/algorithmic-art](https://officialskills.sh/anthropics/skills/algorithmic-art)** - Create algorithmic art with Claude
- **[anthropics/data-analysis](https://officialskills.sh/anthropics/skills/data-analysis)** - Analyze tabular data step by step

<details>
  <summary><h3>Skills by Microsoft</h3></summary>

### Core Skills

- **[microsoft/core-skill](https://officialskills.sh/microsoft/skills/core-skill)** - A core Microsoft skill

### .NET Skills

- **[microsoft/dotnet-lib](https://officialskills.sh/microsoft/skills/dotnet-lib)** - A .NET library skill
</details>

### Community Skills

### Data & Analytics

- **[community/transform](https://github.com/community/transform)** - A data transform skill

### DevOps

- **[community/deploy](https://github.com/community/deploy)** - A deployment skill
`;

  it("parses official skills by publisher", () => {
    const skills = parseSkills(README_SNIPPET);
    const anthropicSkills = skills.filter((s) => s.publisher === "Anthropic");
    expect(anthropicSkills.length).toBe(2);
    expect(anthropicSkills[0].id).toBe("anthropics/algorithmic-art");
    expect(anthropicSkills[0].section).toBe("Official");
    expect(anthropicSkills[1].id).toBe("anthropics/data-analysis");
  });

  it("parses Microsoft skills with sub-sections", () => {
    const skills = parseSkills(README_SNIPPET);
    const msSkills = skills.filter((s) => s.publisher === "Microsoft");
    expect(msSkills.length).toBe(2);

    const coreSkill = msSkills.find((s) => s.id === "microsoft/core-skill")!;
    expect(coreSkill.section).toBe("Core Skills");

    const dotnetSkill = msSkills.find((s) => s.id === "microsoft/dotnet-lib")!;
    expect(dotnetSkill.section).toBe(".NET Skills");
  });

  it("parses community skills into sub-categories", () => {
    const skills = parseSkills(README_SNIPPET);
    const communitySkills = skills.filter((s) => s.publisher === "Community");
    expect(communitySkills.length).toBe(2);

    const transform = communitySkills.find((s) => s.id === "community/transform")!;
    expect(transform.section).toBe("Data & Analytics");

    const deploy = communitySkills.find((s) => s.id === "community/deploy")!;
    expect(deploy.section).toBe("DevOps");
  });

  it("sets publisher and section correctly on every skill", () => {
    const skills = parseSkills(README_SNIPPET);
    for (const s of skills) {
      expect(s.publisher).toBeTruthy();
      expect(s.section).toBeTruthy();
    }
  });

  it("extracts the last path segment as the name", () => {
    const skills = parseSkills(README_SNIPPET);
    const algo = skills.find((s) => s.id === "anthropics/algorithmic-art")!;
    expect(algo.name).toBe("algorithmic-art");
  });

  it("extracts repo from GitHub URLs and null from officialskills.sh URLs", () => {
    const skills = parseSkills(README_SNIPPET);
    const algo = skills.find((s) => s.id === "anthropics/algorithmic-art")!;
    expect(algo.repo).toBeNull();

    const transform = skills.find((s) => s.id === "community/transform")!;
    expect(transform.repo).toBe("community/transform");
  });

  it("handles empty input gracefully", () => {
    expect(parseSkills("")).toEqual([]);
    expect(parseSkills("   \n\n  ")).toEqual([]);
  });

  it("handles markdown with no skill entries", () => {
    const md = "# Just a heading\n\nSome text\n";
    expect(parseSkills(md)).toEqual([]);
  });
});

// ----------------------------------------------------------------
// buildOutput
// ----------------------------------------------------------------

describe("buildOutput", () => {
  const mockSkills: Skill[] = [
    {
      id: "beta/skill-b",
      name: "skill-b",
      url: "https://github.com/beta/skill-b",
      description: "Beta's second skill",
      publisher: "Beta",
      section: "Official",
      repo: "beta/skill-b",
    },
    {
      id: "alpha/skill-a",
      name: "skill-a",
      url: "https://github.com/alpha/skill-a",
      description: "Alpha's only skill",
      publisher: "Alpha",
      section: "Official",
      repo: "alpha/skill-a",
    },
    {
      id: "community/skill-c",
      name: "skill-c",
      url: "https://github.com/community/skill-c",
      description: "A community skill",
      publisher: "Community",
      section: "Data Tools",
      repo: "community/skill-c",
    },
    {
      id: "beta/skill-c",
      name: "skill-c",
      url: "https://github.com/beta/skill-c",
      description: "Beta's first skill",
      publisher: "Beta",
      section: "Official",
      repo: "beta/skill-c",
    },
  ];

  let output: Output;

  beforeAll(() => {
    output = buildOutput(mockSkills);
  });

  it("returns correct meta counts", () => {
    expect(output.meta.total_skills).toBe(4);
    expect(output.meta.total_publishers).toBe(3);
    expect(output.meta.total_official).toBe(3);
    expect(output.meta.total_community).toBe(1);
  });

  it("sorts skills by publisher then by id", () => {
    const ids = output.skills.map((s) => s.id);
    expect(ids).toEqual([
      "alpha/skill-a",
      "beta/skill-b",
      "beta/skill-c",
      "community/skill-c",
    ]);
  });

  it("groups publishers correctly", () => {
    const names = output.publishers.map((p) => p.name);
    expect(names).toEqual(["Alpha", "Beta", "Community"]);
  });

  it("classifies Alpha and Beta as official, Community as community", () => {
    const alpha = output.publishers.find((p) => p.name === "Alpha")!;
    expect(alpha.type).toBe("official");

    const beta = output.publishers.find((p) => p.name === "Beta")!;
    expect(beta.type).toBe("official");

    const community = output.publishers.find((p) => p.name === "Community")!;
    expect(community.type).toBe("community");
  });

  it("nests skills into correct publisher sections", () => {
    const alpha = output.publishers.find((p) => p.name === "Alpha")!;
    expect(alpha.skills_count).toBe(1);
    expect(alpha.skills[0].skills[0].id).toBe("alpha/skill-a");

    const beta = output.publishers.find((p) => p.name === "Beta")!;
    expect(beta.skills_count).toBe(2);
    expect(beta.skills[0].skills_count).toBe(2);
  });

  it("includes fetched_at in the meta", () => {
    expect(output.meta.fetched_at).toBeTruthy();
    // Should be an ISO string ending in Z
    expect(output.meta.fetched_at).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("source URL is set correctly", () => {
    expect(output.meta.source).toContain("awesome-agent-skills");
  });

  it("has correct total_categories across publishers", () => {
    // Two categories: "Official" (Alpha, Beta) + "Data Tools" (Community)
    expect(output.meta.total_categories).toBe(2);
  });
});
