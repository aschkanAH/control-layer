import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Menu,
  Search,
  SlidersHorizontal,
  ExternalLink,
  Code,
  MessageSquare,
  Eye,
  Brain,
  Layers,
  Braces,
  Copy,
  Check,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { useModels, useGroups, useProviderDisplayConfigs } from "@/api/control-layer";
import type { Model } from "@/api/control-layer/types";
import {
  useConfig,
  useUser,
  useUserBalance,
} from "@/api/control-layer/hooks";
import { useSidebar } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Markdown } from "@/components/ui/markdown";
import { ApiExamples } from "@/components/modals";
import {
  formatContextLength,
  formatTariffPrice,
} from "@/utils/formatters";
import { formatDollars } from "@/utils/money";
import { copyToClipboard } from "@/utils/clipboard";
import { useAuthorization } from "@/utils";
import { isPlaygroundDenied } from "@/utils/modelAccess";
import {
  EVERYONE_GROUP_ID,
  FILTERABLE_CAPABILITIES,
  NEW_CUTOFF_MONTHS,
  formatReleaseDate,
  getCheapestInputPriceValue,
  getDisplayCapabilities,
} from "./shared";
import {
  aggregateFamilies,
  computeNewCutoff,
  nullsLast,
  type AggregatedFamily,
} from "./modelFamily";
import {
  DEFAULT_SORT_DIRECTIONS,
  activeFilterCount,
  defaultUrlState,
  deserializeUrlState,
  serializeUrlState,
  type CatalogCategory,
  type MobileCatalogUrlState,
  type MobileSortField,
  type SortDirection,
} from "./mobileUrlState";

const PRICING_CONTEXT_KEY = "catalog-pricing-context";
type PricingContext = "async" | "batch";

const CATEGORY_TABS: { value: CatalogCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "generation", label: "Generative" },
  { value: "embedding", label: "Embedding" },
  { value: "ocr", label: "OCR" },
];

const CAPABILITY_ICON: Record<string, React.FC<{ className?: string }>> = {
  text: MessageSquare,
  vision: Eye,
  reasoning: Brain,
  embeddings: Layers,
  enhanced_structured_generation: Braces,
  code: Code,
};

const SORT_OPTIONS: { value: MobileSortField; label: string }[] = [
  { value: "intelligence", label: "Intelligence" },
  { value: "cost", label: "Cost" },
  { value: "context", label: "Context window" },
  { value: "released_at", label: "Release date" },
  { value: "alias", label: "Name" },
];

function loadPricingContext(): PricingContext {
  try {
    const stored = localStorage.getItem(PRICING_CONTEXT_KEY);
    if (stored === "batch" || stored === "async") return stored;
  } catch {
    // ignore (e.g. SSR or disabled storage)
  }
  return "async";
}

function CapabilityRow({ caps }: { caps: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {caps.map((cap) => {
        const Icon = CAPABILITY_ICON[cap];
        if (!Icon) return null;
        return (
          <Icon
            key={cap}
            aria-label={cap}
            className="w-3.5 h-3.5 text-doubleword-neutral-400"
          />
        );
      })}
    </div>
  );
}

interface FamilyCardProps {
  family: AggregatedFamily;
  onOpen: (modelId: string) => void;
  pricingContext: PricingContext;
}

