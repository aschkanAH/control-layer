import { describe, expect, it } from "vitest";
import {
  defaultUrlState,
  deserializeUrlState,
  serializeUrlState,
  activeFilterCount,
  type MobileCatalogUrlState,
} from "./mobileUrlState";
import { EVERYONE_GROUP_ID } from "./shared";

function roundtrip(state: MobileCatalogUrlState): MobileCatalogUrlState {
  return deserializeUrlState(serializeUrlState(state));
}

describe("mobileUrlState", () => {
  it("round-trips the default state to an empty URL", () => {
    const state = defaultUrlState();
    const params = serializeUrlState(state);
    expect(params.toString()).toBe("");
    expect(roundtrip(state)).toEqual(state);
  });

  it("omits dir when it matches the default for the active sort", () => {
    const state: MobileCatalogUrlState = {
      ...defaultUrlState(),
      sort: "cost",
      dir: "asc",
    };
    const params = serializeUrlState(state);
    expect(params.get("sort")).toBe("cost");
    expect(params.get("dir")).toBeNull();
    expect(roundtrip(state)).toEqual(state);
  });

  it("emits dir when it diverges from the default", () => {
    const state: MobileCatalogUrlState = {
      ...defaultUrlState(),
      sort: "cost",
      dir: "desc",
    };
    const params = serializeUrlState(state);
    expect(params.get("dir")).toBe("desc");
    expect(roundtrip(state)).toEqual(state);
  });

  it("encodes repeated providers/capabilities alphabetically", () => {
    const state: MobileCatalogUrlState = {
      ...defaultUrlState(),
      providers: ["openai", "alibaba", "moonshot"],
      capabilities: ["vision", "reasoning"],
    };
    const params = serializeUrlState(state);
    expect(params.getAll("providers")).toEqual([
      "alibaba",
      "moonshot",
      "openai",
    ]);
    expect(params.getAll("capabilities")).toEqual(["reasoning", "vision"]);
    expect(roundtrip(state)).toEqual({
      ...state,
      providers: ["alibaba", "moonshot", "openai"],
      capabilities: ["reasoning", "vision"],
    });
  });

  it("treats the default Everyone group as omitted", () => {
    const state: MobileCatalogUrlState = {
      ...defaultUrlState(),
      groups: [EVERYONE_GROUP_ID],
    };
    expect(serializeUrlState(state).getAll("groups")).toEqual([]);

    const customGroups: MobileCatalogUrlState = {
      ...defaultUrlState(),
      groups: ["bb-group", "aa-group"],
    };
    const params = serializeUrlState(customGroups);
    expect(params.getAll("groups")).toEqual(["aa-group", "bb-group"]);
    expect(roundtrip(customGroups)).toEqual({
      ...customGroups,
      groups: ["aa-group", "bb-group"],
    });
  });

  it("preserves modelId when set", () => {
    const state: MobileCatalogUrlState = {
      ...defaultUrlState(),
      modelId: "abc-123",
    };
    expect(serializeUrlState(state).get("modelId")).toBe("abc-123");
    expect(roundtrip(state)).toEqual(state);
  });

  it("falls back to defaults for invalid params", () => {
    const params = new URLSearchParams("category=bogus&sort=garbage&dir=sideways");
    const state = deserializeUrlState(params);
    expect(state.category).toBe("all");
    expect(state.sort).toBe("intelligence");
    expect(state.dir).toBe("desc");
  });

  it("counts active filters", () => {
    expect(activeFilterCount(defaultUrlState())).toBe(0);
    expect(
      activeFilterCount({ ...defaultUrlState(), providers: ["x"] }),
    ).toBe(1);
    expect(
      activeFilterCount({
        ...defaultUrlState(),
        providers: ["x"],
        capabilities: ["vision"],
        groups: ["custom"],
      }),
    ).toBe(3);
  });
});
