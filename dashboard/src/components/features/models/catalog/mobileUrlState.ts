import { EVERYONE_GROUP_ID } from "./shared";

/** Top-level catalog category. `all` is encoded by omitting the param. */
export type CatalogCategory = "all" | "generation" | "embedding" | "ocr";

/** Sort field exposed via the mobile UI. Composite-aware. */
export type MobileSortField =
  | "intelligence"
  | "cost"
  | "context"
  | "released_at"
  | "alias";

export type SortDirection = "asc" | "desc";

/**
 * Default sort direction per field. The URL serialiser emits `dir` only when
 * it differs from the default, so the absence of `dir` implies the default.
 */
export const DEFAULT_SORT_DIRECTIONS: Record<MobileSortField, SortDirection> = {
  intelligence: "desc",
  released_at: "desc",
  context: "desc",
  cost: "asc",
  alias: "asc",
};

export interface MobileCatalogUrlState {
  search: string;
  category: CatalogCategory;
  providers: string[];
  capabilities: string[];
  groups: string[];
  sort: MobileSortField;
  dir: SortDirection;
  modelId: string | null;
}

/**
 * Empty / default URL state. Used by the empty-state "Clear all filters"
 * action to produce a canonical reset URL (preserves nothing).
 */
export function defaultUrlState(): MobileCatalogUrlState {
  return {
    search: "",
    category: "all",
    providers: [],
    capabilities: [],
    groups: [EVERYONE_GROUP_ID],
    sort: "intelligence",
    dir: DEFAULT_SORT_DIRECTIONS.intelligence,
    modelId: null,
  };
}

const VALID_CATEGORIES: ReadonlySet<CatalogCategory> = new Set([
  "all",
  "generation",
  "embedding",
  "ocr",
]);

const VALID_SORTS: ReadonlySet<MobileSortField> = new Set([
  "intelligence",
  "cost",
  "context",
  "released_at",
  "alias",
]);

/**
 * Decode URLSearchParams into a typed mobile catalog state. Unknown / invalid
 * values fall back to defaults so a hand-crafted URL never crashes the UI.
 */
export function deserializeUrlState(
  params: URLSearchParams,
): MobileCatalogUrlState {
  const rawCategory = params.get("category");
  const category: CatalogCategory =
    rawCategory && VALID_CATEGORIES.has(rawCategory as CatalogCategory)
      ? (rawCategory as CatalogCategory)
      : "all";

  const rawSort = params.get("sort");
  const sort: MobileSortField =
    rawSort && VALID_SORTS.has(rawSort as MobileSortField)
      ? (rawSort as MobileSortField)
      : "intelligence";

  const rawDir = params.get("dir");
  const dir: SortDirection =
    rawDir === "asc" || rawDir === "desc"
      ? (rawDir as SortDirection)
      : DEFAULT_SORT_DIRECTIONS[sort];

  const providers = [...params.getAll("providers")].sort();
  const capabilities = [...params.getAll("capabilities")].sort();
  const groupsRaw = params.getAll("groups");
  const groups =
    groupsRaw.length === 0 ? [EVERYONE_GROUP_ID] : [...groupsRaw].sort();

  return {
    search: params.get("search") ?? "",
    category,
    providers,
    capabilities,
    groups,
    sort,
    dir,
    modelId: params.get("modelId"),
  };
}

/**
 * Encode a mobile catalog state into URLSearchParams using stable key order
 * and alphabetical repeated-param order. Defaults are omitted to keep URLs
 * short and to make `serialize(deserialize(x))` idempotent.
 */
export function serializeUrlState(
  state: MobileCatalogUrlState,
): URLSearchParams {
  const params = new URLSearchParams();

  if (state.search) params.set("search", state.search);
  if (state.category !== "all") params.set("category", state.category);

  for (const p of [...state.providers].sort()) params.append("providers", p);
  for (const c of [...state.capabilities].sort()) {
    params.append("capabilities", c);
  }

  const groupsAreDefault =
    state.groups.length === 1 && state.groups[0] === EVERYONE_GROUP_ID;
  if (!groupsAreDefault) {
    for (const g of [...state.groups].sort()) params.append("groups", g);
  }

  if (state.sort !== "intelligence") params.set("sort", state.sort);
  if (state.dir !== DEFAULT_SORT_DIRECTIONS[state.sort]) {
    params.set("dir", state.dir);
  }

  if (state.modelId) params.set("modelId", state.modelId);

  return params;
}

/**
 * Compose the count of "real" filters (providers/capabilities/groups) that
 * differ from the default. Used to badge the filter button.
 */
export function activeFilterCount(state: MobileCatalogUrlState): number {
  let count = 0;
  if (state.providers.length > 0) count += 1;
  if (state.capabilities.length > 0) count += 1;
  const groupsAreDefault =
    state.groups.length === 1 && state.groups[0] === EVERYONE_GROUP_ID;
  if (!groupsAreDefault) count += 1;
  return count;
}
