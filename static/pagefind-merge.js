// Cross-site search: merges the GLIDE and Valkey Admin Pagefind indexes into this site's search.
//
// Why not PagefindUI's `mergeIndex` option: Pagefind then stops the whole search box (this site's results
// too) if any merged index is missing, unreachable, or built with an incompatible Pagefind version (Pagefind issue #887).
// Instead, this script reads each other site's index first, and merges it only if it is readable and was built with
// the same major.minor Pagefind version as this site's index.
//
// It merges into the pagefind.js module that the search box itself imports (/pagefind/pagefind.js), so the search box
// searches the merged indexes. valkey.io, GLIDE and Valkey Admin use the same script with different settings.
const otherSites = ["https://glide.valkey.io/pagefind/", "https://valkey-admin.valkey.io/pagefind/"];
const searchBox = "#site-search";
// Starlight's default ranking. GLIDE and Valkey Admin apply it to their own index and valkey.io sets it too,
// so a query ranks the same on all three sites.
const ranking = { pageLength: 0.1, termFrequency: 0.1, termSaturation: 2, termSimilarity: 9 };
// The search box sets a 12-word excerpt on this site's index only; merged indexes would default to 30.
const excerptLength = 12;
// Every search waits for every merged index, so a site that answers much more slowly than this one would slow down
// every search. Such a site is left out for this page view. A slow network slows both, so they still merge.
const slowSiteFactor = 3;
const slowSiteAllowanceMs = 2000;
// Stop waiting for a site that doesn't answer at all.
const giveUpAfterMs = 30000;

// Reads an index's entry file and the metadata file the entry names. Returns the major.minor Pagefind version
// (null if either read fails) and how long the reads took. Reading the metadata file catches an entry that names
// files a newer deploy has removed, and leaves the file in the HTTP cache for Pagefind.
async function readIndex(bundlePath) {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  try {
    const signal = AbortSignal.timeout(giveUpAfterMs);
    const response = await fetch(bundlePath + "pagefind-entry.json", { signal });
    if (!response.ok) return { version: null, ms: elapsed() };
    const entry = await response.json();
    const languages = entry.languages || {};
    const language = languages[document.documentElement.lang] || Object.values(languages)[0];
    if (!entry.version || !language) return { version: null, ms: elapsed() };
    const meta = await fetch(`${bundlePath}pagefind.${language.hash}.pf_meta`, { signal });
    if (!meta.ok) return { version: null, ms: elapsed() };
    return { version: entry.version.split(".").slice(0, 2).join("."), ms: elapsed() };
  } catch {
    return { version: null, ms: elapsed() };
  }
}

// A site merged after the visitor has typed a query: run the query again so that site's results appear.
// The search box only searches when the text changes, so the text is changed and changed back.
function searchAgain() {
  const input = document.querySelector(`${searchBox} input`);
  if (!input || !input.value) return;
  const query = input.value;
  input.value = query + " ";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mergeOtherSites() {
  const thisSite = Promise.all([import("/pagefind/pagefind.js"), readIndex("/pagefind/")]);
  await Promise.all(
    otherSites.map(async (bundlePath) => {
      const [other, [pagefind, own]] = await Promise.all([readIndex(bundlePath), thisSite]);
      const compatible = own.version !== null && other.version === own.version;
      const tooSlow = other.ms > own.ms * slowSiteFactor + slowSiteAllowanceMs;
      if (!compatible) {
        console.warn(`Search: not merging ${bundlePath} (index version ${other.version}, this site ${own.version})`);
        return;
      }
      if (tooSlow) {
        console.warn(`Search: not merging ${bundlePath} (answered in ${Math.round(other.ms)} ms, this site in ${Math.round(own.ms)} ms)`);
        return;
      }
      await pagefind.mergeIndex(bundlePath, { ranking, excerptLength });
      searchAgain();
    }),
  );
}

// Start when the visitor first focuses or types into the search box; the search box loads Pagefind then too.
let merging = null;
function startMerging(event) {
  if (merging || !event.target.closest?.(searchBox)) return;
  merging = mergeOtherSites();
}
document.addEventListener("focusin", startMerging, true);
document.addEventListener("input", startMerging, true);
