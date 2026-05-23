import { describe, it, expect } from "vitest";
import { parseSkillLine, extractPublisher, repoFromUrl } from "./officialskills.js";

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
