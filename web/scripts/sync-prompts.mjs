#!/usr/bin/env node
/**
 * Sync prompt library from upstream awesome-* repositories.
 *
 * Ported from infinite-canvas service/prompt_fetch.go (AGPL-3.0,
 * https://github.com/basketikun/infinite-canvas). The original Go code runs
 * on-demand against a database; this script mirrors the same parsers at
 * build time and writes a static seed.json that ships with the bundle.
 *
 * Output is merged with existing hand-curated seed entries (those whose ids
 * start with "seed-" or whose category does not match an upstream code).
 *
 * Usage:
 *   node web/scripts/sync-prompts.mjs            # full sync
 *   node web/scripts/sync-prompts.mjs --only=davidwu-gpt-image2-prompts
 *   node web/scripts/sync-prompts.mjs --dry-run  # do not write the file
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEED_PATH = resolve(__dirname, "../src/data/prompts/seed.json");

const ARGS = new Set(process.argv.slice(2));
const ONLY = [...ARGS]
  .filter((a) => a.startsWith("--only="))
  .map((a) => a.slice(7))
  .pop();
const DRY_RUN = ARGS.has("--dry-run");

const SOURCES = {
  "gpt-image-2-prompts":
    "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main",
  "awesome-gpt-image":
    "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main",
  "awesome-gpt4o-image-prompts":
    "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main",
  "youmind-gpt-image-2":
    "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main",
  "youmind-nano-banana-pro":
    "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main",
  "davidwu-gpt-image2-prompts":
    "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main",
};

const UPSTREAM_CATEGORIES = [
  {
    category: "gpt-image-2-prompts",
    name: "GPT Image 2 Prompts",
    description: "EvoLinkAI 的 GPT Image 2 案例提示词",
    githubUrl: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
  },
  {
    category: "awesome-gpt-image",
    name: "Awesome GPT Image",
    description: "ZeroLu 的中文 GPT Image 提示词",
    githubUrl: "https://github.com/ZeroLu/awesome-gpt-image",
  },
  {
    category: "awesome-gpt4o-image-prompts",
    name: "Awesome GPT4o Image Prompts",
    description: "ImgEdify 的 GPT-4o 图像提示词",
    githubUrl: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts",
  },
  {
    category: "youmind-gpt-image-2",
    name: "YouMind GPT Image 2",
    description: "YouMind OpenLab 的 GPT Image 2 中文提示词",
    githubUrl: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2",
  },
  {
    category: "youmind-nano-banana-pro",
    name: "YouMind Nano Banana Pro",
    description: "YouMind OpenLab 的 Nano Banana Pro 中文提示词",
    githubUrl: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
  },
  {
    category: "davidwu-gpt-image2-prompts",
    name: "awesome-gpt-image2-prompts",
    description: "davidwuw0811-boop 整理的 GPT Image 2 提示词",
    githubUrl: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts",
  },
];

const GPT_IMAGE2_CASE_FILES = [
  "README.md",
  "cases/ad-creative.md",
  "cases/character.md",
  "cases/comparison.md",
  "cases/ecommerce.md",
  "cases/portrait.md",
  "cases/poster.md",
  "cases/ui.md",
];

async function fetchText(baseUrl, file) {
  const url = `${baseUrl}/${file}`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      const delay = 500 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`fetch ${url} failed after retries: ${lastErr?.message || lastErr}`);
}

function leftPad(value) {
  const text = `000${value}`;
  return value >= 1000 ? String(value) : text.slice(-3);
}

function splitTags(value, pattern) {
  const tags = [];
  for (const tag of value.split(pattern)) {
    const t = String(tag).trim().toLowerCase();
    if (t) tags.push(t);
  }
  return tags;
}

function tagsFromCategory(category) {
  return splitTags(category.replace(/\s+Cases$/i, ""), /\s*(?:&|and)\s*/);
}

function tagsFromHeading(heading) {
  return splitTags(
    heading.replace(/[^\p{L}\p{N}/&、与 ]/gu, ""),
    /\s*(?:\/|&|、|与)\s*/,
  );
}

function youMindTags(title, modelTag) {
  const tags = [modelTag];
  const parts = title.split(" - ");
  if (parts.length > 1) tags.push(...tagsFromHeading(parts[0]));
  return tags;
}

