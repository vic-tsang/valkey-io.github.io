// Optional post-build pass for hosting the site somewhere that isn't the domain root (for example a prototype
// host that serves each upload under its own path). Not part of the production deploy, which is served from
// https://valkey.io/.
//
// Zola output links to root-absolute paths (`/css/styles.css`) and to absolute `https://valkey.io/...` URLs
// (from get_url and base_url). Both ignore the directory the site is mounted in. This rewrites them, in every
// HTML and CSS file under the output directory, to paths relative to that file, with the right number of "../".
//
// Usage, after `zola build` (and after `pagefind`, so the index is built from the original pages):
//   node build/relativize-public-paths.mjs [public]
//
// Idempotent: it only touches values that start with a single "/" or with the site's base URL.
// Left alone: <link rel="canonical"> and <link rel="alternate"> (they should stay absolute), and feeds.
//
// Known limitation: Pagefind stores each result's URL as a root-absolute path, so result links from the search
// box still point at the domain root.

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? "public");
const BASE_URL = "https://valkey.io";

async function* walk(dir, extensions) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, extensions);
    else if (extensions.some((ext) => entry.name.endsWith(ext))) yield full;
  }
}

function prefixFor(file) {
  const depth = path.relative(ROOT, file).split(path.sep).length - 1;
  return "../".repeat(depth);
}

// Returns the root-absolute form of value ("/blog/"), or null if it points somewhere else.
function asRootPath(value) {
  if (value === BASE_URL) return "/";
  if (value.startsWith(`${BASE_URL}/`)) return value.slice(BASE_URL.length);
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return null;
}

// Directory-style targets get an explicit index.html: static hosts don't all serve index.html for directories.
function relativize(value, prefix) {
  const rootPath = asRootPath(value);
  if (rootPath === null) return null;
  const [, pathPart, tail] = rootPath.slice(1).match(/^([^?#]*)(.*)$/);
  const target = pathPart === "" || pathPart.endsWith("/") ? `${pathPart}index.html` : pathPart;
  return prefix + target + tail;
}

function rewriteTag(tag, prefix, count) {
  if (/\brel="(?:canonical|alternate)"/.test(tag)) return tag;
  tag = tag.replace(/\b((?:href|src)=")([^"]*)(")/g, (m, open, value, close) => {
    const next = relativize(value, prefix);
    if (next === null) return m;
    count.n++;
    return open + next + close;
  });
  return tag.replace(/\b(srcset=")([^"]*)(")/g, (m, open, value, close) => {
    const parts = value.split(",").map((entry) => {
      const [url, ...descriptor] = entry.trim().split(/\s+/);
      const next = relativize(url, prefix);
      if (next === null) return entry.trim();
      count.n++;
      return [next, ...descriptor].join(" ");
    });
    return open + parts.join(", ") + close;
  });
}

function rewriteCssUrls(content, prefix, count) {
  return content.replace(/url\(\s*(['"]?)(\/[^)'"]*)\1\s*\)/g, (m, quote, value) => {
    const next = relativize(value, prefix);
    if (next === null) return m;
    count.n++;
    return `url(${quote}${next}${quote})`;
  });
}

// pagefind-merge.js imports the index from a root-absolute path. Resolve it against the script's own URL instead.
function rewriteMergeScript(content, count) {
  const patched = content
    .replace('import("/pagefind/pagefind.js")', 'import(new URL("pagefind/pagefind.js", import.meta.url).href)')
    .replace('readIndex("/pagefind/")', 'readIndex(new URL("pagefind/", import.meta.url).href)');
  if (patched !== content) count.n++;
  return patched;
}

const count = { n: 0 };
let files = 0;

async function update(file, transform) {
  const before = await fs.readFile(file, "utf8");
  const start = count.n;
  const after = transform(before);
  if (count.n > start && after !== before) {
    await fs.writeFile(file, after);
    files++;
  }
}

for await (const file of walk(ROOT, [".html"])) {
  const prefix = prefixFor(file);
  await update(file, (content) => {
    content = content.replace(/<[a-zA-Z][^>]*>/g, (tag) => rewriteTag(tag, prefix, count));
    // Inline style blocks and style attributes.
    return rewriteCssUrls(content, prefix, count);
  });
}

for await (const file of walk(ROOT, [".css"])) {
  const prefix = prefixFor(file);
  await update(file, (content) => rewriteCssUrls(content, prefix, count));
}

const mergeScript = path.join(ROOT, "pagefind-merge.js");
try {
  await update(mergeScript, (content) => rewriteMergeScript(content, count));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

console.log(`[relativize-public-paths] rewrote ${count.n} path(s) across ${files} file(s) in ${ROOT}`);
