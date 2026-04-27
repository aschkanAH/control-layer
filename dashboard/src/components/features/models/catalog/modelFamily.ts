import type {
  Model,
  ModelDisplayCategory,
} from "../../../../api/control-layer/types";
import {
  getCatalogTabForModel,
  getCheapestInputPriceValue,
  type PricingContext,
} from "./shared";

export interface AggregatedFamily {
  /** Stable id derived from the primary variant. */
  id: string;
  /** User-facing label, typically display_name of the primary variant. */
  label: string;
  /** Lowercase provider key for icon lookup. */
  providerKey: string;
  /** Human-readable provider name. */
  providerLabel: string;
  /** Optional provider icon string (URL or initials). */
  providerIcon?: string | null;
  /** Catalog category for the family. */
  category: ModelDisplayCategory | null;
  /** Variants within the family, ordered with the primary variant first. */
  variants: Model[];
  /** Highest intelligence_index across variants (null if none have one). */
  intelligenceMax: number | null;
  /** Cheapest visible input price (per token) across variants for the active pricing context. */
  priceFrom: number | null;
  /** Largest context window across variants. */
  contextMax: number | null;
  /** Most recent released_at across variants (ISO YYYY-MM-DD). */
  releasedAt: string | null;
  /** Union of display capabilities across variants. */
  capabilities: string[];
  /** Whether the family was released after the new-cutoff date. */
  isNew: boolean;
}

export interface AggregateFamiliesOptions {
  /** ISO date (YYYY-MM-DD) below which a release is no longer considered "new". */
  newCutoff: string;
  /** Pricing context to use when computing priceFrom across variants. */
  context: PricingContext;
  /** Resolves a model to a human-readable provider label. */
  providerLabelOf: (model: Model) => string;
  /** Resolves a model to an optional provider icon. */
  providerIconOf: (model: Model) => string | null | undefined;
  /** Computes a list of display capabilities for a given variant. */
  displayCapabilitiesOf: (model: Model) => string[];
}

/**
 * Build a stable family key for a model. We prefer `display_name` (which is
 * curated to be the family-level label, with the variant suffix dropped). When
 * `display_name` is absent we fall back to a heuristic on the `model_name`
 * (strip the leading provider prefix and any trailing FP8/INT4/etc suffix).
 */
function familyKeyOf(model: Model): string {
  const display = (model.display_name ?? "").trim();
  if (display) return display.toLowerCase();

  const raw = model.model_name || model.alias;
  const slashIdx = raw.indexOf("/");
  const tail = slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw;
  const withoutQuant = tail.replace(/-(?:fp8|fp16|int4|int8|nvfp4|q\d+)$/i, "");
  return withoutQuant.toLowerCase();
}

function maxNumber(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function minNumber(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Aggregate a flat list of (composite) models into families. Each family
 * groups all variants that share a `display_name` (or, lacking one, a
 * canonicalised model_name), preserving the order in which the variants
 * arrived from the API. The primary variant is the first one in the input.
 */
export function aggregateFamilies(
  models: Model[],
  options: AggregateFamiliesOptions,
): AggregatedFamily[] {
  const {
    newCutoff,
    context,
    providerLabelOf,
    providerIconOf,
    displayCapabilitiesOf,
  } = options;

  const order: string[] = [];
  const byKey = new Map<string, AggregatedFamily>();

  for (const model of models) {
    const key = familyKeyOf(model);
    let family = byKey.get(key);

    const variantPrice = getCheapestInputPriceValue(model.tariffs, context);
    const intelligence = model.metadata?.intelligence_index ?? null;
    const ctx = model.metadata?.context_window ?? null;
    const releasedAt = model.metadata?.released_at ?? null;
    const variantCaps = displayCapabilitiesOf(model);

    if (!family) {
      const label =
        (model.display_name && model.display_name.trim()) ||
        model.alias ||
        model.model_name;
      const providerLabel = providerLabelOf(model);
      const providerIcon = providerIconOf(model) ?? null;
      const providerKey = (model.metadata?.provider?.trim() || "Other")
        .toLowerCase();

      family = {
        id: model.id,
        label,
        providerKey,
        providerLabel,
        providerIcon,
        category: getCatalogTabForModel(model),
        variants: [model],
        intelligenceMax: intelligence,
        priceFrom: variantPrice,
        contextMax: ctx,
        releasedAt,
        capabilities: [...variantCaps],
        isNew: !!(releasedAt && releasedAt >= newCutoff),
      };
      byKey.set(key, family);
      order.push(key);
      continue;
    }

    family.variants.push(model);
    family.intelligenceMax = maxNumber(family.intelligenceMax, intelligence);
    family.priceFrom = minNumber(family.priceFrom, variantPrice);
    family.contextMax = maxNumber(family.contextMax, ctx);
    family.releasedAt = maxIso(family.releasedAt, releasedAt);
    for (const cap of variantCaps) {
      if (!family.capabilities.includes(cap)) family.capabilities.push(cap);
    }
    if (releasedAt && releasedAt >= newCutoff) family.isNew = true;
  }

  return order.map((k) => byKey.get(k) as AggregatedFamily);
}

/**
 * Compute the ISO date (YYYY-MM-DD) used as the "new" cutoff, given a number
 * of months back from `now`. Pure function for testability.
 *
 * Implementation note: a naive `setMonth(getMonth() - months)` overflows
 * silently when the source day exceeds the target month's length (e.g.
 * May 31 → "Feb 31" → Mar 3, three days later than intended), pushing the
 * cutoff forward and incorrectly demoting borderline-new models. We clamp
 * the day to the last day of the target month to avoid that wrap-around.
 */
export function computeNewCutoff(now: Date, months: number): string {
  const year = now.getFullYear();
  const monthIdx = now.getMonth() - months;
  // Day 0 of (target+1) is the last day of the target month — used to clamp.
  const lastDayOfTargetMonth = new Date(year, monthIdx + 1, 0).getDate();
  const day = Math.min(now.getDate(), lastDayOfTargetMonth);
  const cutoff = new Date(year, monthIdx, day);
  const isoYear = String(cutoff.getFullYear()).padStart(4, "0");
  const isoMonth = String(cutoff.getMonth() + 1).padStart(2, "0");
  const isoDay = String(cutoff.getDate()).padStart(2, "0");
  return `${isoYear}-${isoMonth}-${isoDay}`;
}

/**
 * Build a comparator that sorts items by `getKey`, applying `dir` (1=asc,
 * -1=desc), with null/undefined keys ALWAYS sorted to the end regardless of
 * direction. Falling back to a final tiebreaker is the caller's
 * responsibility.
 */
export function nullsLast<T, K>(
  getKey: (item: T) => K | null | undefined,
  dir: 1 | -1,
  cmp: (a: K, b: K) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const av = getKey(a);
    const bv = getKey(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return cmp(av, bv) * dir;
  };
}
