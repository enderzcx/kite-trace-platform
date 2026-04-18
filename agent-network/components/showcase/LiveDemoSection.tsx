"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Copy,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fallbackCapabilities, type ShowcaseCapability } from "@/components/showcase/showcase-data";
import { BACKEND_URL } from "@/lib/chain-config";

type DemoPhase = "idle" | "discovering" | "session" | "payment" | "result" | "complete" | "error";
type EvidencePayload = {
  ok?: boolean;
  evidence?: {
    traceId?: string;
    runtimeSnapshot?: {
      authorizedBy?: string;
      authorizedAt?: number;
      authorizationMode?: string;
    };
    x402?: {
      amount?: string;
      paymentTxHash?: string;
      action?: string;
    };
    workflow?: {
      result?: {
        external?: {
          data?: Record<string, unknown>;
        };
      };
    };
  };
};

type InvokePayload = {
  ok?: boolean;
  traceId?: string;
  requestId?: string;
  state?: string;
  txHash?: string;
  userOpHash?: string;
  result?: Record<string, unknown>;
  workflow?: {
    result?: Record<string, unknown>;
  };
  reason?: string;
  error?: string;
};

interface LiveDemoSectionProps {
  capabilities?: ShowcaseCapability[];
  selectedCapabilityId?: string;
  onCapabilityChange?: (capabilityId: string) => void;
  publicEvidenceBaseUrl?: string;
}

interface RenderRecord {
  title: string;
  body: string;
  sourceUrl: string | null;
  sourceName: string;
  publishedAt: string;
  fetchedAt: string;
  signal?: string;
  score?: string;
}

const phases = [
  { id: "discovering", label: "Discovering provider" },
  { id: "session", label: "Session ready" },
  { id: "payment", label: "x402 payment sent" },
  { id: "result", label: "Result received" },
] as const;

function normalizeCapability(
  capabilities: ShowcaseCapability[],
  selectedCapabilityId?: string
) {
  if (!capabilities.length) {
    return fallbackCapabilities[0];
  }
  const preferred = capabilities.find(
    (capability) => capability.capabilityId === selectedCapabilityId
  );
  return preferred || capabilities[0];
}

