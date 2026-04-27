import type {
  Model,
  ModelDisplayCategory,
} from "../../../../api/control-layer/types";
import { getUserFacingTariffs } from "../../../../utils/formatters";

/** UUID for the implicit "Everyone" group. */
export const EVERYONE_GROUP_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Number of months a model is considered "new" since release. Used to derive
 * the cutoff date for badge / new-section calculations.
 */
export const NEW_CUTOFF_MONTHS = 3;

/**
 * Capabilities that the catalog allows users to filter by. Order is meaningful
 * for filter UIs.
 */
export const FILTERABLE_CAPABILITIES: { key: string; label: string }[] = [
  { key: "vision", label: "Vision" },
  { key: "reasoning", label: "Reasoning" },
  { key: "enhanced_structured_generation", label: "Structured" },
];

/** Pricing context that controls which tariff window powers price aggregation. */
export type PricingContext = "async" | "batch";

/**
 * Compute the cheapest visible input price (per token) from a tariffs array.
 * When `context` is provided, restricts to tariffs matching the context:
 *   - "async" → realtime tariffs (with completion_window omitted)
 *   - "batch" → batch tariffs (any window)
 * Returns null when no matching tariff exists.
 */
export function getCheapestInputPriceValue(
  tariffs: Model["tariffs"],
  context?: PricingContext,
): number | null {
  if (!tariffs) return null;
  let visible = getUserFacingTariffs(tariffs);
  if (context === "async") {
    visible = visible.filter((t) => t.api_key_purpose !== "batch");
  } else if (context === "batch") {
    visible = visible.filter((t) => t.api_key_purpose === "batch");
  }
  if (visible.length === 0) return null;
  let cheapest = Infinity;
  for (const t of visible) {
    const price = parseFloat(t.input_price_per_token);
    if (price < cheapest) cheapest = price;
  }
  return Number.isFinite(cheapest) ? cheapest : null;
}

/**
 * Derive a stable, ordered list of display capabilities for a model. The
 * primary capability is implied by `model_type` (text / embeddings); explicit
 * capabilities (vision, reasoning, etc.) are appended.
 */
export function getDisplayCapabilities(model: Model): string[] {
  const caps: string[] = [];
  if (model.model_type === "CHAT") caps.push("text");
  else if (model.model_type === "EMBEDDINGS") caps.push("embeddings");
  if (model.capabilities) {
    for (const c of model.capabilities) {
      if (c !== "text" && c !== "embeddings" && !caps.includes(c)) {
        caps.push(c);
      }
    }
  }
  return caps;
}

/**
 * Map a model into one of the catalog's top-level tabs. Returns null when the
 * model has no recognised display category (it should be hidden in that case).
 */
export function getCatalogTabForModel(
  model: Model,
): ModelDisplayCategory | null {
  if (model.metadata?.display_category) {
    return model.metadata.display_category;
  }
  if (model.model_type === "EMBEDDINGS") return "embedding";
  if (model.model_type === "CHAT" || model.model_type === "RERANKER") {
    return "generation";
  }
  return null;
}

/**
 * Format an ISO release date as a "Mon YYYY" string. The input must be a
 * YYYY-MM-DD string (the metadata.released_at format). Invalid input is
 * returned as-is to surface the data issue to the user.
 */
export function formatReleaseDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
