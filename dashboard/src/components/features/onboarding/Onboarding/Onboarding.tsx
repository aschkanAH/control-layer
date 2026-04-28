import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileJson,
  KeyRound,
  Loader2,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth";
import {
  useCreateApiKey,
  useCreateBatch,
  useModels,
  useUploadFileWithProgress,
  useUser,
} from "@/api/control-layer/hooks";
import { copyToClipboard as copyToClipboardUtil } from "@/utils/clipboard";
import { AppSidebar } from "../../../layout/Sidebar/AppSidebar";

// Webhook configured by Growth team for capturing teammate invites. Posting
// here is best-effort (no-cors) so we can't read the response.
const INVITE_WEBHOOK_URL =
  "https://hooks.zapier.com/hooks/catch/27180094/uvhcpf2/";

// Default catalog model used in the visible code samples. We swap this with the
// first available chat model alias from the user's catalog when one is found,
// but keep medgemma-4b as a fallback so the snippet always renders something
// concrete even before /models loads.
const FALLBACK_MODEL_ALIAS = "medgemma-4b";

const SUCCESS_REDIRECT_DELAY_MS = 2000;
const RUN_NOW_SIMULATED_DELAY_MS = 2500;
const TOAST_DURATION_MS = 6000;

type WorkloadType = "async" | "batch";
type ExecutionMode = "browser" | "cli";
type Language = "python" | "curl";
type RunState = "idle" | "running" | "success";

function buildAsyncPayload(modelAlias: string): string {
  return `{
  "model": "${modelAlias}",
  "messages": [
    {"role": "system", "content": "Output only valid JSON."},
    {"role": "user", "content": "Generate a synthetic patient profile (Age, Gender, Symptoms, Diagnosis)."}
  ],
  "tier": "async"
}`;
}

function buildJsonlPayload(modelAlias: string): string {
  const row = (id: string) =>
    `{"custom_id": "${id}", "method": "POST", "url": "/v1/chat/completions", "body": {"model": "${modelAlias}", "messages": [{"role": "system", "content": "Output only valid JSON."}, {"role": "user", "content": "Generate a synthetic patient profile (Age, Gender, Symptoms, Diagnosis)."}]}}`;
  return [row("row-1"), row("row-2"), row("row-3")].join("\n");
}

function buildSnippets(apiKey: string, modelAlias: string) {
  return {
    batch: {
      python: `from openai import OpenAI

client = OpenAI(
    api_key="${apiKey}",
    base_url="https://api.doubleword.ai/v1"
)

# 1. Upload your batch input file
batch_input_file = client.files.create(
    file=open("patients.jsonl", "rb"),
    purpose="batch"
)

# 2. Start the batch job (~50% savings, 24h window)
batch = client.batches.create(
    input_file_id=batch_input_file.id,
    endpoint="/v1/chat/completions",
    completion_window="24h"
)

print(f"Batch started: {batch.id}")`,
      curl: `curl -X POST https://api.doubleword.ai/v1/batches \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelAlias}",
    "priority": "standard",
    "requests": [
      {
        "custom_id": "row-1",
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": "${modelAlias}",
            "messages": [{"role": "user", "content": "Generate a synthetic patient profile."}]
        }
      }
    ]
  }'`,
    },
    async: {
      python: `from openai import OpenAI

client = OpenAI(
    api_key="${apiKey}",
    base_url="https://api.doubleword.ai/v1"
)

# Start an async job (~25% savings, minutes completion)
response = client.chat.completions.create(
    model="${modelAlias}",
    messages=[
        {"role": "user", "content": "Generate a synthetic patient profile."}
    ],
    extra_headers={"x-doubleword-tier": "async"}
)

print(f"Async job queued!")`,
      curl: `curl -X POST https://api.doubleword.ai/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -H "x-doubleword-tier: async" \\
  -d '{
    "model": "${modelAlias}",
    "messages": [{"role": "user", "content": "Generate a synthetic patient profile."}]
  }'`,
    },
  } as const;
}