function readResultRecords(result: Record<string, unknown> | null): RenderRecord[] {
  const root = (result || {}) as Record<string, unknown>;
  const nestedData =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  const external =
    root.external && typeof root.external === "object"
      ? (root.external as Record<string, unknown>)
      : null;
  const externalData =
    external?.data && typeof external.data === "object"
      ? (external.data as Record<string, unknown>)
      : null;
  const payload = externalData || nestedData || root;
  const listings = Array.isArray(payload.listings) ? payload.listings : [];
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const memes = Array.isArray(payload.memes) ? payload.memes : [];
  const events = Array.isArray(payload.events) ? payload.events : [];
  const signals = Array.isArray(payload.signals) ? payload.signals : [];
  const tweets = Array.isArray(payload.tweets) ? payload.tweets : [];
  const combined = [...listings, ...articles, ...memes, ...events, ...signals, ...tweets];

  return combined.slice(0, 8).map((item, index) => {
    const record = item as Record<string, unknown>;
    return {
      title:
        String(
          record.title ||
            record.coin ||
            record.token ||
            record.exchange ||
            record.walletAddress ||
            `Record ${index + 1}`
        ).trim() || `Record ${index + 1}`,
      body:
        String(
          record.summary ||
            record.text ||
            record.action ||
            record.sentiment ||
            record.listingType ||
            ""
        ).trim() || "No summary available.",
      sourceUrl: record.sourceUrl ? String(record.sourceUrl) : null,
      sourceName: String(record.sourceName || record.source || "live-feed"),
      publishedAt: String(record.publishedAt || record.createdAt || record.ts || ""),
      fetchedAt: String(record.fetchedAt || ""),
      signal: String(record.signal || ""),
      score: record.aiScore !== undefined && record.aiScore !== null ? String(record.aiScore) : "",
    };
  });
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function LiveDemoSection({
  capabilities = fallbackCapabilities,
  selectedCapabilityId,
  onCapabilityChange,
  publicEvidenceBaseUrl = BACKEND_URL,
}: LiveDemoSectionProps) {
  const [activeCapabilityId, setActiveCapabilityId] = useState(
    normalizeCapability(capabilities, selectedCapabilityId).capabilityId
  );
  const [inputValue, setInputValue] = useState(
    normalizeCapability(capabilities, selectedCapabilityId).defaultInput
  );
  const [phase, setPhase] = useState<DemoPhase>("idle");
  const [error, setError] = useState("");
  const [invokePayload, setInvokePayload] = useState<InvokePayload | null>(null);
  const [evidencePayload, setEvidencePayload] = useState<EvidencePayload | null>(null);

  const activeCapability = useMemo(
    () =>
      normalizeCapability(
        capabilities.length ? capabilities : fallbackCapabilities,
        activeCapabilityId || selectedCapabilityId
      ),
    [activeCapabilityId, capabilities, selectedCapabilityId]
  );

  useEffect(() => {
    const preferred = normalizeCapability(capabilities, selectedCapabilityId);
    setActiveCapabilityId(preferred.capabilityId);
    setInputValue(preferred.defaultInput);
  }, [capabilities, selectedCapabilityId]);

  const records = useMemo(
    () => readResultRecords((invokePayload?.result || invokePayload?.workflow?.result || null) as Record<string, unknown> | null),
    [invokePayload]
  );

  const traceId = String(
    invokePayload?.traceId || evidencePayload?.evidence?.traceId || ""
  ).trim();

  async function copyText(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  async function handleBuy() {
    setError("");
    setPhase("discovering");
    setInvokePayload(null);
    setEvidencePayload(null);

    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = JSON.parse(inputValue);
    } catch {
      setPhase("error");
      setError("Input JSON is invalid. Please correct it and retry.");
      return;
    }

    try {
      setPhase("session");
      const invokeResponse = await fetch("/api/demo/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serviceId: activeCapability.capabilityId,
          capability: activeCapability.capabilityId,
          provider: activeCapability.providerId,
          input: parsedInput,
        }),
      });
      const invokeJson = (await invokeResponse.json()) as InvokePayload;
      if (!invokeResponse.ok || invokeJson.ok === false) {
        throw new Error(String(invokeJson.reason || invokeJson.error || "Live demo request failed."));
      }

      setPhase("payment");
      setInvokePayload(invokeJson);
      setPhase("result");

      const nextTraceId = String(invokeJson.traceId || "").trim();
      if (nextTraceId) {
        const evidenceResponse = await fetch(`/api/demo/evidence/${encodeURIComponent(nextTraceId)}`);
        const evidenceJson = (await evidenceResponse.json()) as EvidencePayload;
        if (evidenceResponse.ok && evidenceJson?.ok !== false) {
          setEvidencePayload(evidenceJson);
        }
      }

      setPhase("complete");
    } catch (nextError) {
      setPhase("error");
      setError(nextError instanceof Error ? nextError.message : "Live demo request failed.");
    }
  }

  function setCapability(capabilityId: string) {
    const nextCapability = normalizeCapability(capabilities, capabilityId);
    setActiveCapabilityId(nextCapability.capabilityId);
    setInputValue(nextCapability.defaultInput);
    onCapabilityChange?.(nextCapability.capabilityId);
  }

  return (
    <section className="space-y-8" id="live-demo">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-300/80">Live Demo</p>
        <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
          Run a real service call from the public network.
        </h2>
        <p className="max-w-3xl text-base leading-7 text-slate-300">
          Select a capability, review the default JSON payload, and execute a live request that
          returns result data plus exportable audit evidence.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(5,10,24,0.96),rgba(4,7,18,0.9))] p-6 shadow-2xl shadow-black/25">
          <div className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Step 1</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Select a capability</h3>
            </div>
            <select
              value={activeCapability.capabilityId}
              onChange={(event) => setCapability(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white outline-none transition focus:border-cyan-300/40"
            >
              {(capabilities.length ? capabilities : fallbackCapabilities).map((capability) => (
                <option
                  key={capability.capabilityId}
                  value={capability.capabilityId}
                  className="bg-slate-950 text-white"
                >
                  {capability.name} · {capability.providerId} · {capability.price}
                </option>
              ))}
            </select>

            <div className="rounded-[1.4rem] border border-white/8 bg-white/4 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-cyan-300/12 text-cyan-100">{activeCapability.capabilityId}</Badge>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
                  {activeCapability.providerId}
                </Badge>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
                  {activeCapability.price}
                </Badge>
              </div>
              <p className="text-sm leading-6 text-slate-300">{activeCapability.description}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Step 2</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Input parameters</h3>
            </div>
            <textarea
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              className="min-h-[280px] w-full rounded-[1.6rem] border border-white/10 bg-slate-950/80 p-4 font-mono text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-300/40"
              spellCheck={false}
            />

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Step 3</p>
                <p className="text-sm text-slate-300">Payment handled automatically via AA session + x402.</p>
              </div>
              <Button
                onClick={handleBuy}
                className="h-12 rounded-full bg-cyan-400 px-6 text-slate-950 hover:bg-cyan-300"
              >
                Buy Service → {activeCapability.price}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(7,14,28,0.96),rgba(3,7,18,0.92))] p-6 shadow-2xl shadow-black/25">
          <div className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Execution state</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Result + Evidence</h3>
            </div>

            <div className="space-y-3">
              {phases.map((item, index) => {
                const done =
                  phase === "complete" ||
                  (phase === "error" && index < 2) ||
                  (phase === "result" && index < 3) ||
                  (phase === "payment" && index < 2) ||
                  (phase === "session" && index < 1);
                const active =
                  (phase === "discovering" && index === 0) ||
                  (phase === "session" && index === 1) ||
                  (phase === "payment" && index === 2) ||
                  ((phase === "result" || phase === "complete" || phase === "error") && index === 3);

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/4 px-4 py-3"
                  >
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                    ) : active ? (
                      <LoaderCircle className="h-5 w-5 animate-spin text-cyan-300" />
                    ) : phase === "error" && index === 3 ? (
                      <AlertCircle className="h-5 w-5 text-rose-300" />
                    ) : (
                      <CircleDashed className="h-5 w-5 text-slate-500" />
                    )}
                    <span className="text-sm text-slate-200">{item.label}</span>
                  </div>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {error ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="rounded-[1.5rem] border border-rose-400/20 bg-rose-400/10 p-5 text-sm leading-6 text-rose-100"
                >
                  {error}
                </motion.div>
              ) : (
                <motion.div
                  key="tabs"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                >
                  <Tabs defaultValue="evidence" className="gap-4">
                    <TabsList className="rounded-full bg-white/6 p-1">
                      <TabsTrigger value="result" className="rounded-full px-4">
                        Result
                      </TabsTrigger>
                      <TabsTrigger value="evidence" className="rounded-full px-4">
                        Evidence
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="result">
                      <div className="space-y-3">
                        {records.length ? (
                          records.map((record, index) => (
                            <div
                              key={`${record.title}-${index}`}
                              className="rounded-[1.4rem] border border-white/6 bg-white/4 p-4"
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <p className="text-base font-semibold text-white">{record.title}</p>
                                {record.signal ? (
                                  <Badge
                                    className={
                                      record.signal.toLowerCase() === "long"
                                        ? "bg-emerald-400/15 text-emerald-100"
                                        : record.signal.toLowerCase() === "short"
                                          ? "bg-rose-400/15 text-rose-100"
                                          : "bg-slate-400/15 text-slate-100"
                                    }
                                  >
                                    {record.signal}
                                  </Badge>
                                ) : null}
                                {record.score ? (
                                  <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
                                    score {record.score}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-sm leading-6 text-slate-300">{record.body}</p>
                              <div className="mt-3 space-y-1 text-xs text-slate-400">
                                <p>source: {record.sourceName}</p>
                                <p>published: {formatDate(record.publishedAt)}</p>
                                <p>fetched: {formatDate(record.fetchedAt)}</p>
                              </div>
                              {record.sourceUrl ? (
                                <a
                                  href={record.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-3 inline-flex items-center gap-1 text-sm text-cyan-300 hover:text-cyan-200"
                                >
                                  Read Source
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[1.5rem] border border-dashed border-white/12 bg-white/3 p-6 text-sm text-slate-400">
                            Run a live call to populate result cards here.
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="evidence">
                      <div className="space-y-4 rounded-[1.5rem] border border-white/8 bg-black/25 p-5">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Audit Evidence</p>
                          <h4 className="mt-2 text-xl font-semibold text-white">Proof bundle</h4>
                        </div>
                        <div className="grid gap-3">
                          {[
                            { label: "traceId", value: traceId },
                            {
                              label: "authorizedBy",
                              value: evidencePayload?.evidence?.runtimeSnapshot?.authorizedBy || "",
                            },
                            {
                              label: "payment txHash",
                              value:
                                evidencePayload?.evidence?.x402?.paymentTxHash ||
                                invokePayload?.txHash ||
                                "",
                            },
                          ].map((item) => (
                            <div
                              key={item.label}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-white/6 bg-white/4 px-4 py-3"
                            >
                              <div className="space-y-1">
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
                                <p className="break-all text-sm text-slate-100">
                                  {item.value || "-"}
                                </p>
                              </div>
                              {item.value ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-slate-300 hover:bg-white/10 hover:text-white"
                                  onClick={() => copyText(item.value)}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>

                        {records[0]?.sourceUrl ? (
                          <div className="rounded-2xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-slate-200">
                            <p className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-500">sourceUrl</p>
                            <a
                              href={records[0].sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-cyan-300 hover:text-cyan-200"
                            >
                              {records[0].sourceUrl}
                            </a>
                          </div>
                        ) : null}

                        <div className="flex flex-col gap-3 text-sm text-slate-300">
                          <p>
                            fetchedAt:{" "}
                            {records[0]?.fetchedAt ? formatDate(records[0].fetchedAt) : "-"}
                          </p>
                          {traceId ? (
                            <a
                              href={`${publicEvidenceBaseUrl.replace(/\/+$/, "")}/api/public/evidence/${traceId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                            >
                              View Raw Evidence JSON
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
