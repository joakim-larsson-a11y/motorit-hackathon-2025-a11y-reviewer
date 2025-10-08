import type { Fetcher, HttpRetryOptions } from "./http";
import { fetchWithRetry } from "./http";

type RuleType = "allow" | "disallow";

export type RobotsAgentRules = {
  allow: string[];
  disallow: string[];
};

export type RobotsInfo = {
  sitemapUrls: string[];
  agents: Map<string, RobotsAgentRules>;
};

type CompiledRule = {
  type: RuleType;
  pattern: string;
  regex: RegExp;
};

export type RobotsFetchOptions = Partial<HttpRetryOptions>;

export async function fetchRobotsTxt(
  origin: URL,
  fetcher: Fetcher,
  options: RobotsFetchOptions = {}
): Promise<RobotsInfo | null> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  try {
    const response = await fetchWithRetry(fetcher, robotsUrl, undefined, options);
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return parseRobotsTxt(text);
  } catch {
    return null;
  }
}

export function getAgentRules(info: RobotsInfo | null, agent = "*"): RobotsAgentRules | null {
  if (!info) {
    return null;
  }

  const direct = info.agents.get(agent.toLowerCase());
  if (direct) {
    return direct;
  }

  return info.agents.get("*") ?? null;
}

/**
 * Filters URLs against robots.txt directives using longest-match precedence.
 * Handles wildcard (*) patterns and preserves allow-priority on equal length.
 */
export function filterByRobots(
  urls: string[],
  origin: URL,
  rules: RobotsAgentRules | null
): string[] {
  if (!rules) {
    return urls;
  }

  const compiled = compileRules(rules);
  return urls.filter((url) => isAllowed(url, origin, compiled));
}

function parseRobotsTxt(text: string): RobotsInfo {
  const agents = new Map<string, RobotsAgentRules>();
  const sitemapUrls: string[] = [];

  let currentAgents: string[] = [];

  const ensureRules = (agent: string) => {
    const key = agent.toLowerCase();
    if (!agents.has(key)) {
      agents.set(key, { allow: [], disallow: [] });
    }
    return agents.get(key)!;
  };

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      if (line === "") {
        currentAgents = [];
      }
      continue;
    }

    const delimiterIndex = line.indexOf(":");
    if (delimiterIndex === -1) {
      continue;
    }

    const directive = line.slice(0, delimiterIndex).trim().toLowerCase();
    const value = line.slice(delimiterIndex + 1).trim();

    switch (directive) {
      case "user-agent": {
        if (value !== "") {
          currentAgents.push(value);
        }
        break;
      }
      case "allow":
      case "disallow": {
        const agentsToUpdate = currentAgents.length > 0 ? currentAgents : ["*"];
        if (value === "") {
          break;
        }
        for (const agent of agentsToUpdate) {
          const rules = ensureRules(agent);
          rules[directive].push(value);
        }
        break;
      }
      case "sitemap": {
        if (value !== "") {
          sitemapUrls.push(value);
        }
        break;
      }
      default:
        break;
    }
  }

  return { sitemapUrls, agents };
}

function compileRules(rules: RobotsAgentRules): CompiledRule[] {
  const compiled: CompiledRule[] = [];

  for (const pattern of rules.allow) {
    compiled.push({
      type: "allow",
      pattern,
      regex: buildPatternRegex(pattern)
    });
  }

  for (const pattern of rules.disallow) {
    compiled.push({
      type: "disallow",
      pattern,
      regex: buildPatternRegex(pattern)
    });
  }

  return compiled;
}

function isAllowed(url: string, origin: URL, rules: CompiledRule[]): boolean {
  let absolute: URL;
  try {
    absolute = new URL(url, origin);
  } catch {
    return false;
  }

  const target = `${absolute.pathname}${absolute.search}`;
  let bestRule: CompiledRule | null = null;

  for (const rule of rules) {
    if (!rule.regex.test(target)) {
      continue;
    }
    if (!bestRule) {
      bestRule = rule;
      continue;
    }

    if (rule.pattern.length > bestRule.pattern.length) {
      bestRule = rule;
    } else if (rule.pattern.length === bestRule.pattern.length && rule.type === "allow" && bestRule.type === "disallow") {
      bestRule = rule;
    }
  }

  if (!bestRule) {
    return true;
  }

  return bestRule.type === "allow";
}

/**
 * Robots.txt patterns are simple glob prefixes. We convert them to regex while keeping
 * trailing "$" meaningful (anchors end-of-path) and note the original pattern length
 * for precedence.
 */
function buildPatternRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/([.+?^${}()|[\]\\])/g, "\\$1")
    .replace(/\*/g, ".*")
    .replace(/\\\$/g, "$");

  return new RegExp(`^${escaped}`);
}