export function Onboarding() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: currentUser } = useUser("current");

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const [workloadType, setWorkloadType] = useState<WorkloadType>("async");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("browser");
  const [language, setLanguage] = useState<Language>("python");
  const [runState, setRunState] = useState<RunState>("idle");
  const [listenerState, setListenerState] = useState<"waiting" | "success">(
    "waiting",
  );

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  const apiKeyRequestedRef = useRef(false);
  const sampleBatchRequestedRef = useRef(false);
  const redirectScheduledRef = useRef(false);

  const createApiKey = useCreateApiKey();
  const createBatch = useCreateBatch();
  const uploadFile = useUploadFileWithProgress();

  // Pull the first chat model alias from the catalog so the rendered code
  // samples reference something that will actually work for the user. Falls
  // back to a hard-coded alias when the catalog query is still loading or
  // empty.
  const { data: modelsData } = useModels({ accessible: true, limit: 50 });
  const modelAlias = useMemo(() => {
    const chat = modelsData?.data?.find(
      (m) => (m.model_type ?? "CHAT") === "CHAT",
    );
    return chat?.alias ?? FALLBACK_MODEL_ALIAS;
  }, [modelsData]);

  // Mint a live API key on mount so step 1 has something concrete to show.
  // We only do this once per visit and only when the user is authenticated.
  useEffect(() => {
    if (apiKeyRequestedRef.current) return;
    if (authLoading || !isAuthenticated || !currentUser) return;
    apiKeyRequestedRef.current = true;

    createApiKey
      .mutateAsync({
        data: {
          name: `Onboarding key (${new Date().toLocaleString()})`,
          description: "Auto-generated during onboarding",
          purpose: "realtime",
        },
        userId: currentUser.id,
      })
      .then((response) => {
        setApiKey(response.key);
      })
      .catch((err) => {
        // Surface the failure but don't block the rest of the flow — the user
        // can still see the snippets and copy a placeholder, and they can
        // generate keys from /api-keys later.
        console.error("Failed to create onboarding API key:", err);
        setApiKeyError(
          err instanceof Error ? err.message : "Failed to create API key",
        );
      });
  }, [authLoading, isAuthenticated, currentUser, createApiKey]);

  // Fire the "Hello World" sample batch in the background on mount. This is
  // best-effort: if the catalog has no chat model or the upload fails, we
  // swallow the error and just hide the toast. The toast is shown
  // optimistically so the user sees activity even if the model catalog is
  // slow to load.
  useEffect(() => {
    if (sampleBatchRequestedRef.current) return;
    if (authLoading || !isAuthenticated) return;
    sampleBatchRequestedRef.current = true;

    toast("Sample Batch Started", {
      description:
        "We just fired off a 'Hello World' batch in the background so you have some data to look at when you visit the dashboard.",
      duration: TOAST_DURATION_MS,
      icon: <Sparkles className="w-4 h-4 text-doubleword-primary" />,
    });

    void (async () => {
      try {
        // Wait one tick for the models query to resolve. If it hasn't, the
        // fallback alias is fine — the batch creation will just fail silently
        // server-side which is acceptable for this background "demo" job.
        const helloPayload = `{"custom_id": "hello-1", "method": "POST", "url": "/v1/chat/completions", "body": {"model": "${modelAlias}", "messages": [{"role": "user", "content": "Say hello."}]}}\n`;
        const blob = new Blob([helloPayload], { type: "application/jsonl" });
        const file = new File([blob], `onboarding-hello-${Date.now()}.jsonl`, {
          type: "application/jsonl",
        });

        const uploaded = await uploadFile.mutateAsync({
          data: { file, purpose: "batch" },
        });

        await createBatch.mutateAsync({
          input_file_id: uploaded.id,
          endpoint: "/v1/chat/completions",
          completion_window: "24h",
        });
      } catch (err) {
        // Background task — keep the surface area quiet; only log.
        console.warn("Background Hello World batch failed:", err);
      }
    })();
    // We intentionally only run this once after auth is resolved; modelAlias
    // is read inside the IIFE so we don't need it as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated]);

  const goToDashboard = useCallback(() => {
    navigate("/models");
  }, [navigate]);

  // Auto-redirect after success in both browser and CLI modes.
  useEffect(() => {
    const succeeded =
      runState === "success" || listenerState === "success";
    if (!succeeded || redirectScheduledRef.current) return;
    redirectScheduledRef.current = true;
    const timer = setTimeout(goToDashboard, SUCCESS_REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [runState, listenerState, goToDashboard]);

  const snippets = useMemo(
    () => buildSnippets(apiKey ?? "<your-api-key>", modelAlias),
    [apiKey, modelAlias],
  );

  const browserPayload =
    workloadType === "batch"
      ? buildJsonlPayload(modelAlias)
      : buildAsyncPayload(modelAlias);
  const cliSnippet = snippets[workloadType][language];

  const handleCopyKey = async () => {
    if (!apiKey) return;
    const ok = await copyToClipboardUtil(apiKey);
    if (ok) {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleCopyCode = async () => {
    const text = executionMode === "browser" ? browserPayload : cliSnippet;
    const ok = await copyToClipboardUtil(text);
    if (ok) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleRunNow = async () => {
    if (runState !== "idle") return;
    setRunState("running");

    // Fire the real batch creation in the background. We don't surface its
    // success/failure to the run state machine since the spec asks for a
    // simulated 2.5s "running" → "success" cycle that gives the user a
    // predictable redirect experience, regardless of how fast the API
    // responds.
    void (async () => {
      try {
        const payload =
          workloadType === "batch"
            ? buildJsonlPayload(modelAlias)
            : `${JSON.stringify({
                custom_id: "row-1",
                method: "POST",
                url: "/v1/chat/completions",
                body: JSON.parse(buildAsyncPayload(modelAlias)),
              })}\n`;
        const blob = new Blob([payload], { type: "application/jsonl" });
        const file = new File(
          [blob],
          `onboarding-${workloadType}-${Date.now()}.jsonl`,
          { type: "application/jsonl" },
        );
        const uploaded = await uploadFile.mutateAsync({
          data: { file, purpose: "batch" },
        });
        await createBatch.mutateAsync({
          input_file_id: uploaded.id,
          endpoint: "/v1/chat/completions",
          completion_window: workloadType === "batch" ? "24h" : "1h",
        });
      } catch (err) {
        console.warn("Onboarding run-now batch failed:", err);
      }
    })();

    setTimeout(() => setRunState("success"), RUN_NOW_SIMULATED_DELAY_MS);
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || inviteSubmitting) return;
    setInviteSubmitting(true);
    try {
      // Zapier hooks accept a basic POST. We use no-cors because the hook
      // host doesn't return CORS headers, which means we can't read the
      // response — that's fine, we trust the network call.
      await fetch(INVITE_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          inviter_email: currentUser?.email,
          inviter_id: currentUser?.id,
          source: "onboarding",
        }),
      });
      setInviteSent(true);
      setInviteEmail("");
      toast.success("Invite sent");
      setTimeout(() => setInviteSent(false), 3000);
    } catch (err) {
      console.error("Failed to send invite:", err);
      toast.error("Could not send invite — please try again.");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const apiKeyDisplay = apiKey ?? (apiKeyError ? "—" : "Generating live key…");

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1">
          {/* Slim header — onboarding intentionally only shows the skip
              affordance, not the full app chrome. */}
          <header className="flex h-16 items-center justify-between border-b bg-white px-4 md:px-6">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToDashboard}
              aria-label="Skip to dashboard"
            >
              Skip to Dashboard
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </header>

          <main className="flex-1 bg-doubleword-background-secondary pb-12">
            <div className="mx-auto w-full max-w-3xl px-6 pt-12 md:pt-16">
              <div className="mb-10 text-center">
                <h1 className="text-3xl font-bold tracking-tight text-doubleword-text-primary mb-3">
                  You&apos;re ready to run at scale.
                </h1>
                <p className="mx-auto max-w-xl text-lg text-doubleword-text-tertiary">
                  Your workspace is provisioned. Send your first API request
                  below to authenticate your setup.
                </p>
              </div>

              {/* Step 1 — API Key */}
              <section className="mb-8 overflow-hidden rounded-xl border border-doubleword-border bg-white shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)]">
                <div className="flex items-center gap-3 border-b border-doubleword-border-light bg-doubleword-neutral-50/50 p-5">
                  <div className="rounded-md border border-amber-200/50 bg-amber-100/50 p-2">
                    <KeyRound className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-doubleword-text-primary">
                      1. Your Live API Key
                    </h2>
                    <p className="mt-0.5 text-xs text-doubleword-text-tertiary">
                      This key will only be shown once. Please store it
                      securely.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-stretch gap-3 p-5 sm:flex-row sm:items-center">
                  <div
                    className="flex-1 break-all rounded-lg border border-doubleword-border bg-doubleword-neutral-50 p-3.5 font-mono text-sm text-doubleword-text-primary shadow-inner"
                    aria-label="Live API key"
                  >
                    {apiKeyDisplay}
                  </div>
                  <Button
                    onClick={handleCopyKey}
                    disabled={!apiKey}
                    aria-label={copiedKey ? "Copied" : "Copy API key"}
                    className="whitespace-nowrap"
                  >
                    {copiedKey ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copiedKey ? "Copied" : "Copy Key"}
                  </Button>
                </div>
                {apiKeyError && (
                  <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-xs text-red-700">
                    {apiKeyError}. You can create a key from the API Keys page.
                  </div>
                )}
              </section>

              {/* Step 2 — Workload runner */}
              <section className="mb-8 flex flex-col overflow-hidden rounded-xl border border-doubleword-border bg-white shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)]">
                <div className="flex flex-col gap-5 border-b border-doubleword-border-light bg-doubleword-neutral-50/50 p-5">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                      <div className="rounded-md border border-blue-200/50 bg-blue-100/50 p-2">
                        {executionMode === "browser" ? (
                          <FileJson className="h-5 w-5 text-blue-600" />
                        ) : (
                          <Code2 className="h-5 w-5 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-doubleword-text-primary">
                          2. Run your first workload
                        </h2>
                        <p className="mt-0.5 text-xs text-doubleword-text-tertiary">
                          {executionMode === "browser"
                            ? "We've prepped an example payload. Run it directly from your browser."
                            : "Run this snippet from your terminal. Your key is already injected."}
                        </p>
                      </div>
                    </div>

                    <div className="flex self-start rounded-md border border-doubleword-border bg-doubleword-neutral-100 p-1 shadow-inner sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setExecutionMode("browser")}
                        className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-all ${
                          executionMode === "browser"
                            ? "bg-white text-doubleword-text-primary shadow-sm"
                            : "text-doubleword-text-tertiary hover:text-doubleword-text-primary"
                        }`}
                      >
                        Browser
                      </button>
                      <button
                        type="button"
                        onClick={() => setExecutionMode("cli")}
                        className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-all ${
                          executionMode === "cli"
                            ? "bg-white text-doubleword-text-primary shadow-sm"
                            : "text-doubleword-text-tertiary hover:text-doubleword-text-primary"
                        }`}
                      >
                        Terminal (CLI)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setWorkloadType("async")}
                      className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-all ${
                        workloadType === "async"
                          ? "border-doubleword-primary bg-doubleword-red-50/50 ring-1 ring-doubleword-primary"
                          : "border-doubleword-border bg-white hover:border-doubleword-red-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-doubleword-text-primary">
                          Async Inference
                        </span>
                        {workloadType === "async" && (
                          <CheckCircle2 className="h-4 w-4 text-doubleword-primary" />
                        )}
                      </div>
                      <span className="text-xs text-doubleword-text-tertiary">
                        Fast &amp; cost-effective (~25% savings). Results in
                        minutes. Ideal for quick jobs.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkloadType("batch")}
                      className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-all ${
                        workloadType === "batch"
                          ? "border-blue-500 bg-blue-50/50 ring-1 ring-blue-500"
                          : "border-doubleword-border bg-white hover:border-blue-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-doubleword-text-primary">
                          Batch Inference
                        </span>
                        {workloadType === "batch" && (
                          <CheckCircle2 className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      <span className="text-xs text-doubleword-text-tertiary">
                        Lowest cost (~50% savings). Results in 24h. Ideal for
                        large datasets.
                      </span>
                    </button>
                  </div>
                </div>

                {executionMode === "browser" ? (
                  <>
                    <div className="group relative border-b border-doubleword-border-light">
                      <pre className="overflow-x-auto bg-[#0E1116] p-6 font-mono text-xs leading-relaxed text-gray-300 sm:text-sm">
                        <code className="block w-full whitespace-pre">
                          {browserPayload}
                        </code>
                      </pre>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="absolute right-4 top-4 rounded bg-white/10 p-2 text-white opacity-0 backdrop-blur-sm transition-all hover:bg-white/20 group-hover:opacity-100 focus:opacity-100"
                        title="Copy payload"
                        aria-label={copiedCode ? "Copied" : "Copy payload"}
                      >
                        {copiedCode ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <div className="flex flex-col items-center justify-between gap-4 bg-white p-4 sm:flex-row">
                      <div className="text-sm text-doubleword-text-tertiary">
                        Estimated cost for 10,000 records:{" "}
                        <strong className="font-medium text-doubleword-text-primary">
                          {workloadType === "batch" ? "$1.25" : "$1.87"}
                        </strong>
                        <span
                          className={`ml-1 font-medium ${
                            workloadType === "batch"
                              ? "text-blue-600"
                              : "text-doubleword-primary"
                          }`}
                        >
                          (
                          {workloadType === "batch"
                            ? "50% less than real-time inference"
                            : "25% less than real-time inference"}
                          )
                        </span>
                      </div>
                      <Button
                        onClick={handleRunNow}
                        disabled={runState !== "idle"}
                        className={`w-full whitespace-nowrap sm:w-auto ${
                          runState === "running"
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                            : runState === "success"
                              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                              : workloadType === "batch"
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-doubleword-primary text-white hover:bg-doubleword-red-dark"
                        }`}
                      >
                        {runState === "idle" && (
                          <>
                            <Play className="h-4 w-4 fill-current" />
                            {workloadType === "batch"
                              ? "Run Batch Now"
                              : "Run Async Now"}
                          </>
                        )}
                        {runState === "running" && (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Uploading &amp; Starting…
                          </>
                        )}
                        {runState === "success" && (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            Workload Queued!
                          </>
                        )}
                      </Button>
                    </div>

                    <div
                      className={`overflow-hidden transition-all duration-500 ease-in-out ${
                        runState === "success"
                          ? "max-h-24 border-t border-emerald-100 bg-emerald-50"
                          : "max-h-0"
                      }`}
                    >
                      <div className="flex items-center justify-between p-4">
                        <span className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                          <Sparkles className="h-4 w-4" />
                          Workload successfully received! Redirecting to
                          dashboard…
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-b border-gray-800 bg-[#0E1116] px-4 py-2">
                      <span className="font-mono text-xs text-gray-400">
                        snippet.{language === "python" ? "py" : "sh"}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setLanguage("python")}
                          className={`rounded px-2 py-1 font-mono text-xs transition-colors ${
                            language === "python"
                              ? "bg-white/10 text-white"
                              : "text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          Python
                        </button>
                        <button
                          type="button"
                          onClick={() => setLanguage("curl")}
                          className={`rounded px-2 py-1 font-mono text-xs transition-colors ${
                            language === "curl"
                              ? "bg-white/10 text-white"
                              : "text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          cURL
                        </button>
                      </div>
                    </div>
                    <div className="group relative">
                      <pre className="overflow-x-auto bg-[#0E1116] p-6 font-mono text-xs leading-relaxed text-gray-300 sm:text-sm">
                        <code className="block w-full whitespace-pre">
                          {cliSnippet}
                        </code>
                      </pre>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="absolute right-4 top-4 rounded bg-white/10 p-2 text-white opacity-0 backdrop-blur-sm transition-all hover:bg-white/20 group-hover:opacity-100 focus:opacity-100"
                        title="Copy code"
                        aria-label={copiedCode ? "Copied" : "Copy code"}
                      >
                        {copiedCode ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        listenerState === "waiting" &&
                        setListenerState("success")
                      }
                      className={`p-4 text-left transition-colors duration-300 ${
                        listenerState === "waiting"
                          ? "cursor-pointer border-t border-amber-100 bg-amber-50"
                          : "border-t border-emerald-100 bg-emerald-50"
                      }`}
                      aria-label={
                        listenerState === "waiting"
                          ? "Simulate request received"
                          : "Request received"
                      }
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {listenerState === "waiting" ? (
                            <>
                              <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
                              <span className="text-sm font-medium text-amber-800">
                                Listening for your request…
                              </span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                              <span className="text-sm font-medium text-emerald-800">
                                Workload successfully received! Redirecting…
                              </span>
                            </>
                          )}
                        </div>
                        {listenerState === "waiting" && (
                          <span className="hidden text-xs text-amber-600/60 sm:inline">
                            (Click to simulate success)
                          </span>
                        )}
                      </div>
                    </button>
                  </>
                )}
              </section>

              {/* Step 3 — Team invite */}
              <section className="relative flex flex-col items-center gap-8 overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-[#1c1c1a] to-zinc-900 p-8 text-white shadow-xl md:flex-row">
                <div
                  className="pointer-events-none absolute -mr-20 -mt-20 right-0 top-0 h-64 w-64 rounded-full bg-doubleword-primary/10 blur-3xl"
                  aria-hidden="true"
                />
                <div className="relative z-10 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <Users className="h-5 w-5 text-doubleword-red-light" />
                    <h2 className="text-xl font-bold">Scale with your team</h2>
                  </div>
                  <p className="mb-5 text-sm leading-relaxed text-zinc-400">
                    Invite engineers to share this workspace. You&apos;ll get{" "}
                    <strong className="font-medium text-white">
                      $10 in free credits
                    </strong>{" "}
                    for every teammate who runs their first batch.
                  </p>
                  <form
                    onSubmit={handleSendInvite}
                    className="flex flex-col gap-3 sm:flex-row"
                  >
                    <input
                      type="email"
                      required
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950/50 px-4 py-2.5 text-sm text-white placeholder-zinc-500 shadow-inner transition-all focus:border-doubleword-red-light focus:outline-none focus:ring-1 focus:ring-doubleword-red-light"
                      aria-label="Teammate email"
                    />
                    <button
                      type="submit"
                      disabled={inviteSubmitting || !inviteEmail.trim()}
                      className="whitespace-nowrap rounded-lg bg-white px-6 py-2.5 text-sm font-bold text-zinc-900 shadow-sm transition-colors hover:bg-gray-100 active:scale-[0.98] disabled:opacity-60"
                    >
                      {inviteSubmitting
                        ? "Sending…"
                        : inviteSent
                          ? "Sent!"
                          : "Send Invite"}
                    </button>
                  </form>
                </div>
              </section>
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

export default Onboarding;
