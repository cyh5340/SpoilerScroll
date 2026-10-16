export interface HistoryEntry { url: string; title: string; lastVisitTime: number; }
/** `titleShared`/`textShared` are the post's title words and other visible-text words found in the history title. */
export interface HistoryMatch extends HistoryEntry { titleShared: string[]; textShared: string[]; score: number; samePost: boolean; }
export const RANGE_DAYS = [1, 7, 30] as const;
export const MIN_SHARED = [2, 3, 4, 5, 6, 8, 10] as const;
/** A word that appears only in the post's visible text counts this much; a title word counts 1. */
export const TEXT_WEIGHT = 0.5;

// Words too common to signal similar content; without them two unrelated titles match on "how to the".
// "reddit" appears in most Reddit page titles.
const STOPWORDS = new Set(`a an and or but nor so yet the is are was were be been being am to of in on at by for with from as into onto over under
about after before up down out off than then there here this that these those it its i you he she we they me my your our their his her them us
do does did done not no yes if what which who whom whose how why when where all any some more most much many very too also just now new get got
can could will would should may might must have has had one two r reddit vs via`.split(/\s+/));

/** Plain string tokens: lowercase, split on anything that is not a letter or digit, minus single letters and STOPWORDS. */
export function words(text: string): Set<string> {
  return new Set(text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2 && !STOPWORDS.has(w)));
}

/** Comparable URL: no hash/trailing slash; Reddit posts collapse to their post ID across www/old and slugs.
 * Queries are kept elsewhere because many sites identify pages by them (e.g. watch?v=). */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (/^(www\.|old\.)?reddit\.com$/.test(u.hostname)) {
      const id = u.pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1];
      if (id) return `https://www.reddit.com/comments/${id.toLowerCase()}`;
    }
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch { return null; }
}

/** History pre-split into words, with word → entries and URL → entries lookups. Build once per history read. */
export interface HistoryIndex {
  entries: { entry: HistoryEntry; key: string | null; tokens: string[] }[];
  byWord: Map<string, number[]>;
  byUrl: Map<string, number[]>;
}
export function indexHistory(history: readonly HistoryEntry[]): HistoryIndex {
  const index: HistoryIndex = { entries: [], byWord: new Map(), byUrl: new Map() };
  for (const entry of history) {
    const i = index.entries.length, key = canonicalUrl(entry.url), tokens = [...words(entry.title)];
    index.entries.push({ entry, key, tokens });
    for (const w of tokens) (index.byWord.get(w) ?? index.byWord.set(w, []).get(w)!).push(i);
    if (key) (index.byUrl.get(key) ?? index.byUrl.set(key, []).get(key)!).push(i);
  }
  return index;
}

/** History pages whose titles score at least `minShared`: each shared title word counts 1, each shared
 * visible-text word TEXT_WEIGHT. A history page with the post's own URL always matches. The page being
 * viewed (`excludeUrl`, or a history page titled exactly `excludeTitle`) is never a match, or every link on a
 * search page would match that search; search engines add parameters to the URL, so the title catches those. */
export function matchPost(post: { url: string; title: string; text?: string }, index: HistoryIndex,
  options: { minShared: number; excludeUrl?: string; excludeTitle?: string }): HistoryMatch[] {
  const title = words(post.title), postKey = canonicalUrl(post.url);
  const text = new Set([...words(post.text ?? '')].filter(w => !title.has(w)));
  const exclude = options.excludeUrl ? canonicalUrl(options.excludeUrl) : null;
  const scores = new Map<number, number>();
  for (const w of title) for (const i of index.byWord.get(w) ?? []) scores.set(i, (scores.get(i) ?? 0) + 1);
  for (const w of text) for (const i of index.byWord.get(w) ?? []) scores.set(i, (scores.get(i) ?? 0) + TEXT_WEIGHT);
  const hits = new Set([...scores].filter(([, score]) => score >= options.minShared).map(([i]) => i));
  if (postKey) for (const i of index.byUrl.get(postKey) ?? []) hits.add(i);
  const best = new Map<string, HistoryMatch>();
  for (const i of hits) {
    const { entry, key, tokens } = index.entries[i];
    if (!key || key === exclude || (options.excludeTitle && entry.title === options.excludeTitle)) continue;
    const match: HistoryMatch = { ...entry, titleShared: tokens.filter(w => title.has(w)), textShared: tokens.filter(w => text.has(w)),
      score: scores.get(i) ?? 0, samePost: key === postKey };
    const previous = best.get(key);
    if (!previous || match.score > previous.score || (match.score === previous.score && match.lastVisitTime > previous.lastVisitTime)) best.set(key, match);
  }
  return [...best.values()].sort((a, b) => Number(b.samePost) - Number(a.samePost) || b.score - a.score || b.lastVisitTime - a.lastVisitTime);
}
export function findMatches(post: { url: string; title: string; text?: string }, history: readonly HistoryEntry[],
  options: { minShared: number; excludeUrl?: string; excludeTitle?: string }): HistoryMatch[] {
  return matchPost(post, indexHistory(history), options);
}