function davidWuTags(item) {
  const joined = [item.category_cn, item.category, item.author, item.source]
    .filter(Boolean)
    .join("/");
  const tags = splitTags(joined, /\//);
  if (item.needs_ref) tags.push("需要参考图");
  return tags;
}

function markdownPreview(images) {
  return images.filter(Boolean).map((img) => `![](${img})`).join("\n\n");
}

function davidWuPreview(item, image) {
  const lines = [];
  if (item.title_en) lines.push(item.title_en);
  if (item.note) lines.push(item.note);
  if (image) lines.push(`![](${image})`);
  return lines.join("\n\n");
}

function absoluteImage(baseUrl, image) {
  if (!image) return "";
  if (image.startsWith("http://") || image.startsWith("https://")) return image;
  return `${baseUrl}/${image.replace(/^\.+/, "").replace(/^\/+/, "")}`;
}

function splitBeforeHeading(markdown, prefix) {
  const blocks = [];
  const lines = markdown.split("\n");
  let current = [];
  for (const line of lines) {
    if (line.startsWith(prefix) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  blocks.push(current.join("\n"));
  return blocks;
}

function firstMatch(value, pattern) {
  const m = value.match(pattern);
  return m && m[1] ? m[1] : "";
}

function extractMarkdownImages(baseUrl, block) {
  const seen = new Set();
  const images = [];
  const patterns = [/<img[^>]+src="([^"]+)"/g, /!\[[^\]]*]\(([^)]+)\)/g];
  for (const re of patterns) {
    for (const m of block.matchAll(re)) {
      const img = absoluteImage(baseUrl, m[1]);
      if (img && !seen.has(img)) {
        seen.add(img);
        images.push(img);
      }
    }
  }
  return images;
}

async function buildGptImage2Prompts() {
  const baseUrl = SOURCES["gpt-image-2-prompts"];
  const raw = await fetchText(baseUrl, "data/ingested_tweets.json");
  const data = JSON.parse(raw);
  const cases = new Map();
  // Pattern equivalent to upstream Go regex (with re-flags s + g).
  const caseRe =
    /### Case \d+: \[[^\]]+\]\(([^)]+)\)[\s\S]*?\*\*Prompt:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/g;
  for (const file of GPT_IMAGE2_CASE_FILES) {
    const md = await fetchText(baseUrl, file);
    for (const m of md.matchAll(caseRe)) {
      cases.set(m[1], m[2].trim());
    }
  }
  const items = [];
  for (const record of data.records || []) {
    const prompt = cases.get(record.tweet_url);
    if (!prompt) continue;
    const image = `${baseUrl}/${record.image_dir}/output.jpg`;
    items.push({
      id: `gpt-image-2-prompts-${leftPad(items.length + 1)}`,
      title: record.title,
      coverUrl: image,
      prompt,
      tags: tagsFromCategory(record.category || ""),
      category: "gpt-image-2-prompts",
      preview: markdownPreview([image]),
      createdAt: record.added_at || "",
      updatedAt: record.added_at || "",
    });
  }
  return items;
}

async function buildAwesomeGptImagePrompts() {
  const baseUrl = SOURCES["awesome-gpt-image"];
  const md = await fetchText(baseUrl, "README.zh-CN.md");
  const items = [];
  const titleLinkRe = /\[([^\]]+)\]\([^)]+\)/g;
  for (const section of splitBeforeHeading(md, "## ")) {
    const headingTags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));
    for (const block of splitBeforeHeading(section, "### ")) {
      const titleRaw = firstMatch(block, /^###\s+(.+)$/m);
      const title = titleRaw.replace(titleLinkRe, "$1").trim();
      const prompt = firstMatch(
        block,
        /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/,
      ).trim();
      if (!title || !prompt) continue;
      const images = extractMarkdownImages(baseUrl, block);
      const cover = images[0] || "";
      items.push({
        id: `awesome-gpt-image-${leftPad(items.length + 1)}`,
        title,
        coverUrl: cover,
        prompt,
        tags: headingTags,
        category: "awesome-gpt-image",
        preview: markdownPreview(images),
        createdAt: "",
        updatedAt: "",
      });
    }
  }
  return items;
}

