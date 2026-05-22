import type { Prompt } from "@/types/prompt";
import { ALL_PROMPTS_CATEGORY } from "@/types/prompt";

export function filterPrompts(
  prompts: Prompt[],
  filter: { query?: string; category?: string; tags?: string[] },
): Prompt[] {
  const { query = "", category = ALL_PROMPTS_CATEGORY, tags = [] } = filter;
  let result = prompts;

  if (category && category !== ALL_PROMPTS_CATEGORY) {
    result = result.filter((item) => item.category === category);
  }

  if (tags.length > 0) {
    result = result.filter((item) => tags.every((tag) => item.tags.includes(tag)));
  }

  const trimmed = query.trim().toLowerCase();
  if (trimmed) {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      result = result.filter((item) => {
        const haystack = `${item.title} ${item.prompt} ${item.tags.join(" ")} ${item.category}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });
    }
  }

  return result;
}

export function collectCategories(prompts: Prompt[]): string[] {
  const set = new Set<string>();
  for (const item of prompts) {
    if (item.category) set.add(item.category);
  }
  return [ALL_PROMPTS_CATEGORY, ...Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"))];
}

export function collectTags(prompts: Prompt[]): string[] {
  const counter = new Map<string, number>();
  for (const item of prompts) {
    for (const tag of item.tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([tag]) => tag);
}
