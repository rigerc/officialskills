# officialskills

Parses the [awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) README into structured JSON, resolves all `officialskills.sh` URLs to their real GitHub source URLs, and produces three output files — [`official.json`](https://raw.githubusercontent.com/rigerc/officialskills/main/registry/official.json), [`community.json`](https://raw.githubusercontent.com/rigerc/officialskills/main/registry/community.json), and [`manifest.json`](https://raw.githubusercontent.com/rigerc/officialskills/main/registry/manifest.json).

> This collection features official skills published by leading development teams, including Anthropic, Google Labs, Vercel, Stripe, Cloudflare, Netlify, Trail of Bits, Sentry, Expo, Hugging Face, Figma, and more, alongside community-built skills.
>
> Compatible with Claude Code, Codex, Antigravity, Gemini CLI, Cursor, GitHub Copilot, OpenCode, Windsurf, and more. See the table below for paths and documentation.
>
> The most contributed Agent Skills repository, built and maintained together with the community.

<!-- REGISTRY_STATS -->
<p align="center">
  <img src="https://img.shields.io/static/v1?label=last+run&message=2026-08-29T11%3A58%3A45Z&color=blue&style=flat" alt="Last run">
  <img src="https://img.shields.io/static/v1?label=last+change&message=2026-08-29T11%3A59%3A01Z&color=informational&style=flat" alt="Last change">
  <img src="https://img.shields.io/static/v1?label=publishers&message=60&color=orange&style=flat" alt="Publishers">
  <img src="https://img.shields.io/static/v1?label=skills&message=1223&color=green&style=flat" alt="Skills">
</p>
<!-- /REGISTRY_STATS -->

## Usage

```
USAGE
  npx tsx officialskills.ts               Output full JSON to stdout
  npx tsx officialskills.ts --save <dir>   Write official.json, community.json,
                                           and manifest.json into <dir>

OPTIONS
  --save <dir>   Output directory for the three JSON files

CACHE
  Cache is stored in <dir>/.skills-cache.json (or cwd/.skills-cache.json
  when piping to stdout). URLs are re-resolved after 24 hours.
```

<!-- JSON_SCHEMA -->

### Registry schemas

These JSON Schemas describe the structure of the generated files.

<details>
<summary><strong>official.json / community.json — Output</strong></summary>

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Output",
  "type": "object",
  "required": [
    "meta",
    "publishers",
    "skills"
  ],
  "properties": {
    "meta": {
      "type": "object",
      "required": [
        "fetched_at",
        "source",
        "total_skills",
        "total_publishers",
        "total_categories",
        "total_official",
        "total_community"
      ],
      "properties": {
        "fetched_at": {
          "type": "string",
          "format": "date-time",
          "description": "When the source README was fetched"
        },
        "source": {
          "type": "string",
          "format": "uri",
          "description": "Source README URL"
        },
        "total_skills": {
          "type": "integer",
          "description": "Total number of skills in this file"
        },
        "total_publishers": {
          "type": "integer",
          "description": "Total number of publishers"
        },
        "total_categories": {
          "type": "integer",
          "description": "Unique section categories across publishers"
        },
        "total_official": {
          "type": "integer",
          "description": "Official skills count (only relevant in full output)"
        },
        "total_community": {
          "type": "integer",
          "description": "Community skills count (only relevant in full output)"
        }
      }
    },
    "publishers": {
      "type": "array",
      "description": "Skills grouped by publisher, then by section",
      "items": {
        "type": "object",
        "required": [
          "name",
          "type",
          "skills_count",
          "skills"
        ],
        "properties": {
          "name": {
            "type": "string",
            "description": "Publisher name"
          },
          "type": {
            "type": "string",
            "enum": [
              "official",
              "community"
            ]
          },
          "skills_count": {
            "type": "integer",
            "description": "Total skills for this publisher"
          },
          "skills": {
            "type": "array",
            "description": "Sections within this publisher",
            "items": {
              "type": "object",
              "required": [
                "section",
                "skills_count",
                "skills"
              ],
              "properties": {
                "section": {
                  "type": "string",
                  "description": "Section name, e.g. \"Official\" or \"Core Skills\""
                },
                "skills_count": {
                  "type": "integer"
                },
                "skills": {
                  "type": "array",
                  "items": {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "title": "Skill",
                    "type": "object",
                    "required": [
                      "id",
                      "name",
                      "url",
                      "description",
                      "publisher",
                      "section",
                      "repo"
                    ],
                    "properties": {
                      "id": {
                        "type": "string",
                        "description": "Unique skill identifier, e.g. \"anthropics/algorithmic-art\""
                      },
                      "name": {
                        "type": "string",
                        "description": "Short skill name (last path segment of id)"
                      },
                      "url": {
                        "type": "string",
                        "format": "uri",
                        "description": "GitHub source URL (resolved from officialskills.sh)"
                      },
                      "description": {
                        "type": "string",
                        "description": "One-line description of what the skill does"
                      },
                      "publisher": {
                        "type": "string",
                        "description": "Publisher name, e.g. \"Anthropic\""
                      },
                      "section": {
                        "type": "string",
                        "description": "Section within publisher, e.g. \"Official\""
                      },
                      "repo": {
                        "type": "string",
                        "nullable": true,
                        "description": "GitHub repository as \"<owner>/<repo>\", null if unresolved"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "skills": {
      "type": "array",
      "description": "Flat list of all skills in this file, sorted by publisher then id",
      "items": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Skill",
        "type": "object",
        "required": [
          "id",
          "name",
          "url",
          "description",
          "publisher",
          "section",
          "repo"
        ],
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique skill identifier, e.g. \"anthropics/algorithmic-art\""
          },
          "name": {
            "type": "string",
            "description": "Short skill name (last path segment of id)"
          },
          "url": {
            "type": "string",
            "format": "uri",
            "description": "GitHub source URL (resolved from officialskills.sh)"
          },
          "description": {
            "type": "string",
            "description": "One-line description of what the skill does"
          },
          "publisher": {
            "type": "string",
            "description": "Publisher name, e.g. \"Anthropic\""
          },
          "section": {
            "type": "string",
            "description": "Section within publisher, e.g. \"Official\""
          },
          "repo": {
            "type": "string",
            "nullable": true,
            "description": "GitHub repository as \"<owner>/<repo>\", null if unresolved"
          }
        }
      }
    }
  }
}
```
</details>

<details>
<summary><strong>manifest.json — Manifest</strong></summary>

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Manifest",
  "type": "object",
  "required": [
    "generated_at",
    "total_skills",
    "publishers"
  ],
  "properties": {
    "generated_at": {
      "type": "string",
      "format": "date-time",
      "description": "When this manifest was generated"
    },
    "total_skills": {
      "type": "integer",
      "description": "Total skills across all publishers"
    },
    "publishers": {
      "type": "object",
      "description": "Publisher-keyed map for O(1) lookup",
      "additionalProperties": {
        "type": "object",
        "required": [
          "skills_count",
          "skills"
        ],
        "properties": {
          "skills_count": {
            "type": "integer"
          },
          "skills": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "id",
                "name",
                "url",
                "repo"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique skill identifier"
                },
                "name": {
                  "type": "string",
                  "description": "Short skill name"
                },
                "url": {
                  "type": "string",
                  "format": "uri",
                  "description": "GitHub source URL"
                },
                "repo": {
                  "type": "string",
                  "nullable": true,
                  "description": "GitHub repository as \"<owner>/<repo>\""
                }
              }
            }
          }
        }
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Skill (inner type)</strong></summary>

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Skill",
  "type": "object",
  "required": [
    "id",
    "name",
    "url",
    "description",
    "publisher",
    "section",
    "repo"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique skill identifier, e.g. \"anthropics/algorithmic-art\""
    },
    "name": {
      "type": "string",
      "description": "Short skill name (last path segment of id)"
    },
    "url": {
      "type": "string",
      "format": "uri",
      "description": "GitHub source URL (resolved from officialskills.sh)"
    },
    "description": {
      "type": "string",
      "description": "One-line description of what the skill does"
    },
    "publisher": {
      "type": "string",
      "description": "Publisher name, e.g. \"Anthropic\""
    },
    "section": {
      "type": "string",
      "description": "Section within publisher, e.g. \"Official\""
    },
    "repo": {
      "type": "string",
      "nullable": true,
      "description": "GitHub repository as \"<owner>/<repo>\", null if unresolved"
    }
  }
}
```
</details>

<!-- /JSON_SCHEMA -->