function FamilyCard({ family, onOpen, pricingContext }: FamilyCardProps) {
  const navigate = useNavigate();
  const primary = family.variants[0];
  const playgroundAvailable = !isPlaygroundDenied(primary);
  const priceFrom =
    family.priceFrom ??
    getCheapestInputPriceValue(primary.tariffs, pricingContext);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(primary.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(primary.id);
        }
      }}
      className="cursor-pointer p-4 gap-3 transition-colors hover:bg-doubleword-neutral-50 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold text-doubleword-neutral-900 text-base truncate">
              {family.label}
            </h3>
            {family.isNew && (
              <Badge className="bg-blue-100 text-blue-800 border-transparent text-[10px] uppercase tracking-wide">
                New
              </Badge>
            )}
            {primary.metadata?.quantization && (
              <Badge
                variant="secondary"
                className="text-[10px] uppercase tracking-wide"
              >
                {primary.metadata.quantization}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-medium">
            {family.providerLabel}
          </div>
        </div>
        <CapabilityRow caps={family.capabilities} />
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl border bg-doubleword-neutral-50 px-3 py-2.5 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Intel
          </div>
          <div className="text-sm font-semibold text-doubleword-neutral-900 tabular-nums">
            {family.intelligenceMax ?? "—"}
          </div>
        </div>
        <div className="border-x">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Cost
          </div>
          <div className="text-sm font-semibold text-doubleword-neutral-900 tabular-nums">
            {priceFrom != null ? (
              <>
                {formatTariffPrice(priceFrom)}
                <span className="text-muted-foreground text-xs font-normal">
                  {" "}/M
                </span>
              </>
            ) : (
              "——"
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Context
          </div>
          <div className="text-sm font-semibold text-doubleword-neutral-900 tabular-nums">
            {family.contextMax != null
              ? formatContextLength(family.contextMax)
              : "—"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="API examples"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-doubleword-neutral-900 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(primary.id);
          }}
        >
          <Code className="h-3.5 w-3.5" /> API Docs
        </button>
        <Button
          size="sm"
          variant="outline"
          disabled={!playgroundAvailable}
          onClick={(e) => {
            e.stopPropagation();
            if (!playgroundAvailable) return;
            navigate(`/playground?model=${encodeURIComponent(primary.id)}`);
          }}
        >
          Try it →
        </Button>
      </div>
    </Card>
  );
}

interface FilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: MobileCatalogUrlState;
  setState: (
    update: (prev: MobileCatalogUrlState) => MobileCatalogUrlState,
  ) => void;
  providerOptions: { key: string; label: string }[];
  groupOptions: { id: string; name: string }[];
  canManageGroups: boolean;
  visibleCount: number;
}