async function buildAwesomeGpt4oImagePrompts() {
  const baseUrl = SOURCES["awesome-gpt4o-image-prompts"];
  const md = await fetchText(baseUrl, "README.zh-CN.md");
  const items = [];
  for (const block of splitBeforeHeading(md, "### ")) {
    const title = firstMatch(block, /^###\s+(.+)$/m).trim();
    const prompt = firstMatch(block, /- \*\*提示词文本：\*\*\s*`([\s\S]*?)`/).trim();
    if (!title || !prompt) continue;
    const images = extractMarkdownImages(baseUrl, block);
    items.push({
      id: `awesome-gpt4o-image-prompts-${leftPad(items.length + 1)}`,
      title,
      coverUrl: images[0] || "",
      prompt,
      tags: ["gpt4o"],
      category: "awesome-gpt4o-image-prompts",
      preview: markdownPreview(images),
      createdAt: "",
      updatedAt: "",
    });
  }
  return items;
}

async function buildYouMindPrompts(categoryCode, modelTag) {
  const baseUrl = SOURCES[categoryCode];
  const md = await fetchText(baseUrl, "README_zh.md");
  const items = [];
  for (const block of splitBeforeHeading(md, "### ")) {
    const title = firstMatch(block, /^###\s+No\.\s*\d+:\s*(.+)$/m).trim();
    const prompt = firstMatch(
      block,
      /#### .*?提示词\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/,
    ).trim();
    if (!title || !prompt) continue;
    const images = extractMarkdownImages(baseUrl, block);
    items.push({
      id: `${categoryCode}-${leftPad(items.length + 1)}`,
      title,
      coverUrl: images[0] || "",
      prompt,
      tags: youMindTags(title, modelTag),
      category: categoryCode,
      preview: markdownPreview(images),
      createdAt: "",
      updatedAt: "",
    });
  }
  return items;
}

async function buildDavidWuPrompts() {
  const baseUrl = SOURCES["davidwu-gpt-image2-prompts"];
  const raw = await fetchText(baseUrl, "prompts.json");
  const data = JSON.parse(raw);
  const items = [];
  for (const item of data) {
    const title = (item.title_cn || item.title_en || "").trim();
    const prompt = (item.prompt || "").trim();
    if (!title || !prompt) continue;
    const image = absoluteImage(baseUrl, item.image || "");
    items.push({
      id: `davidwu-gpt-image2-prompts-${leftPad(item.id)}`,
      title,
      coverUrl: image,
      prompt,
      tags: davidWuTags(item),
      category: "davidwu-gpt-image2-prompts",
      preview: davidWuPreview(item, image),
      createdAt: "",
      updatedAt: "",
    });
  }
  return items;
}

const BUILDERS = {
  "gpt-image-2-prompts": buildGptImage2Prompts,
  "awesome-gpt-image": buildAwesomeGptImagePrompts,
  "awesome-gpt4o-image-prompts": buildAwesomeGpt4oImagePrompts,
  "youmind-gpt-image-2": () => buildYouMindPrompts("youmind-gpt-image-2", "gpt-image-2"),
  "youmind-nano-banana-pro": () =>
    buildYouMindPrompts("youmind-nano-banana-pro", "nano-banana-pro"),
  "davidwu-gpt-image2-prompts": buildDavidWuPrompts,
};

async function main() {
  const seedRaw = await readFile(SEED_PATH, "utf8");
  const seed = JSON.parse(seedRaw);

  // Existing hand-curated prompts (any category NOT in upstream codes).
  const upstreamCodes = new Set(Object.keys(SOURCES));
  const handCuratedPrompts = (seed.prompts || []).filter(
    (p) => !upstreamCodes.has(p.category),
  );
  const handCuratedCategories = (seed.categories || []).filter(
    (c) => !upstreamCodes.has(c.category),
  );

  const codes = ONLY ? [ONLY] : Object.keys(BUILDERS);
  const remotePrompts = [];
  for (const code of codes) {
    const fn = BUILDERS[code];
    if (!fn) throw new Error(`unknown category code: ${code}`);
    process.stdout.write(`[sync-prompts] building ${code}...`);
    const start = Date.now();
    const items = await fn();
    console.log(` ${items.length} items in ${Date.now() - start}ms`);
    remotePrompts.push(...items);
  }

  // When --only is used, preserve previously synced upstream prompts for other codes.
  if (ONLY) {
    for (const p of seed.prompts || []) {
      if (p.category !== ONLY && upstreamCodes.has(p.category)) {
        remotePrompts.push(p);
      }
    }
  }

  const merged = {
    version: (seed.version || 1) + 1,
    categories: [...UPSTREAM_CATEGORIES, ...handCuratedCategories],
    // Upstream first so the first viewport shows prompts that have covers.
    prompts: [...remotePrompts, ...handCuratedPrompts],
  };

  console.log(
    `[sync-prompts] total: ${merged.prompts.length} prompts (${handCuratedPrompts.length} curated + ${remotePrompts.length} upstream) across ${merged.categories.length} categories`,
  );

  if (DRY_RUN) {
    console.log("[sync-prompts] dry-run, not writing");
    return;
  }

  await writeFile(SEED_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log(`[sync-prompts] wrote ${SEED_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
