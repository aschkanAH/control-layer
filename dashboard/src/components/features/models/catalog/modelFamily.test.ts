import { describe, expect, it } from "vitest";
import type { Model } from "../../../../api/control-layer/types";
import {
  aggregateFamilies,
  computeNewCutoff,
  nullsLast,
  type AggregatedFamily,
} from "./modelFamily";
import { getDisplayCapabilities } from "./shared";

function build(model: Partial<Model> & { id: string }): Model {
  return {
    alias: model.alias ?? model.id,
    model_name: model.model_name ?? model.alias ?? model.id,
    model_type: "CHAT",
    is_composite: true,
    metadata: null,
    ...model,
  } as Model;
}

const baseOpts = {
  newCutoff: "2025-12-31",
  context: "async" as const,
  providerLabelOf: (m: Model) => m.metadata?.provider ?? "Other",
  providerIconOf: (m: Model) => m.metadata?.provider?.toLowerCase() ?? null,
  displayCapabilitiesOf: getDisplayCapabilities,
};

describe("aggregateFamilies", () => {
  it("groups variants sharing display_name into a single family", () => {
    const families = aggregateFamilies(
      [
        build({
          id: "a",
          display_name: "Qwen 3.5 397B",
          metadata: {
            intelligence_index: 45,
            context_window: 262144,
            released_at: "2026-02-16",
            provider: "Alibaba",
          },
        }),
        build({
          id: "b",
          display_name: "Qwen 3.5 397B",
          metadata: {
            intelligence_index: 47,
            context_window: 131072,
            released_at: "2026-02-20",
            provider: "Alibaba",
          },
        }),
      ],
      baseOpts,
    );
    expect(families).toHaveLength(1);
    const fam = families[0];
    expect(fam.label).toBe("Qwen 3.5 397B");
    expect(fam.variants.map((v) => v.id)).toEqual(["a", "b"]);
    expect(fam.intelligenceMax).toBe(47);
    expect(fam.contextMax).toBe(262144);
    expect(fam.releasedAt).toBe("2026-02-20");
    expect(fam.isNew).toBe(true);
  });

  it("falls back to canonicalised model_name when display_name is missing", () => {
    const families = aggregateFamilies(
      [
        build({
          id: "a",
          model_name: "Qwen/Qwen3-VL-30B-A3B-Instruct-FP8",
          alias: "Qwen/Qwen3-VL-30B-A3B-Instruct-FP8",
        }),
        build({
          id: "b",
          model_name: "Qwen/Qwen3-VL-30B-A3B-Instruct-FP16",
          alias: "Qwen/Qwen3-VL-30B-A3B-Instruct-FP16",
        }),
      ],
      baseOpts,
    );
    expect(families).toHaveLength(1);
    expect(families[0].variants).toHaveLength(2);
  });

  it("preserves input order and selects the first variant as primary", () => {
    const families = aggregateFamilies(
      [
        build({ id: "first", display_name: "GLM 5.1" }),
        build({ id: "other", display_name: "Kimi K2.6" }),
        build({ id: "second", display_name: "GLM 5.1" }),
      ],
      baseOpts,
    );
    expect(families.map((f) => f.id)).toEqual(["first", "other"]);
    expect(families[0].variants.map((v) => v.id)).toEqual(["first", "second"]);
  });
});

describe("computeNewCutoff", () => {
  it("subtracts the requested number of months", () => {
    expect(computeNewCutoff(new Date(2026, 3, 15), 3)).toBe("2026-01-15");
  });

  it("clamps to the last day of the target month when the source day overflows", () => {
    // May has 31 days, February doesn't. Naive setMonth(getMonth() - 3) on
    // May 31 produces "Feb 31" → JS normalises to early March, pushing the
    // cutoff days forward. The clamped impl must stay in February.
    expect(computeNewCutoff(new Date(2026, 4, 31), 3)).toBe("2026-02-28");
    // Leap year: target Feb has 29 days.
    expect(computeNewCutoff(new Date(2024, 4, 31), 3)).toBe("2024-02-29");
    // March 31 → Nov 30 of previous year (Nov has 30 days).
    expect(computeNewCutoff(new Date(2026, 2, 31), 4)).toBe("2025-11-30");
  });

  it("crosses year boundaries correctly", () => {
    expect(computeNewCutoff(new Date(2026, 0, 15), 3)).toBe("2025-10-15");
  });
});

describe("nullsLast", () => {
  type Item = { v: number | null };
  const cmp = (a: number, b: number) => a - b;

  it("sorts non-null values ascending when dir=1", () => {
    const items: Item[] = [{ v: 3 }, { v: 1 }, { v: 2 }];
    items.sort(nullsLast<Item, number>((i) => i.v, 1, cmp));
    expect(items.map((i) => i.v)).toEqual([1, 2, 3]);
  });

  it("sorts non-null values descending when dir=-1", () => {
    const items: Item[] = [{ v: 1 }, { v: 3 }, { v: 2 }];
    items.sort(nullsLast<Item, number>((i) => i.v, -1, cmp));
    expect(items.map((i) => i.v)).toEqual([3, 2, 1]);
  });

  it("keeps null/undefined values at the end regardless of direction", () => {
    const ascending: Item[] = [
      { v: 2 },
      { v: null },
      { v: 1 },
      { v: null },
    ];
    ascending.sort(nullsLast<Item, number>((i) => i.v, 1, cmp));
    expect(ascending.map((i) => i.v)).toEqual([1, 2, null, null]);

    const descending: Item[] = [
      { v: 2 },
      { v: null },
      { v: 1 },
      { v: null },
    ];
    descending.sort(nullsLast<Item, number>((i) => i.v, -1, cmp));
    expect(descending.map((i) => i.v)).toEqual([2, 1, null, null]);
  });
});

describe("AggregatedFamily shape", () => {
  it("retains all expected fields", () => {
    const families = aggregateFamilies(
      [
        build({
          id: "a",
          display_name: "Test",
          capabilities: ["vision"],
          metadata: { provider: "Acme" },
        }),
      ],
      baseOpts,
    );
    const fam: AggregatedFamily = families[0];
    expect(fam.providerLabel).toBe("Acme");
    expect(fam.capabilities).toContain("vision");
  });
});