function FilterDrawer({
  open,
  onOpenChange,
  state,
  setState,
  providerOptions,
  groupOptions,
  canManageGroups,
  visibleCount,
}: FilterDrawerProps) {
  const toggleProvider = (key: string) =>
    setState((prev) => ({
      ...prev,
      providers: prev.providers.includes(key)
        ? prev.providers.filter((p) => p !== key)
        : [...prev.providers, key].sort(),
    }));

  const toggleCapability = (key: string) =>
    setState((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(key)
        ? prev.capabilities.filter((c) => c !== key)
        : [...prev.capabilities, key].sort(),
    }));

  const toggleGroup = (id: string) =>
    setState((prev) => {
      const isSelected = prev.groups.includes(id);
      const next = isSelected
        ? prev.groups.filter((g) => g !== id)
        : [...prev.groups.filter((g) => g !== EVERYONE_GROUP_ID), id].sort();
      return {
        ...prev,
        groups: next.length === 0 ? [EVERYONE_GROUP_ID] : next,
      };
    });

  const setSort = (sort: MobileSortField) =>
    setState((prev) => ({
      ...prev,
      sort,
      dir:
        prev.sort === sort ? prev.dir : DEFAULT_SORT_DIRECTIONS[sort],
    }));

  const setDir = (dir: SortDirection) =>
    setState((prev) => ({ ...prev, dir }));

  const reset = () =>
    setState((prev) => ({
      ...defaultUrlState(),
      // Keep search and modelId in URL across reset to be predictable
      search: prev.search,
      modelId: prev.modelId,
    }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[90vh] rounded-t-3xl p-0 flex flex-col"
      >
        <SheetHeader className="border-b px-5 py-4 flex flex-row items-center justify-between">
          <SheetTitle>Sort &amp; Filter</SheetTitle>
          <button
            type="button"
            onClick={reset}
            className="text-sm font-medium text-muted-foreground hover:text-doubleword-neutral-900"
          >
            Reset
          </button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <section aria-labelledby="filter-sort-heading">
            <h3
              id="filter-sort-heading"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
            >
              Sort by
            </h3>
            <Select
              value={state.sort}
              onValueChange={(v) => setSort(v as MobileSortField)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-3 flex bg-doubleword-neutral-100 p-1 rounded-md">
              <button
                type="button"
                onClick={() => setDir("desc")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded text-sm font-medium transition-colors ${
                  state.dir === "desc"
                    ? "bg-background shadow-sm text-doubleword-neutral-900"
                    : "text-muted-foreground"
                }`}
              >
                <ArrowDown className="h-3.5 w-3.5" /> Highest first
              </button>
              <button
                type="button"
                onClick={() => setDir("asc")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded text-sm font-medium transition-colors ${
                  state.dir === "asc"
                    ? "bg-background shadow-sm text-doubleword-neutral-900"
                    : "text-muted-foreground"
                }`}
              >
                <ArrowUp className="h-3.5 w-3.5" /> Lowest first
              </button>
            </div>
          </section>

          <hr className="border-doubleword-neutral-100" />

          <section aria-labelledby="filter-providers-heading">
            <h3
              id="filter-providers-heading"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
            >
              Providers
            </h3>
            <div className="flex flex-wrap gap-2">
              {providerOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No providers available
                </p>
              ) : (
                providerOptions.map((p) => {
                  const active = state.providers.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => toggleProvider(p.key)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-doubleword-neutral-900 border-doubleword-neutral-900 text-white"
                          : "bg-background hover:bg-doubleword-neutral-50"
                      }`}
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                      {p.label}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <hr className="border-doubleword-neutral-100" />

          <section aria-labelledby="filter-capabilities-heading">
            <h3
              id="filter-capabilities-heading"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
            >
              Capabilities (has all)
            </h3>
            <div className="flex flex-wrap gap-2">
              {FILTERABLE_CAPABILITIES.map((c) => {
                const active = state.capabilities.includes(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleCapability(c.key)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-doubleword-neutral-900 border-doubleword-neutral-900 text-white"
                        : "bg-background hover:bg-doubleword-neutral-50"
                    }`}
                  >
                    {active && <Check className="h-3.5 w-3.5" />}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </section>

          {canManageGroups && groupOptions.length > 0 && (
            <>
              <hr className="border-doubleword-neutral-100" />
              <section aria-labelledby="filter-groups-heading">
                <h3
                  id="filter-groups-heading"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
                >
                  Groups
                </h3>
                <div className="flex flex-wrap gap-2">
                  {groupOptions.map((g) => {
                    const active = state.groups.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => toggleGroup(g.id)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-doubleword-neutral-900 border-doubleword-neutral-900 text-white"
                            : "bg-background hover:bg-doubleword-neutral-50"
                        }`}
                      >
                        {active && <Check className="h-3.5 w-3.5" />}
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="border-t px-5 py-4">
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Show {visibleCount} {visibleCount === 1 ? "model" : "models"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface DetailDrawerProps {
  family: AggregatedFamily | null;
  activeVariantId: string | null;
  onVariantChange: (id: string) => void;
  onClose: () => void;
  pricingContext: PricingContext;
}

const CAPABILITY_LABEL: Record<string, string> = {
  text: "Chat",
  vision: "Vision",
  reasoning: "Reasoning",
  embeddings: "Embeddings",
  enhanced_structured_generation: "Structured",
  code: "Code",
};

function DetailDrawer({
  family,
  activeVariantId,
  onVariantChange,
  onClose,
  pricingContext,
}: DetailDrawerProps) {
  const navigate = useNavigate();
  const [aliasCopied, setAliasCopied] = useState(false);
  const [showApiExamples, setShowApiExamples] = useState(false);

  const activeVariant = useMemo<Model | null>(() => {
    if (!family) return null;
    return (
      family.variants.find((v) => v.id === activeVariantId) ??
      family.variants[0]
    );
  }, [family, activeVariantId]);

  if (!family || !activeVariant) {
    return (
      <Sheet open={false} onOpenChange={onClose}>
        <SheetContent side="bottom" />
      </Sheet>
    );
  }

  const playgroundAvailable = !isPlaygroundDenied(activeVariant);
  const cheapest = getCheapestInputPriceValue(
    activeVariant.tariffs,
    pricingContext,
  );

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          className="h-[90vh] rounded-t-3xl p-0 flex flex-col"
        >
          <SheetHeader className="px-5 py-4 border-b">
            <SheetTitle className="text-xl">{family.label}</SheetTitle>
            <p className="text-sm text-muted-foreground">
              {family.providerLabel}
            </p>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {family.variants.length > 1 && (
              <Select
                value={activeVariant.id}
                onValueChange={onVariantChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {family.variants.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      <span className="font-mono text-xs">{v.alias}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="flex items-start gap-2">
              <code className="flex-1 font-mono text-xs bg-doubleword-neutral-100 rounded-md px-2 py-1.5 break-all">
                {activeVariant.alias}
              </code>
              <button
                type="button"
                aria-label="Copy alias"
                onClick={async () => {
                  if (await copyToClipboard(activeVariant.alias)) {
                    setAliasCopied(true);
                    setTimeout(() => setAliasCopied(false), 1500);
                  }
                }}
                className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md border bg-background hover:bg-doubleword-neutral-50"
              >
                {aliasCopied ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-y-4 gap-x-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Intelligence
                </div>
                <div className="text-base font-medium tabular-nums">
                  {activeVariant.metadata?.intelligence_index ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Context window
                </div>
                <div className="text-base font-medium tabular-nums">
                  {activeVariant.metadata?.context_window
                    ? formatContextLength(activeVariant.metadata.context_window)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Released
                </div>
                <div className="text-base font-medium">
                  {activeVariant.metadata?.released_at
                    ? formatReleaseDate(activeVariant.metadata.released_at)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Cost ({pricingContext})
                </div>
                <div className="text-base font-medium tabular-nums">
                  {cheapest != null ? `${formatTariffPrice(cheapest)}/M` : "—"}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Capabilities
              </div>
              <div className="flex flex-wrap gap-2">
                {getDisplayCapabilities(activeVariant).map((cap) => {
                  const Icon = CAPABILITY_ICON[cap];
                  return (
                    <span
                      key={cap}
                      className="inline-flex items-center gap-1.5 rounded-md bg-doubleword-neutral-100 px-2.5 py-1 text-xs font-medium"
                    >
                      {Icon && <Icon className="h-3.5 w-3.5" />}
                      {CAPABILITY_LABEL[cap] ?? cap}
                    </span>
                  );
                })}
              </div>
            </div>

            {activeVariant.description && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  Description
                </div>
                <Markdown className="text-sm text-doubleword-neutral-700">
                  {activeVariant.description}
                </Markdown>
              </div>
            )}
          </div>

          <div className="border-t px-5 py-4 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowApiExamples(true)}
            >
              <Code className="h-4 w-4 mr-1" />
              API Examples
            </Button>
            <Button
              className="flex-1"
              disabled={!playgroundAvailable}
              onClick={() => {
                if (!playgroundAvailable) return;
                navigate(
                  `/playground?model=${encodeURIComponent(activeVariant.id)}`,
                );
              }}
            >
              Try it →
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <ApiExamples
        isOpen={showApiExamples}
        onClose={() => setShowApiExamples(false)}
        model={activeVariant}
      />
    </>
  );
}

function MobileLoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}

export const MobileModelCatalog: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useMemo(
    () => deserializeUrlState(searchParams),
    [searchParams],
  );

  const { hasPermission } = useAuthorization();
  const canManageGroups = hasPermission("manage-groups");
  const sidebar = useSidebar();
  const { data: currentUser } = useUser("current");
  const { data: balance, isLoading: balanceLoading } = useUserBalance(
    currentUser?.id ?? "",
  );
  const { data: config } = useConfig();
  const billingEnabled = !!config?.payment_enabled;

  // Local state for the search box (debounced into URL)
  const [searchInput, setSearchInput] = useState(urlState.search);
  useEffect(() => {
    // Sync local input when the URL was changed externally (e.g. back button).
    setSearchInput(urlState.search);
  }, [urlState.search]);

  const [debouncedSearch, setDebouncedSearch] = useState(urlState.search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Persist the debounced search into the URL with replace semantics.
  const updateUrl = useCallback(
    (
      updater: (prev: MobileCatalogUrlState) => MobileCatalogUrlState,
      options: { mode: "replace" | "push" } = { mode: "replace" },
    ) => {
      // Read latest from current params instead of `urlState` to avoid stale
      // state when batching updates.
      const current = deserializeUrlState(
        new URLSearchParams(window.location.search),
      );
      const next = updater(current);
      const params = serializeUrlState(next);
      setSearchParams(params, { replace: options.mode === "replace" });
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (debouncedSearch === urlState.search) return;
    updateUrl((prev) => ({ ...prev, search: debouncedSearch }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const [pricingContext, setPricingContextState] = useState<PricingContext>(
    () => loadPricingContext(),
  );
  const setPricingContext = (next: PricingContext) => {
    setPricingContextState(next);
    try {
      localStorage.setItem(PRICING_CONTEXT_KEY, next);
    } catch {
      // ignore
    }
  };

  const [filterOpen, setFilterOpen] = useState(false);

  // ----- API queries -----
  const groupFilter =
    canManageGroups &&
    !(urlState.groups.length === 1 && urlState.groups[0] === EVERYONE_GROUP_ID)
      ? urlState.groups.join(",")
      : undefined;

  const { data, isLoading, isFetching, error, refetch } = useModels({
    search: debouncedSearch || undefined,
    is_composite: true,
    include: "pricing",
    limit: 500,
    group: groupFilter,
  });

  const { data: providerDisplayConfigs = [] } = useProviderDisplayConfigs();
  const { data: groupsData } = useGroups({
    limit: 100,
    enabled: canManageGroups,
  });

  const providerConfigMap = useMemo(
    () =>
      new Map(
        providerDisplayConfigs.map((c) => [c.provider_key.toLowerCase(), c]),
      ),
    [providerDisplayConfigs],
  );

  const providerLabelOf = useCallback(
    (m: Model) => {
      const key = (m.metadata?.provider?.trim() || "Other").toLowerCase();
      const cfg = providerConfigMap.get(key);
      return cfg?.display_name || m.metadata?.provider?.trim() || "Other";
    },
    [providerConfigMap],
  );
  const providerIconOf = useCallback(
    (m: Model) => {
      const key = (m.metadata?.provider?.trim() || "Other").toLowerCase();
      return providerConfigMap.get(key)?.icon ?? null;
    },
    [providerConfigMap],
  );

  // ----- Aggregate families. Re-runs when pricingContext changes. -----
  const newCutoff = useMemo(
    () => computeNewCutoff(new Date(), NEW_CUTOFF_MONTHS),
    [],
  );
  const allFamilies = useMemo(
    () =>
      aggregateFamilies(data?.data ?? [], {
        newCutoff,
        context: pricingContext,
        providerLabelOf,
        providerIconOf,
        displayCapabilitiesOf: getDisplayCapabilities,
      }),
    [
      data?.data,
      newCutoff,
      pricingContext,
      providerLabelOf,
      providerIconOf,
    ],
  );

  // Provider options derived from current data; key = lowercase provider.
  const providerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const fam of allFamilies) {
      if (!seen.has(fam.providerKey)) {
        seen.set(fam.providerKey, fam.providerLabel);
      }
    }
    return [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allFamilies]);

  const groupOptions = useMemo(
    () =>
      (groupsData?.data ?? []).map((g) => ({ id: g.id, name: g.name })),
    [groupsData?.data],
  );

  // ----- Client-side filter pipeline -----
  const filteredFamilies = useMemo(() => {
    let result = allFamilies;

    if (urlState.category !== "all") {
      result = result.filter((f) => f.category === urlState.category);
    }

    if (urlState.providers.length > 0) {
      const providerSet = new Set(urlState.providers);
      result = result.filter((f) => providerSet.has(f.providerKey));
    }

    if (urlState.capabilities.length > 0) {
      result = result.filter((f) =>
        urlState.capabilities.every((cap) => f.capabilities.includes(cap)),
      );
    }

    return result;
  }, [
    allFamilies,
    urlState.category,
    urlState.providers,
    urlState.capabilities,
  ]);

  // ----- Sorting (always nullsLast) -----
  const sortedFamilies = useMemo(() => {
    const dir: 1 | -1 = urlState.dir === "asc" ? 1 : -1;
    const list = [...filteredFamilies];
    const numericCmp = (a: number, b: number) => a - b;
    const stringCmp = (a: string, b: string) => a.localeCompare(b);

    switch (urlState.sort) {
      case "intelligence":
        list.sort(
          nullsLast<AggregatedFamily, number>(
            (f) => f.intelligenceMax,
            dir,
            numericCmp,
          ),
        );
        break;
      case "cost":
        list.sort(
          nullsLast<AggregatedFamily, number>(
            (f) => f.priceFrom,
            dir,
            numericCmp,
          ),
        );
        break;
      case "context":
        list.sort(
          nullsLast<AggregatedFamily, number>(
            (f) => f.contextMax,
            dir,
            numericCmp,
          ),
        );
        break;
      case "released_at":
        list.sort(
          nullsLast<AggregatedFamily, string>(
            (f) => f.releasedAt,
            dir,
            stringCmp,
          ),
        );
        break;
      case "alias":
        list.sort(
          nullsLast<AggregatedFamily, string>(
            (f) => f.label,
            dir,
            stringCmp,
          ),
        );
        break;
    }

    return list;
  }, [filteredFamilies, urlState.sort, urlState.dir]);

  // ----- Drawer handling -----
  const openModel = (id: string) =>
    updateUrl((prev) => ({ ...prev, modelId: id }), { mode: "push" });
  const closeModel = () =>
    updateUrl((prev) => ({ ...prev, modelId: null }), { mode: "push" });
  const setActiveVariant = (id: string) =>
    updateUrl((prev) => ({ ...prev, modelId: id }), { mode: "replace" });

  const drawerFamily = useMemo<AggregatedFamily | null>(() => {
    if (!urlState.modelId) return null;
    return (
      allFamilies.find((f) =>
        f.variants.some((v) => v.id === urlState.modelId),
      ) ?? null
    );
  }, [allFamilies, urlState.modelId]);

  const filterCount = activeFilterCount(urlState);
  const showSkeleton = isLoading && !data;

  const clearAll = () => {
    setSearchInput("");
    setDebouncedSearch("");
    updateUrl(() => ({ ...defaultUrlState() }));
  };

  return (
    <div className="block md:hidden">
      <header className="sticky top-0 z-20 bg-background border-b px-4 pt-4 pb-3">
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
          <button
            type="button"
            aria-label="Open menu"
            className="p-1 -ml-1 hover:text-doubleword-neutral-900"
            onClick={() => sidebar.setOpenMobile(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          {billingEnabled && currentUser ? (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Balance:</span>
              {!balanceLoading && (
                <span className="font-semibold text-doubleword-neutral-900">
                  {formatDollars(balance ?? 0)}
                </span>
              )}
            </div>
          ) : (
            <div />
          )}
          <a
            href="https://docs.doubleword.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-doubleword-neutral-900"
          >
            Docs
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <h1 className="text-2xl font-bold text-doubleword-neutral-900 mb-3">
          Models
        </h1>

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search models..."
              aria-label="Search models"
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Open filters"
            onClick={() => setFilterOpen(true)}
            className="relative"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {filterCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-doubleword-neutral-900 text-white text-[10px] font-semibold">
                {filterCount}
              </span>
            )}
          </Button>
        </div>

        <div
          role="tablist"
          aria-label="Model categories"
          className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none"
        >
          {CATEGORY_TABS.map((tab) => {
            const active = urlState.category === tab.value;
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() =>
                  updateUrl((prev) => ({ ...prev, category: tab.value }))
                }
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors border ${
                  active
                    ? "bg-doubleword-neutral-900 border-doubleword-neutral-900 text-white"
                    : "bg-background border-input text-muted-foreground hover:bg-doubleword-neutral-50"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Pricing
          </span>
          <div
            role="radiogroup"
            aria-label="Pricing context"
            className="inline-flex bg-doubleword-neutral-100 p-0.5 rounded-md text-xs"
          >
            {(["async", "batch"] as const).map((opt) => (
              <button
                key={opt}
                role="radio"
                aria-checked={pricingContext === opt}
                type="button"
                onClick={() => setPricingContext(opt)}
                className={`px-3 py-1 rounded font-medium transition-colors capitalize ${
                  pricingContext === opt
                    ? "bg-background shadow-sm text-doubleword-neutral-900"
                    : "text-muted-foreground"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="px-4 pt-4 pb-10 space-y-3">
        {error ? (
          <div className="rounded-lg border bg-background p-6 text-center">
            <p className="text-sm text-doubleword-neutral-900 font-medium mb-3">
              Failed to load models.
            </p>
            <Button onClick={() => refetch()} variant="outline" size="sm">
              Try again
            </Button>
          </div>
        ) : showSkeleton ? (
          <MobileLoadingSkeleton />
        ) : sortedFamilies.length === 0 ? (
          <div className="rounded-lg border bg-background py-12 px-6 text-center">
            <p className="text-doubleword-neutral-900 font-medium mb-1">
              No models found
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Try adjusting your filters or search.
            </p>
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear all filters
            </Button>
          </div>
        ) : (
          <>
            {isFetching && !showSkeleton && (
              <div
                className="text-xs text-muted-foreground text-center"
                aria-live="polite"
              >
                Updating…
              </div>
            )}
            {sortedFamilies.map((family) => (
              <FamilyCard
                key={family.id}
                family={family}
                onOpen={openModel}
                pricingContext={pricingContext}
              />
            ))}
          </>
        )}
      </main>

      <FilterDrawer
        open={filterOpen}
        onOpenChange={setFilterOpen}
        state={urlState}
        setState={(updater) => updateUrl(updater)}
        providerOptions={providerOptions}
        groupOptions={groupOptions}
        canManageGroups={canManageGroups}
        visibleCount={sortedFamilies.length}
      />

      {drawerFamily && (
        <DetailDrawer
          family={drawerFamily}
          activeVariantId={urlState.modelId}
          onVariantChange={setActiveVariant}
          onClose={closeModel}
          pricingContext={pricingContext}
        />
      )}
    </div>
  );
};

export default MobileModelCatalog;
