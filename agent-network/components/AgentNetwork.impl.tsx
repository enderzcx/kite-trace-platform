"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Background,
  ConnectionLineType,
  Controls,
  Edge,
  MiniMap,
  Node,
  ReactFlow,
  MarkerType,
  useEdgesState,
  useNodesState,
} from "reactflow";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type Time,
  type WhitespaceData,
} from "lightweight-charts";
import {
  Check,
  CirclePause,
  ClipboardCopy,
  Cpu,
  Download,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { GlowEdge } from "@/components/agent-network/GlowEdge";
import { NetworkNode, type NetworkNodeData } from "@/components/agent-network/NetworkNode";
import {
  buildInfoPreviewLines,
  buildTechnicalPreviewLines,
  createWorkflowRunId,
  fetchJSON,
  formatTxAge,
  formatTxTime,
  friendlyErrorMessage,
  hasObjectPayload,
  normalizeRequestId,
  parseTimestampMs,
  pickFirstObject,
  randomHex,
  receiptRefToRequestId,
  resolveBackendBaseUrl,
  sanitizeMojibakeDisplay,
  shortHash,
  toFiniteNumber,
  toIsoFromMs,
  toNumberOrNull,
  toRecord,
  txExplorerUrl,
} from "@/components/agent-network/formatters";
import "reactflow/dist/style.css";

export type FlowMode = "unified";
type DemoView = "detailed" | "general";
type Language = "zh" | "en";
export type PlaybackState = "idle" | "playing" | "paused" | "completed";
type PaymentPhase = "challenge" | "pay+proof" | "verify" | "unlock";

export type FlowStepId =
  | "erc8004_verify"
  | "xmtp_quote_request"
  | "xmtp_quote_return"
  | "x402_settlement"
  | "xmtp_service_result"
  | "api_order_decision";

export interface FlowStep {
  id: FlowStepId;
  index: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  description: string;
  durationMs: number;
}

export interface AuditLogEntry {
  id: string;
  tsISO: string;
  tsLocal: string;
  mode: FlowMode;
  stepId: FlowStepId;
  stepName: string;
  blockchainVerifiable: true;
  verificationHash?: string;
  xmtpSnippet?: string;
  receiptRef?: string;
  messageServiceTxHash?: string;
  messageServicePaidAt?: string;
  technicalServiceTxHash?: string;
  technicalServicePaidAt?: string;
  apiGateTxHash?: string;
  apiGatePaidAt?: string;
  decisionBasis?: string;
  payload: Record<string, unknown>;
}

export interface AgentNetworkProps {
  backendBaseUrl?: string;
  auditMaxEntries?: number;
}

type EdgeChannel = "xmtp" | "x402" | "erc8004" | "decision" | "api";

interface NetworkEdgeData {
  label: string;
  channel: EdgeChannel;
  active?: boolean;
  dimmed?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  curvature?: number;
  leftHint?: string;
  rightHint?: string;
  leftHintOffsetY?: number;
  rightHintOffsetY?: number;
}

interface RealServiceBranch {
  requestId: string;
  txHash: string;
  paidAtIso: string;
  amount: number;
  summary: string;
  confidence: number;
}

interface RealServiceRun {
  traceId: string;
  requestId: string;
  info: RealServiceBranch;
  technical: RealServiceBranch;
  agent001Decision: Agent001Decision | null;
  infoRaw: Record<string, unknown> | null;
  technicalRaw: Record<string, unknown> | null;
  warnings: string[];
}

interface Agent001DecisionPlan {
  symbol: string;
  side: string;
  orderType: string;
  tif: string;
  size: number | null;
  entryPrice: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
}

interface Agent001Decision {
  shouldPlaceOrder: boolean;
  decision: string;
  reason: string;
  text: string;
  version?: string;
  generatedAt?: string;
  plan: Agent001DecisionPlan;
  forceOrderRequested?: boolean;
  explicitOrderRequested?: boolean;
}

interface PlanHistoryItem {
  id: string;
  createdAt: string;
  version: string;
  requestId: string;
  traceId: string;
  decision: string;
  reason: string;
  shouldPlaceOrder: boolean;
  plan: Agent001DecisionPlan;
  executed: boolean;
  executeRequestId: string;
  executeTxHash: string;
  executeSummary: string;
}

interface WorkflowRunIds {
  traceId: string;
  requestId: string;
  infoTaskId: string;
  technicalTaskId: string;
}

interface WorkflowStreamHandle {
  stop: () => void;
  done: Promise<void>;
}

interface EvidenceArtifact {
  source: "service_info" | "service_technical" | "api_order";
  requestId: string;
  traceId: string;
  evidence: unknown;
}

interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface PositionItem {
  symbol: string;
  side: string;
  signedSize: number;
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  leverage: number | null;
  liquidationPrice: number | null;
}

interface OpenOrderItem {
  coin?: string;
  side?: string;
  sz?: string | number;
  limitPx?: string | number;
  oid?: string | number;
}

interface ExecutionDraft {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  tif: string;
  size: number;
  entryPrice: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
}

interface CandleChartHandle {
  remove: () => void;
  applyOptions: (options: { width: number }) => void;
}

interface CandleSeriesHandle {
  setData: (rows: Array<CandlestickData<Time> | WhitespaceData<Time>>) => void;
}

const COLORS: Record<EdgeChannel, string> = {
  xmtp: "#38bdf8",
  x402: "#22c55e",
  erc8004: "#a855f7",
  decision: "#f59e0b",
  api: "#f97316",
};

const X402_PHASES: PaymentPhase[] = ["challenge", "pay+proof", "verify", "unlock"];
const QUOTE_CAP = 0.0003;
const EXECUTION_THRESHOLD = 0.62;
const TX_STALE_MS = 60 * 60 * 1000;
const PLAN_HISTORY_STORAGE_KEY = "agent_network_plan_history_v1";
const MANUAL_FETCH_ERC8004_HOLD_MS = 1000;
const MANUAL_FETCH_X402_SETTLEMENT_HOLD_MS = 2200;
const MANUAL_FETCH_RESULT_HOLD_MS = 380;
const MANUAL_EXEC_PHASE_HOLD_MS = 480;
const RESULT_SNIPPET_PREVIEW_CHARS = 360;

export const FLOW_STEPS: FlowStep[] = [
  { id: "erc8004_verify", index: 1, title: "Step 1 · ERC8004 Verification", description: "Agent001 verifies collaborator agents on-chain.", durationMs: 1300 },
  { id: "xmtp_quote_request", index: 2, title: "Step 2 · XMTP DM Quote Request", description: "Agent001 asks news/fundamental and technical analysis agents for service quotes.", durationMs: 1500 },
  { id: "xmtp_quote_return", index: 3, title: "Step 3 · XMTP DM Quote Return", description: "Agents return quotes and Agent001 decides whether to pay.", durationMs: 1600 },
  { id: "x402_settlement", index: 4, title: "Step 4 · x402 Payment", description: "challenge -> pay+proof -> unlock for paid service access.", durationMs: 2500 },
  { id: "xmtp_service_result", index: 5, title: "Step 5 · XMTP DM Service Result", description: "Paid service results are returned to Agent001 over DM.", durationMs: 1700 },
  { id: "api_order_decision", index: 6, title: "Step 6 · Agent001 API Order Decision", description: "Agent001 decides whether to call API, then settles API access via x402.", durationMs: 1500 },
];

export const NETWORK_NODES: Node<NetworkNodeData>[] = [
  { id: "erc8004", type: "network", position: { x: 610, y: 56 }, data: { title: "ERC8004", subtitle: "Registration · Authentication · Reputation · Agent Discovery", kind: "protocol" } },
  { id: "message-agent", type: "network", position: { x: 92, y: 224 }, data: { title: "News/Fundamental Analysis Agent", subtitle: "News side · market news signal", kind: "agent" } },
  { id: "technical-agent", type: "network", position: { x: 92, y: 452 }, data: { title: "Technical Analysis Agent", subtitle: "Technical side · chart signal", kind: "agent" } },
  { id: "agent001", type: "network", position: { x: 574, y: 334 }, data: { title: "Agent001", subtitle: "Signal Aggregator & Executor", kind: "agent" } },
  { id: "x402-service", type: "network", position: { x: 860, y: 550 }, data: { title: "x402 Service Settlement", subtitle: "Pay service quote and unlock agent result", kind: "settlement" } },
  { id: "x402-api", type: "network", position: { x: 960, y: 232 }, data: { title: "x402 API Settlement", subtitle: "Pay API gate and unlock order request", kind: "settlement" } },
  { id: "trading-api", type: "network", position: { x: 1248, y: 334 }, data: { title: "Trading API", subtitle: "Web2 Order Service", kind: "api" } },
];

export const NETWORK_EDGES: Edge<NetworkEdgeData>[] = [
  { id: "erc-msg", type: "glow", source: "erc8004", target: "message-agent", sourceHandle: "s-left", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "", channel: "erc8004", curvature: 0.28 } },
  { id: "erc-tech", type: "glow", source: "erc8004", target: "technical-agent", sourceHandle: "s-left", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "", channel: "erc8004", curvature: 0.35 } },
  { id: "erc-agent001", type: "glow", source: "erc8004", target: "agent001", sourceHandle: "s-bottom", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "", channel: "erc8004", curvature: 0.24 } },
  { id: "quote-req-msg", type: "glow", source: "agent001", target: "message-agent", sourceHandle: "s-left", targetHandle: "t-right", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "① DM quote request (News Agent)", channel: "xmtp", labelOffsetY: -30, curvature: 0.28 } },
  { id: "quote-req-tech", type: "glow", source: "agent001", target: "technical-agent", sourceHandle: "s-left", targetHandle: "t-right", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "① DM quote request (Technical Agent)", channel: "xmtp", labelOffsetY: 28, curvature: 0.16 } },
  { id: "quote-res-msg", type: "glow", source: "message-agent", target: "agent001", sourceHandle: "s-top", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "② DM quote return", channel: "xmtp", labelOffsetY: -54, curvature: 0.4 } },
  { id: "quote-res-tech", type: "glow", source: "technical-agent", target: "agent001", sourceHandle: "s-bottom", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "② DM quote return", channel: "xmtp", labelOffsetY: 54, curvature: 0.4 } },
  { id: "pay-to-x402-service", type: "glow", source: "agent001", target: "x402-service", sourceHandle: "s-bottom", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "③ x402 pay + proof (service)", channel: "x402", labelOffsetY: -6, curvature: 0.24 } },
  { id: "unlock-msg", type: "glow", source: "x402-service", target: "message-agent", sourceHandle: "s-left", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "④ unlock news service", channel: "x402", labelOffsetX: -28, labelOffsetY: -22, curvature: 0.34 } },
  { id: "unlock-tech", type: "glow", source: "x402-service", target: "technical-agent", sourceHandle: "s-left", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "④ unlock technical service", channel: "x402", labelOffsetX: -12, labelOffsetY: 20, curvature: 0.24 } },
  { id: "result-msg", type: "glow", source: "message-agent", target: "agent001", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "⑤ DM service result", channel: "xmtp", labelOffsetY: -10, curvature: 0.22 } },
  { id: "result-tech", type: "glow", source: "technical-agent", target: "agent001", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp }, data: { label: "⑤ DM service result", channel: "xmtp", labelOffsetY: 18, curvature: 0.15 } },
  { id: "pay-to-x402-api", type: "glow", source: "agent001", target: "x402-api", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "⑥ x402 pay + proof (API)", channel: "x402", labelOffsetY: -22, curvature: 0.2 } },
  { id: "unlock-api", type: "glow", source: "x402-api", target: "trading-api", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "⑥ unlock API order channel", channel: "x402", labelOffsetY: 18, curvature: 0.2 } },
  { id: "api-to-agent", type: "glow", source: "trading-api", target: "agent001", sourceHandle: "s-left", targetHandle: "t-right", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.api }, data: { label: "⑥ API result + receiptRef", channel: "api", labelOffsetY: -18, curvature: 0.24 } },
];

export const GENERAL_NETWORK_NODES: Node<NetworkNodeData>[] = [
  { id: "erc8004", type: "network", position: { x: 600, y: 56 }, data: { title: "ERC8004", subtitle: "Registration · Authentication · Reputation · Agent Discovery", kind: "protocol" } },
  { id: "other-agent", type: "network", position: { x: 148, y: 338 }, data: { title: "Other Agent", subtitle: "Quoted Service Provider", kind: "agent" } },
  { id: "agent001", type: "network", position: { x: 592, y: 338 }, data: { title: "Agent001", subtitle: "Negotiation · Payment · Decision", kind: "agent" } },
  { id: "x402-service", type: "network", position: { x: 920, y: 548 }, data: { title: "x402 Service Settlement", subtitle: "Pay service quote and unlock result", kind: "settlement" } },
  { id: "x402-api", type: "network", position: { x: 960, y: 230 }, data: { title: "x402 API Settlement", subtitle: "Pay API gate and unlock order request", kind: "settlement" } },
  { id: "trading-api", type: "network", position: { x: 1270, y: 338 }, data: { title: "API", subtitle: "Order Execution API", kind: "api" } },
];

export const GENERAL_NETWORK_EDGES: Edge<NetworkEdgeData>[] = [
  { id: "erc-other", type: "glow", source: "erc8004", target: "other-agent", sourceHandle: "s-left", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "", channel: "erc8004", curvature: 0.3 } },
  { id: "erc-agent001", type: "glow", source: "erc8004", target: "agent001", sourceHandle: "s-bottom", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.erc8004 }, data: { label: "", channel: "erc8004", curvature: 0.24 } },
  {
    id: "dm-bi",
    type: "glow",
    source: "agent001",
    target: "other-agent",
    sourceHandle: "s-left",
    targetHandle: "t-right",
    markerStart: { type: MarkerType.ArrowClosed, color: COLORS.xmtp },
    markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.xmtp },
    data: {
      label: "",
      channel: "xmtp",
      curvature: 0.18,
      leftHint: "Other Agent -> Agent001: quote/result DM",
      rightHint: "Agent001 -> Other Agent: task/quote DM",
      leftHintOffsetY: 22,
      rightHintOffsetY: -24,
    },
  },
  { id: "pay-to-x402-service", type: "glow", source: "agent001", target: "x402-service", sourceHandle: "s-bottom", targetHandle: "t-top", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "③ x402 pay + proof (service)", channel: "x402", labelOffsetY: -6, curvature: 0.24 } },
  { id: "unlock-other", type: "glow", source: "x402-service", target: "other-agent", sourceHandle: "s-left", targetHandle: "t-bottom", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "④ unlock service", channel: "x402", labelOffsetX: -22, labelOffsetY: -18, curvature: 0.34 } },
  { id: "pay-to-x402-api", type: "glow", source: "agent001", target: "x402-api", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "⑥ x402 pay + proof (API)", channel: "x402", labelOffsetY: -22, curvature: 0.2 } },
  { id: "unlock-api", type: "glow", source: "x402-api", target: "trading-api", sourceHandle: "s-right", targetHandle: "t-left", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.x402 }, data: { label: "⑥ unlock API order channel", channel: "x402", labelOffsetY: 18, curvature: 0.2 } },
  { id: "api-to-agent", type: "glow", source: "trading-api", target: "agent001", sourceHandle: "s-left", targetHandle: "t-right", markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.api }, data: { label: "⑥ API result + receiptRef", channel: "api", labelOffsetY: -18, curvature: 0.24 } },
];

function highlights(step: FlowStepId, quoteAccepted: boolean | null, shouldOrder: boolean | null, demoView: DemoView) {
  if (demoView === "general") {
    if (step === "erc8004_verify") return { nodes: ["erc8004", "agent001", "other-agent"], edges: ["erc-other", "erc-agent001"] };
    if (step === "xmtp_quote_request") return { nodes: ["agent001", "other-agent"], edges: ["dm-bi"] };
    if (step === "xmtp_quote_return") return { nodes: ["agent001", "other-agent"], edges: ["dm-bi"] };
    if (step === "x402_settlement") {
      if (quoteAccepted === false) return { nodes: ["agent001"], edges: [] };
      return { nodes: ["agent001", "x402-service", "other-agent"], edges: ["pay-to-x402-service", "unlock-other"] };
    }
    if (step === "xmtp_service_result") {
      if (quoteAccepted === false) return { nodes: ["agent001"], edges: [] };
      return { nodes: ["agent001", "other-agent"], edges: ["dm-bi"] };
    }
    if (step === "api_order_decision") {
      if (quoteAccepted === false) return { nodes: ["agent001"], edges: [] };
      if (shouldOrder === false) return { nodes: ["agent001"], edges: [] };
      return { nodes: ["agent001", "x402-api", "trading-api"], edges: ["pay-to-x402-api", "unlock-api", "api-to-agent"] };
    }
    return { nodes: [], edges: [] };
  }

  if (step === "erc8004_verify") return { nodes: ["erc8004", "agent001", "message-agent", "technical-agent"], edges: ["erc-msg", "erc-tech", "erc-agent001"] };
  if (step === "xmtp_quote_request") return { nodes: ["agent001", "message-agent", "technical-agent"], edges: ["quote-req-msg", "quote-req-tech"] };
  if (step === "xmtp_quote_return") return { nodes: ["agent001", "message-agent", "technical-agent"], edges: ["quote-res-msg", "quote-res-tech"] };
  if (step === "x402_settlement") {
    if (quoteAccepted === false) return { nodes: ["agent001"], edges: [] };
    return { nodes: ["agent001", "x402-service", "message-agent", "technical-agent"], edges: ["pay-to-x402-service", "unlock-msg", "unlock-tech"] };
  }
  if (step === "xmtp_service_result") {
    if (quoteAccepted === false) return { nodes: ["agent001"], edges: [] };
    return { nodes: ["agent001", "message-agent", "technical-agent"], edges: ["result-msg", "result-tech"] };
  }
  if (step === "api_order_decision") {
    if (quoteAccepted === false) return { nodes: ["agent001"], edges: [] };
    if (shouldOrder === false) return { nodes: ["agent001"], edges: [] };
    return { nodes: ["agent001", "x402-api", "trading-api"], edges: ["pay-to-x402-api", "unlock-api", "api-to-agent"] };
  }
  return { nodes: [], edges: [] };
}

const nodeTypes = { network: NetworkNode };
const edgeTypes = { glow: GlowEdge };

export default function AgentNetwork({ backendBaseUrl, auditMaxEntries = 200 }: AgentNetworkProps) {
  const mode: FlowMode = "unified";
  const [lang, setLang] = useState<Language>("zh");
  const [demoView, setDemoView] = useState<DemoView>("detailed");
  const [nodes, setNodes, onNodesChange] = useNodesState(NETWORK_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(NETWORK_EDGES);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [stepIndex, setStepIndex] = useState(-1);
  const [activeNodeIds, setActiveNodeIds] = useState<string[]>([]);
  const [activeEdgeIds, setActiveEdgeIds] = useState<string[]>([]);
  const [revealedEdgeIds, setRevealedEdgeIds] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [dmOpen, setDmOpen] = useState(false);
  const [x402Phase, setX402Phase] = useState<PaymentPhase>("challenge");
  const [forceOrderDemo, setForceOrderDemo] = useState(false);
  const [quoteAccepted, setQuoteAccepted] = useState<boolean | null>(null);
  const [shouldOrder, setShouldOrder] = useState<boolean | null>(null);
  const [decision, setDecision] = useState("Pending quote negotiation.");
  const [verificationHash, setVerificationHash] = useState("");
  const [messageQuote, setMessageQuote] = useState(0);
  const [technicalQuote, setTechnicalQuote] = useState(0);
  const [messageSnippet, setMessageSnippet] = useState("");
  const [technicalSnippet, setTechnicalSnippet] = useState("");
  const [infoSnippetExpanded, setInfoSnippetExpanded] = useState(false);
  const [technicalSnippetExpanded, setTechnicalSnippetExpanded] = useState(false);
  const [messageScore, setMessageScore] = useState(0);
  const [technicalScore, setTechnicalScore] = useState(0);
  const [receiptRef, setReceiptRef] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [serviceEvidenceIds, setServiceEvidenceIds] = useState<{ info: string; technical: string }>({ info: "", technical: "" });
  const [apiEvidenceRequestId, setApiEvidenceRequestId] = useState("");
  const [agent001Decision, setAgent001Decision] = useState<Agent001Decision | null>(null);
  const [downloadingEvidence, setDownloadingEvidence] = useState(false);
  const [evidenceHint, setEvidenceHint] = useState("");
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [candleSource, setCandleSource] = useState("pending");
  const [marketError, setMarketError] = useState("");
  const [positionScope, setPositionScope] = useState<"btc" | "all">("btc");
  const [positionItems, setPositionItems] = useState<PositionItem[]>([]);
  const [openOrderItems, setOpenOrderItems] = useState<OpenOrderItem[]>([]);
  const [accountSummary, setAccountSummary] = useState<Record<string, unknown>>({});
  const [marketUpdatedAt, setMarketUpdatedAt] = useState("");
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [infoRawResult, setInfoRawResult] = useState<Record<string, unknown> | null>(null);
  const [technicalRawResult, setTechnicalRawResult] = useState<Record<string, unknown> | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executingPlan, setExecutingPlan] = useState(false);
  const [executeError, setExecuteError] = useState("");
  const [executeResult, setExecuteResult] = useState<{ requestId: string; txHash: string; summary: string }>({
    requestId: "",
    txHash: "",
    summary: "",
  });
  const [planHistory, setPlanHistory] = useState<PlanHistoryItem[]>([]);
  const [activePlanHistoryId, setActivePlanHistoryId] = useState("");
  const [currentLiveRun, setCurrentLiveRun] = useState<RealServiceRun | null>(null);
  const [planHistoryOpen, setPlanHistoryOpen] = useState(false);
  const [planDetailsOpen, setPlanDetailsOpen] = useState(false);
  const [executionDraft, setExecutionDraft] = useState<ExecutionDraft>({
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "market",
    tif: "Ioc",
    size: 0.001,
    entryPrice: null,
    takeProfit: null,
    stopLoss: null,
  });

  const timerRef = useRef<number | null>(null);
  const x402TimerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const playbackRef = useRef<PlaybackState>("idle");
  const quoteAcceptedRef = useRef<boolean | null>(null);
  const shouldOrderRef = useRef<boolean | null>(null);
  const liveServiceRunRef = useRef<RealServiceRun | null>(null);
  const liveServiceRunPromiseRef = useRef<Promise<RealServiceRun> | null>(null);
  const marketTimerRef = useRef<number | null>(null);
  const candleChartContainerRef = useRef<HTMLDivElement | null>(null);
  const candleChartRef = useRef<CandleChartHandle | null>(null);
  const candleSeriesRef = useRef<CandleSeriesHandle | null>(null);
  const baseUrl =
    resolveBackendBaseUrl(backendBaseUrl);
  const tr = useCallback((zh: string, en: string) => (lang === "zh" ? zh : en), [lang]);
  const flowSteps = useMemo<FlowStep[]>(
    () =>
      FLOW_STEPS.map((step) => {
        if (lang === "en") return step;
        const zhTitleById: Record<FlowStepId, string> = {
          erc8004_verify: "步骤 1 · ERC8004 验证",
          xmtp_quote_request: "步骤 2 · XMTP 报价请求",
          xmtp_quote_return: "步骤 3 · XMTP 报价返回",
          x402_settlement: "步骤 4 · x402 支付结算",
          xmtp_service_result: "步骤 5 · XMTP 服务结果回传",
          api_order_decision: "步骤 6 · Agent001 API 下单决策",
        };
        const zhDescById: Record<FlowStepId, string> = {
          erc8004_verify: "Agent001 在链上校验协作 Agent 身份与可用性。",
          xmtp_quote_request: "Agent001 通过 DM 向消息面与技术面 Agent 请求报价。",
          xmtp_quote_return: "协作 Agent 返回报价，Agent001 判断是否支付。",
          x402_settlement: "challenge -> pay+proof -> unlock 的支付解锁流程。",
          xmtp_service_result: "支付后，服务结果通过 DM 返回给 Agent001。",
          api_order_decision: "Agent001 决策是否调用交易 API，并通过 x402 结算 API 访问。",
        };
        return {
          ...step,
          title: zhTitleById[step.id],
          description: zhDescById[step.id],
        };
      }),
    [lang]
  );
  const x402PhaseLabel = useMemo(() => {
    if (lang === "en") return x402Phase;
    const map: Record<PaymentPhase, string> = {
      challenge: "挑战",
      "pay+proof": "支付+证明",
      verify: "验证",
      unlock: "解锁",
    };
    return map[x402Phase];
  }, [lang, x402Phase]);
  const infoPreviewLines = useMemo(() => buildInfoPreviewLines(infoRawResult), [infoRawResult]);
  const technicalPreviewLines = useMemo(
    () => buildTechnicalPreviewLines(technicalRawResult),
    [technicalRawResult]
  );
  const infoRawText = useMemo(
    () => JSON.stringify(infoRawResult || {}, null, 2),
    [infoRawResult]
  );
  const technicalRawText = useMemo(
    () => JSON.stringify(technicalRawResult || {}, null, 2),
    [technicalRawResult]
  );

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);
  useEffect(() => {
    quoteAcceptedRef.current = quoteAccepted;
  }, [quoteAccepted]);
  useEffect(() => {
    shouldOrderRef.current = shouldOrder;
  }, [shouldOrder]);

  const abortFlow = useCallback((reason: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
    playbackRef.current = "completed";
    setPlayback("completed");
    if (reason) setDecision(reason);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
      if (marketTimerRef.current) window.clearInterval(marketTimerRef.current);
      if (candleChartRef.current) {
        candleChartRef.current.remove();
        candleChartRef.current = null;
        candleSeriesRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PLAN_HISTORY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const rows = parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const row = item as Record<string, unknown>;
          const planRaw = row["plan"] && typeof row["plan"] === "object" ? (row["plan"] as Record<string, unknown>) : {};
          return {
            id: String(row["id"] || "").trim(),
            createdAt: String(row["createdAt"] || "").trim(),
            version: String(row["version"] || "v1.1-en").trim() || "v1.1-en",
            requestId: String(row["requestId"] || "").trim(),
            traceId: String(row["traceId"] || "").trim(),
            decision: String(row["decision"] || "").trim(),
            reason: String(row["reason"] || "").trim(),
            shouldPlaceOrder: Boolean(row["shouldPlaceOrder"]),
            plan: {
              symbol: String(planRaw["symbol"] || "BTCUSDT").trim().toUpperCase() || "BTCUSDT",
              side: String(planRaw["side"] || "").trim().toLowerCase(),
              orderType: String(planRaw["orderType"] || "limit").trim().toLowerCase() || "limit",
              tif: String(planRaw["tif"] || "").trim(),
              size: Number.isFinite(Number(planRaw["size"])) ? Number(planRaw["size"]) : null,
              entryPrice: Number.isFinite(Number(planRaw["entryPrice"])) ? Number(planRaw["entryPrice"]) : null,
              takeProfit: Number.isFinite(Number(planRaw["takeProfit"])) ? Number(planRaw["takeProfit"]) : null,
              stopLoss: Number.isFinite(Number(planRaw["stopLoss"])) ? Number(planRaw["stopLoss"]) : null,
            },
            executed: Boolean(row["executed"]),
            executeRequestId: String(row["executeRequestId"] || "").trim(),
            executeTxHash: String(row["executeTxHash"] || "").trim(),
            executeSummary: String(row["executeSummary"] || "").trim(),
          } as PlanHistoryItem;
        })
        .filter((row) => row.id);
      setPlanHistory(rows.slice(0, 30));
    } catch {
      // ignore malformed local cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PLAN_HISTORY_STORAGE_KEY, JSON.stringify(planHistory.slice(0, 30)));
    } catch {
      // ignore localStorage write failure
    }
  }, [planHistory]);

  useEffect(() => {
    const nextNodes = demoView === "general" ? GENERAL_NETWORK_NODES : NETWORK_NODES;
    const nextEdges = demoView === "general" ? GENERAL_NETWORK_EDGES : NETWORK_EDGES;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setPlayback("idle");
    setStepIndex(-1);
    setActiveNodeIds([]);
    setActiveEdgeIds([]);
    setRevealedEdgeIds([]);
    setAudit([]);
    setDmOpen(false);
    setQuoteAccepted(null);
    quoteAcceptedRef.current = null;
    setShouldOrder(null);
    shouldOrderRef.current = null;
    setDecision("Pending quote negotiation.");
    setVerificationHash("");
    setMessageQuote(0);
    setTechnicalQuote(0);
    setMessageSnippet("");
    setTechnicalSnippet("");
    setMessageScore(0);
    setTechnicalScore(0);
    setReceiptRef("");
    setServiceEvidenceIds({ info: "", technical: "" });
    setApiEvidenceRequestId("");
    setAgent001Decision(null);
    setEvidenceHint("");
    setPlanError("");
    setInfoRawResult(null);
    setTechnicalRawResult(null);
    setConfirmOpen(false);
    setExecuteError("");
    setExecuteResult({ requestId: "", txHash: "", summary: "" });
    setCurrentLiveRun(null);
    setExecutionDraft({
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "market",
      tif: "Ioc",
      size: 0.001,
      entryPrice: null,
      takeProfit: null,
      stopLoss: null,
    });
    liveServiceRunRef.current = null;
    liveServiceRunPromiseRef.current = null;
  }, [demoView, setEdges, setNodes]);

  useEffect(() => {
    setInfoSnippetExpanded(false);
  }, [messageSnippet]);

  useEffect(() => {
    setTechnicalSnippetExpanded(false);
  }, [technicalSnippet]);

  const appendAudit = useCallback(
    (entry: Omit<AuditLogEntry, "id" | "tsISO" | "tsLocal">) => {
      const now = new Date();
      const row: AuditLogEntry = {
        ...entry,
        id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
        tsISO: now.toISOString(),
        tsLocal: now.toLocaleString("en-US", {
          hour12: false,
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 3,
        }),
      };
      // Keep newest entries on top so each new run feels live and refreshed.
      setAudit((prev) => [row, ...prev].slice(0, auditMaxEntries));
    },
    [auditMaxEntries]
  );

  const waitUi = useCallback((ms = 0) => {
    const timeout = Math.max(0, Math.min(Number(ms || 0), 3_000));
    if (timeout <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => window.setTimeout(resolve, timeout));
  }, []);

  const syncFlowVisual = useCallback(
    (stepId: FlowStepId, playing = true) => {
      const idx = flowSteps.findIndex((item) => item.id === stepId);
      if (idx >= 0) setStepIndex(idx);
      const hi = highlights(stepId, quoteAcceptedRef.current, shouldOrderRef.current, demoView);
      setActiveNodeIds(hi.nodes);
      setActiveEdgeIds(hi.edges);
      if (hi.edges.length > 0) {
        setRevealedEdgeIds((prev) => Array.from(new Set([...prev, ...hi.edges])));
      }
      if (playing) setPlayback("playing");
    },
    [demoView, flowSteps]
  );

  const startWorkflowProgressStream = useCallback(
    (ids: WorkflowRunIds): WorkflowStreamHandle => {
      const params = new URLSearchParams({
        traceId: ids.traceId,
        requestId: ids.requestId,
        infoTaskId: ids.infoTaskId,
        technicalTaskId: ids.technicalTaskId,
        waitMs: "180000",
        x402MinVisibleMs: "3500",
      });
      const streamUrl = `${baseUrl}/api/network/demo/router-info-technical/stream?${params.toString()}`;
      const es = new EventSource(streamUrl);
      let resolved = false;
      let resolveDone: (() => void) | null = null;
      const done = new Promise<void>((resolve) => {
        resolveDone = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
      });
      const parsePayload = (event: MessageEvent): Record<string, unknown> => {
        try {
          const parsed = JSON.parse(String(event.data || "{}"));
          return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
        } catch {
          return {};
        }
      };
      const handleStep = (event: MessageEvent) => {
        const payload = parsePayload(event);
        const stepId = String(payload.stepId || "").trim() as FlowStepId;
        const status = String(payload.status || "").trim().toLowerCase();
        if (stepId === "xmtp_service_result" && status === "completed") {
          const message = String(payload.message || "").trim();
          if (message) setDecision(message);
          return;
        }
        if (
          stepId === "erc8004_verify" ||
          stepId === "xmtp_quote_request" ||
          stepId === "xmtp_quote_return" ||
          stepId === "x402_settlement" ||
          stepId === "xmtp_service_result" ||
          stepId === "api_order_decision"
        ) {
          syncFlowVisual(stepId, true);
        }
        const phase = String(payload.phase || "").trim() as PaymentPhase;
        if (phase === "challenge" || phase === "pay+proof" || phase === "verify" || phase === "unlock") {
          setX402Phase(phase);
        }
        const message = String(payload.message || "").trim();
        if (message) setDecision(message);
      };
      const handleTimeout = (event: MessageEvent) => {
        const payload = parsePayload(event);
        const reason = String(payload.reason || payload.error || "stream_watch_timeout").trim();
        if (reason) setDecision(`Stream warning: ${reason}`);
        if (resolveDone) resolveDone();
      };
      es.addEventListener("step", handleStep as EventListener);
      es.addEventListener("timeout", handleTimeout as EventListener);
      es.addEventListener("done", () => {
        if (resolveDone) resolveDone();
      });
      es.onerror = () => {
        if (resolveDone) resolveDone();
      };
      return {
        done,
        stop: () => {
          if (resolveDone) resolveDone();
          try {
            es.close();
          } catch {
            // noop
          }
        },
      };
    },
    [baseUrl, syncFlowVisual]
  );

  const addPlanHistoryFromLive = useCallback((live: RealServiceRun) => {
    const decision = live.agent001Decision;
    if (!decision) return "";
    const id = `plan_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const row: PlanHistoryItem = {
      id,
      createdAt: new Date().toISOString(),
      version: String(decision.version || "v1.1-en").trim() || "v1.1-en",
      requestId: String(live.requestId || "").trim(),
      traceId: String(live.traceId || "").trim(),
      decision: String(decision.decision || "").trim(),
      reason: String(decision.reason || decision.text || "").trim(),
      shouldPlaceOrder: Boolean(decision.shouldPlaceOrder),
      plan: {
        symbol: String(decision.plan.symbol || "BTCUSDT").trim().toUpperCase() || "BTCUSDT",
        side: String(decision.plan.side || "").trim().toLowerCase(),
        orderType: String(decision.plan.orderType || "limit").trim().toLowerCase() || "limit",
        tif: String(decision.plan.tif || "").trim(),
        size: Number.isFinite(Number(decision.plan.size)) ? Number(decision.plan.size) : null,
        entryPrice: Number.isFinite(Number(decision.plan.entryPrice)) ? Number(decision.plan.entryPrice) : null,
        takeProfit: Number.isFinite(Number(decision.plan.takeProfit)) ? Number(decision.plan.takeProfit) : null,
        stopLoss: Number.isFinite(Number(decision.plan.stopLoss)) ? Number(decision.plan.stopLoss) : null,
      },
      executed: false,
      executeRequestId: "",
      executeTxHash: "",
      executeSummary: "",
    };
    setPlanHistory((prev) => [row, ...prev].slice(0, 30));
    setActivePlanHistoryId(id);
    return id;
  }, []);

  const markPlanHistoryExecuted = useCallback(
    ({ requestId, txHash, summary }: { requestId: string; txHash: string; summary: string }) => {
      const normalizedRequestId = String(requestId || "").trim();
      const normalizedTxHash = String(txHash || "").trim();
      const normalizedSummary = String(summary || "").trim();
      setPlanHistory((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        let target = next.findIndex((item) => item.id === activePlanHistoryId);
        if (target < 0) target = 0;
        if (target < 0 || target >= next.length) return prev;
        next[target] = {
          ...next[target],
          executed: true,
          executeRequestId: normalizedRequestId || next[target].executeRequestId,
          executeTxHash: normalizedTxHash || next[target].executeTxHash,
          executeSummary: normalizedSummary || next[target].executeSummary,
        };
        return next.slice(0, 30);
      });
    },
    [activePlanHistoryId]
  );

  const resolveTraceIdByRequestId = useCallback(
    async (requestId: string): Promise<string> => {
      const normalized = normalizeRequestId(requestId);
      if (!normalized) return "";
      try {
        const data = await fetchJSON<{ traceId?: string }>(
          `${baseUrl}/api/demo/trace-by-request/${encodeURIComponent(normalized)}`,
          {},
          15_000
        );
        return String(data?.traceId || "").trim();
      } catch {
        return "";
      }
    },
    [baseUrl]
  );

  const fetchEvidenceByTraceId = useCallback(
    async (traceId: string): Promise<unknown> => {
      const normalized = String(traceId || "").trim();
      if (!normalized) return null;
      const data = await fetchJSON<{ evidence?: unknown }>(
        `${baseUrl}/api/evidence/export?traceId=${encodeURIComponent(normalized)}`,
        {},
        20_000
      );
      return data?.evidence ?? null;
    },
    [baseUrl]
  );

  const downloadJson = useCallback((fileName: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const buildEvidencePack = useCallback(
    async (sourceRequestIds: Array<{ source: EvidenceArtifact["source"]; requestId: string }>): Promise<EvidenceArtifact[]> => {
      const normalized = sourceRequestIds
        .map((item) => ({ source: item.source, requestId: normalizeRequestId(item.requestId) }))
        .filter((item) => item.requestId.length > 0);
      const unique = new Map<string, EvidenceArtifact["source"]>();
      for (const row of normalized) {
        if (!unique.has(row.requestId)) unique.set(row.requestId, row.source);
      }

      const artifacts: EvidenceArtifact[] = [];
      for (const [requestId, source] of unique.entries()) {
        const traceId = await resolveTraceIdByRequestId(requestId);
        if (!traceId) continue;
        const evidence = await fetchEvidenceByTraceId(traceId);
        artifacts.push({ source, requestId, traceId, evidence });
      }
      return artifacts;
    },
    [fetchEvidenceByTraceId, resolveTraceIdByRequestId]
  );

  const fetchRequestTiming = useCallback(
    async (requestId: string): Promise<{ amount: number; paidAtIso: string }> => {
      const id = String(requestId || "").trim();
      if (!id) return { amount: 0, paidAtIso: "" };
      try {
        const data = await fetchJSON<{ items?: Array<Record<string, unknown>> }>(
          `${baseUrl}/api/x402/requests?requestId=${encodeURIComponent(id)}&limit=1`,
          {},
          20_000
        );
        const item = Array.isArray(data?.items) && data.items.length > 0 ? data.items[0] : null;
        const amountRaw = Number(item?.amount ?? 0);
        const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 0;
        const paidAtMs = parseTimestampMs(item?.paidAt) || parseTimestampMs(item?.updatedAt) || parseTimestampMs(item?.createdAt);
        return { amount, paidAtIso: toIsoFromMs(paidAtMs) };
      } catch {
        return { amount: 0, paidAtIso: "" };
      }
    },
    [baseUrl]
  );

  const ensureLiveServiceRun = useCallback(async (runIds: Partial<WorkflowRunIds> = {}): Promise<RealServiceRun> => {
    if (liveServiceRunRef.current) return liveServiceRunRef.current;
    if (liveServiceRunPromiseRef.current) return liveServiceRunPromiseRef.current;

    const runner = (async () => {
      const payload = {
        autoStart: true,
        bindRealX402: true,
        strictBinding: true,
        prebindOnly: false,
        retryOnTimeout: true,
        bindPayment: "real",
        strictRealPayment: true,
        mode: "real",
        waitMs: 120_000,
        symbol: "BTCUSDT",
        source: "hyperliquid",
        horizonMin: 60,
        agent001Text: "Analyze BTCUSDT and decide whether to place an order. Provide reason and TP/SL if applicable.",
        topic: "BTC market sentiment and catalysts",
        maxChars: 900,
        infoInput: {
          url: "https://newshacker.me/",
          mode: "auto",
          maxChars: 900,
        },
        ...(runIds.traceId ? { traceId: String(runIds.traceId).trim() } : {}),
        ...(runIds.requestId ? { requestId: String(runIds.requestId).trim() } : {}),
        ...(runIds.infoTaskId ? { infoTaskId: String(runIds.infoTaskId).trim() } : {}),
        ...(runIds.technicalTaskId ? { technicalTaskId: String(runIds.technicalTaskId).trim() } : {}),
      };
      const result = await fetchJSON<Record<string, unknown>>(
        `${baseUrl}/api/network/demo/router-info-technical/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        240_000
      );
      if (!result || result.ok !== true) {
        throw new Error(`live_router_run_failed:${String(result?.["reason"] || result?.["error"] || "unknown")}`);
      }

      const paymentBinding =
        result["paymentBinding"] && typeof result["paymentBinding"] === "object"
          ? (result["paymentBinding"] as Record<string, unknown>)
          : {};
      const infoBind =
        paymentBinding["info"] && typeof paymentBinding["info"] === "object"
          ? (paymentBinding["info"] as Record<string, unknown>)
          : {};
      const technicalBind =
        paymentBinding["technical"] && typeof paymentBinding["technical"] === "object"
          ? (paymentBinding["technical"] as Record<string, unknown>)
          : {};

      const tasks = toRecord(result["tasks"]) || {};
      const infoTask = toRecord(tasks["info"]) || {};
      const technicalTask = toRecord(tasks["technical"]) || {};
      const infoTaskResult = toRecord(infoTask["taskResult"]) || {};
      const technicalTaskResult = toRecord(technicalTask["taskResult"]) || {};
      const infoTaskResultPayload = toRecord(infoTaskResult["result"]) || {};
      const technicalTaskResultPayload = toRecord(technicalTaskResult["result"]) || {};

      const analysis = toRecord(result["analysis"]) || {};
      const infoAnalysisPrimary = toRecord(analysis["info"]) || {};
      const technicalAnalysisPrimary = toRecord(analysis["technical"]) || {};
      const infoAnalysis = pickFirstObject(
        infoAnalysisPrimary,
        toRecord(infoTaskResultPayload["info"]),
        toRecord(infoTaskResultPayload["analysis"]),
        toRecord(toRecord(infoTaskResultPayload["reader"])?.["analysis"]),
      );
      const technicalAnalysis = pickFirstObject(
        technicalAnalysisPrimary,
        toRecord(technicalTaskResultPayload["analysis"]),
        toRecord(technicalTaskResultPayload["technical"]),
        toRecord(technicalTaskResultPayload["risk"]),
      );

      const summary = result["summary"] && typeof result["summary"] === "object" ? (result["summary"] as Record<string, unknown>) : {};
      const warnings = Array.isArray(result["warnings"])
        ? result["warnings"].map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const agent001DecisionRaw =
        result["agent001Decision"] && typeof result["agent001Decision"] === "object"
          ? (result["agent001Decision"] as Record<string, unknown>)
          : null;
      const decisionPlanRaw =
        agent001DecisionRaw && agent001DecisionRaw["plan"] && typeof agent001DecisionRaw["plan"] === "object"
          ? (agent001DecisionRaw["plan"] as Record<string, unknown>)
          : {};
      const normalizedDecision: Agent001Decision | null = agent001DecisionRaw
        ? {
            shouldPlaceOrder: Boolean(agent001DecisionRaw["shouldPlaceOrder"]),
            decision: sanitizeMojibakeDisplay(agent001DecisionRaw["decision"]),
            reason: sanitizeMojibakeDisplay(agent001DecisionRaw["reason"]),
            text: sanitizeMojibakeDisplay(agent001DecisionRaw["text"]),
            version: String(agent001DecisionRaw["version"] || agent001DecisionRaw["planVersion"] || "v1.1-en").trim() || "v1.1-en",
            generatedAt: String(agent001DecisionRaw["generatedAt"] || "").trim(),
            plan: {
              symbol: String(decisionPlanRaw["symbol"] || "BTCUSDT").trim().toUpperCase() || "BTCUSDT",
              side: String(decisionPlanRaw["side"] || "").trim().toLowerCase(),
              orderType: String(decisionPlanRaw["orderType"] || "limit").trim().toLowerCase() || "limit",
              tif: String(decisionPlanRaw["tif"] || "").trim(),
              size: Number.isFinite(Number(decisionPlanRaw["size"])) ? Number(decisionPlanRaw["size"]) : null,
              entryPrice: Number.isFinite(Number(decisionPlanRaw["entryPrice"])) ? Number(decisionPlanRaw["entryPrice"]) : null,
              takeProfit: Number.isFinite(Number(decisionPlanRaw["takeProfit"])) ? Number(decisionPlanRaw["takeProfit"]) : null,
              stopLoss: Number.isFinite(Number(decisionPlanRaw["stopLoss"])) ? Number(decisionPlanRaw["stopLoss"]) : null,
            },
            forceOrderRequested: Boolean(agent001DecisionRaw["forceOrderRequested"]),
            explicitOrderRequested: Boolean(agent001DecisionRaw["explicitOrderRequested"]),
          }
        : null;

      const infoRequestId = String(infoBind["requestId"] || "").trim();
      const technicalRequestId = String(technicalBind["requestId"] || "").trim();
      const infoTxHash = String(infoBind["txHash"] || "").trim();
      const technicalTxHash = String(technicalBind["txHash"] || "").trim();
      if (!infoRequestId || !technicalRequestId) {
        throw new Error("live_router_run_missing_payment_binding");
      }
      const infoStrict = /^0x[a-fA-F0-9]{64}$/.test(infoTxHash);
      const technicalStrict = /^0x[a-fA-F0-9]{64}$/.test(technicalTxHash);
      if (!infoStrict || !technicalStrict) {
        warnings.push("x402_strict_evidence_missing_fallback_mock");
      }

      const [infoTiming, technicalTiming] = await Promise.all([
        fetchRequestTiming(infoRequestId),
        fetchRequestTiming(technicalRequestId),
      ]);
      const infoConfidenceRaw = Number(infoAnalysis["confidence"] ?? 0);
      const technicalConfidenceRaw = Number(technicalAnalysis["confidence"] ?? 0);
      const infoConfidence = Number.isFinite(infoConfidenceRaw) ? Number(infoConfidenceRaw.toFixed(3)) : 0;
      const technicalConfidence = Number.isFinite(technicalConfidenceRaw) ? Number(technicalConfidenceRaw.toFixed(3)) : 0;
      const infoFailureReason = String(
        toRecord(infoTask["failure"])?.["reason"] ||
        infoTaskResult["error"] ||
        ""
      ).trim();
      const technicalFailureReason = String(
        toRecord(technicalTask["failure"])?.["reason"] ||
        technicalTaskResult["error"] ||
        ""
      ).trim();
      const infoSummary =
        sanitizeMojibakeDisplay(
          summary["infoSummary"] ||
          infoAnalysis["summary"] ||
          infoTaskResultPayload["summary"] ||
          infoFailureReason ||
          ""
        ) || "Info agent result pending or unavailable.";
      const technicalSummary =
        sanitizeMojibakeDisplay(
          summary["technicalSummary"] ||
          technicalAnalysis["summary"] ||
          technicalTaskResultPayload["summary"] ||
          technicalFailureReason ||
          ""
        ) || "Technical agent result pending or unavailable.";

      const normalizedInfoRaw = hasObjectPayload(infoAnalysis)
        ? infoAnalysis
        : {
            status: String(infoTask["status"] || "").trim() || "unknown",
            reason: infoFailureReason || "info_result_not_available",
            taskId: String(infoTask["taskId"] || "").trim(),
          };
      const normalizedTechnicalRaw = hasObjectPayload(technicalAnalysis)
        ? technicalAnalysis
        : {
            status: String(technicalTask["status"] || "").trim() || "unknown",
            reason: technicalFailureReason || "technical_result_not_available",
            taskId: String(technicalTask["taskId"] || "").trim(),
          };

      const normalized: RealServiceRun = {
        traceId: String(result["command"] && typeof result["command"] === "object" ? (result["command"] as Record<string, unknown>)["traceId"] || "" : "").trim(),
        requestId: String(result["command"] && typeof result["command"] === "object" ? (result["command"] as Record<string, unknown>)["requestId"] || "" : "").trim(),
        info: {
          requestId: infoRequestId,
          txHash: infoTxHash,
          paidAtIso: infoTiming.paidAtIso || String(infoBind["verifiedAt"] || "").trim(),
          amount: infoTiming.amount,
          summary: infoSummary,
          confidence: infoConfidence,
        },
        technical: {
          requestId: technicalRequestId,
          txHash: technicalTxHash,
          paidAtIso: technicalTiming.paidAtIso || String(technicalBind["verifiedAt"] || "").trim(),
          amount: technicalTiming.amount,
          summary: technicalSummary,
          confidence: technicalConfidence,
        },
        agent001Decision: normalizedDecision,
        infoRaw: normalizedInfoRaw,
        technicalRaw: normalizedTechnicalRaw,
        warnings,
      };

      liveServiceRunRef.current = normalized;
      return normalized;
    })();

    liveServiceRunPromiseRef.current = runner;
    try {
      return await runner;
    } finally {
      liveServiceRunPromiseRef.current = null;
    }
  }, [baseUrl, fetchRequestTiming]);

  const fetchCandles = useCallback(async () => {
    const data = await fetchJSON<{
      candles?: CandlePoint[];
      source?: string;
      fallbackReason?: string;
    }>(
      `${baseUrl}/api/hyperliquid/testnet/candles?symbol=BTCUSDT&interval=1m&limit=220&source=auto`,
      {},
      20_000
    );
    const rows = Array.isArray(data?.candles) ? data.candles : [];
    setCandles(
      rows
        .map((row) => ({
          time: Math.max(0, Math.floor(toFiniteNumber(row.time, 0))),
          open: toFiniteNumber(row.open),
          high: toFiniteNumber(row.high),
          low: toFiniteNumber(row.low),
          close: toFiniteNumber(row.close),
          volume: toFiniteNumber(row.volume),
        }))
        .filter((row) => row.time > 0 && row.high > 0 && row.low > 0 && row.open > 0 && row.close > 0)
    );
    setCandleSource(String(data?.source || "unknown").trim() || "unknown");
    const fallbackReason = String(data?.fallbackReason || "").trim();
    if (fallbackReason) {
      setMarketError(`Candle fallback: ${fallbackReason}`);
    }
  }, [baseUrl]);

  const fetchPositions = useCallback(async () => {
    const data = await fetchJSON<{
      positions?: PositionItem[];
      openOrders?: { items?: OpenOrderItem[] };
      account?: Record<string, unknown>;
      openOrdersError?: string;
    }>(
      `${baseUrl}/api/hyperliquid/testnet/positions?symbol=BTCUSDT&scope=${encodeURIComponent(positionScope)}&includeOpenOrders=true`,
      {},
      20_000
    );
    const rows = Array.isArray(data?.positions) ? data.positions : [];
    setPositionItems(
      rows.map((row) => ({
        symbol: String(row?.symbol || "BTCUSDT").trim().toUpperCase(),
        side: String(row?.side || "").trim(),
        signedSize: toFiniteNumber(row?.signedSize, 0),
        size: Math.abs(toFiniteNumber(row?.signedSize, 0)),
        entryPrice: toNumberOrNull(row?.entryPrice),
        markPrice: toNumberOrNull(row?.markPrice),
        unrealizedPnl: toNumberOrNull(row?.unrealizedPnl),
        leverage: toNumberOrNull(row?.leverage),
        liquidationPrice: toNumberOrNull(row?.liquidationPrice),
      }))
    );
    const orders = Array.isArray(data?.openOrders?.items) ? data.openOrders.items : [];
    setOpenOrderItems(orders);
    setAccountSummary(data?.account && typeof data.account === "object" ? data.account : {});
    if (data?.openOrdersError) {
      setMarketError(`Open orders warning: ${data.openOrdersError}`);
    }
  }, [baseUrl, positionScope]);

  const refreshMarket = useCallback(async () => {
    try {
      await Promise.all([fetchCandles(), fetchPositions()]);
      setMarketUpdatedAt(new Date().toISOString());
    } catch (error) {
      setMarketError(friendlyErrorMessage(error));
    }
  }, [fetchCandles, fetchPositions]);

  const fetchCurrentTradePlan = useCallback(async () => {
    setPlanning(true);
    setPlanError("");
    setExecuteError("");
    setPlanDetailsOpen(false);
    setAudit([]);
    setStepIndex(-1);
    setActiveNodeIds([]);
    setActiveEdgeIds([]);
    setRevealedEdgeIds([]);
    setDmOpen(false);
    setQuoteAccepted(null);
    quoteAcceptedRef.current = null;
    setShouldOrder(null);
    shouldOrderRef.current = null;
    setVerificationHash("");
    setMessageQuote(0);
    setTechnicalQuote(0);
    setMessageSnippet("");
    setTechnicalSnippet("");
    setMessageScore(0);
    setTechnicalScore(0);
    setReceiptRef("");
    setExecuteResult({ requestId: "", txHash: "", summary: "" });
    setExecutionDraft({
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "market",
      tif: "Ioc",
      size: 0.001,
      entryPrice: null,
      takeProfit: null,
      stopLoss: null,
    });
    setX402Phase("challenge");
    setDecision("XMTP DM negotiation started. Waiting for info/technical agent replies...");
    setPlayback("playing");
    const runIds: WorkflowRunIds = {
      traceId: createWorkflowRunId("router_it_trace"),
      requestId: createWorkflowRunId("router_it_req"),
      infoTaskId: createWorkflowRunId("router_it_info"),
      technicalTaskId: createWorkflowRunId("router_it_tech"),
    };
    syncFlowVisual("erc8004_verify", true);
    appendAudit({
      mode,
      stepId: "erc8004_verify",
      stepName: flowSteps.find((item) => item.id === "erc8004_verify")?.title || "Step 1",
      blockchainVerifiable: true,
      decisionBasis: "Manual plan fetch started. Syncing visual flow for live negotiation.",
      payload: { source: "manual_fetch_plan", phase: "start", ...runIds },
    });
    await waitUi(MANUAL_FETCH_ERC8004_HOLD_MS);
    syncFlowVisual("xmtp_quote_request", true);
    appendAudit({
      mode,
      stepId: "xmtp_quote_request",
      stepName: flowSteps.find((item) => item.id === "xmtp_quote_request")?.title || "Step 2",
      blockchainVerifiable: true,
      xmtpSnippet: "Agent001 started live XMTP DM negotiation for info/technical services.",
      payload: { source: "manual_fetch_plan", phase: "dispatch_dm", ...runIds },
    });
    // Force a fresh live run for each manual fetch and clear stale UI first.
    liveServiceRunRef.current = null;
    liveServiceRunPromiseRef.current = null;
    setCurrentLiveRun(null);
    setAgent001Decision(null);
    setMessageSnippet("");
    setTechnicalSnippet("");
    setMessageScore(0);
    setTechnicalScore(0);
    setInfoRawResult(null);
    setTechnicalRawResult(null);
    setServiceEvidenceIds({ info: "", technical: "" });
    setApiEvidenceRequestId("");
    let streamHandle: WorkflowStreamHandle = { stop: () => {}, done: Promise.resolve() };
    try {
      streamHandle = startWorkflowProgressStream(runIds);
      const live = await ensureLiveServiceRun(runIds);
      const mQuote = Number((live.info.amount || 0).toFixed(5));
      const tQuote = Number((live.technical.amount || 0).toFixed(5));
      setMessageQuote(mQuote);
      setTechnicalQuote(tQuote);
      setMessageSnippet(live.info.summary || "");
      setTechnicalSnippet(live.technical.summary || "");
      setMessageScore(live.info.confidence || 0);
      setTechnicalScore(live.technical.confidence || 0);
      setAgent001Decision(live.agent001Decision || null);
      setInfoRawResult(live.infoRaw || null);
      setTechnicalRawResult(live.technicalRaw || null);
      setCurrentLiveRun(live);
      setServiceEvidenceIds({
        info: normalizeRequestId(live.info.requestId),
        technical: normalizeRequestId(live.technical.requestId),
      });

      const total = Number((mQuote + tQuote).toFixed(5));
      const accepted = total <= QUOTE_CAP && mQuote > 0;
      setQuoteAccepted(accepted);
      quoteAcceptedRef.current = accepted;
      appendAudit({
        mode,
        stepId: "xmtp_quote_return",
        stepName: flowSteps.find((item) => item.id === "xmtp_quote_return")?.title || "Step 3",
        blockchainVerifiable: true,
        xmtpSnippet: `Live quote returned. info=${mQuote.toFixed(5)} technical=${tQuote.toFixed(5)} total=${total.toFixed(5)}`,
        decisionBasis: accepted ? "Quote accepted for paid service execution." : "Quote rejected by cap/availability.",
        payload: {
          source: "manual_fetch_plan",
          accepted,
          quoteCap: QUOTE_CAP,
          infoRequestId: live.info.requestId,
          technicalRequestId: live.technical.requestId,
        },
      });
      appendAudit({
        mode,
        stepId: "x402_settlement",
        stepName: flowSteps.find((item) => item.id === "x402_settlement")?.title || "Step 4",
        blockchainVerifiable: true,
        messageServiceTxHash: live.info.txHash || undefined,
        technicalServiceTxHash: live.technical.txHash || undefined,
        messageServicePaidAt: live.info.paidAtIso || undefined,
        technicalServicePaidAt: live.technical.paidAtIso || undefined,
        decisionBasis: "x402 payment proof loaded for info/technical branches.",
        payload: {
          source: "manual_fetch_plan",
          infoRequestId: live.info.requestId,
          technicalRequestId: live.technical.requestId,
          warnings: live.warnings,
        },
      });
      await Promise.race([streamHandle.done, waitUi(4500)]);
      syncFlowVisual("x402_settlement", true);
      setX402Phase("unlock");
      await waitUi(MANUAL_FETCH_X402_SETTLEMENT_HOLD_MS);
      syncFlowVisual("xmtp_service_result", true);
      appendAudit({
        mode,
        stepId: "xmtp_service_result",
        stepName: flowSteps.find((item) => item.id === "xmtp_service_result")?.title || "Step 5",
        blockchainVerifiable: true,
        xmtpSnippet: `Info: ${(live.info.summary || "").slice(0, 120)} | Technical: ${(live.technical.summary || "").slice(0, 120)}`,
        decisionBasis: "Live XMTP task-result received and shown in dashboard.",
        payload: {
          source: "manual_fetch_plan",
          infoSummary: live.info.summary,
          technicalSummary: live.technical.summary,
          infoConfidence: live.info.confidence,
          technicalConfidence: live.technical.confidence,
        },
      });
      await waitUi(MANUAL_FETCH_RESULT_HOLD_MS);
      const plan = live.agent001Decision?.plan || null;
      const side = String(plan?.side || "").trim().toLowerCase() === "sell" ? "sell" : "buy";
      const orderType = String(plan?.orderType || "").trim().toLowerCase() === "limit" ? "limit" : "market";
      const size = toFiniteNumber(plan?.size, 0.001);
      const entryPrice = toNumberOrNull(plan?.entryPrice);
      const takeProfit = toNumberOrNull(plan?.takeProfit);
      const stopLoss = toNumberOrNull(plan?.stopLoss);
      setExecutionDraft({
        symbol: String(plan?.symbol || "BTCUSDT").trim().toUpperCase() || "BTCUSDT",
        side,
        orderType,
        tif: String(plan?.tif || (orderType === "market" ? "Ioc" : "Gtc")).trim() || (orderType === "market" ? "Ioc" : "Gtc"),
        size: size > 0 ? size : 0.001,
        entryPrice: orderType === "limit" ? entryPrice : null,
        takeProfit,
        stopLoss,
      });
      setShouldOrder(Boolean(live.agent001Decision?.shouldPlaceOrder));
      shouldOrderRef.current = Boolean(live.agent001Decision?.shouldPlaceOrder);
      addPlanHistoryFromLive(live);
      const reason = String(live.agent001Decision?.reason || live.agent001Decision?.text || "").trim();
      setDecision(
        reason
          ? `Agent001 trade plan ready (awaiting manual execute): ${reason}`
          : `Agent001 trade plan ready (awaiting manual execute). Quotes total ${total.toFixed(5)}.`
      );
    } catch (error) {
      const reason = String((error as Error)?.message || "trade_plan_fetch_failed").trim();
      const hardenedReason =
        /bind_real_x402_failed|x402/i.test(reason)
          ? `Real x402 payment binding failed: ${reason}`
          : reason;
      setCurrentLiveRun(null);
      setPlanError(hardenedReason);
      setDecision(`Trade plan failed: ${hardenedReason}`);
      appendAudit({
        mode,
        stepId: "xmtp_quote_request",
        stepName: flowSteps.find((item) => item.id === "xmtp_quote_request")?.title || "Step 2",
        blockchainVerifiable: true,
        decisionBasis: `Manual fetch plan failed: ${hardenedReason}`,
        payload: { source: "manual_fetch_plan", error: hardenedReason },
      });
    } finally {
      streamHandle.stop();
      setPlayback("paused");
      setPlanning(false);
    }
  }, [addPlanHistoryFromLive, appendAudit, ensureLiveServiceRun, flowSteps, mode, startWorkflowProgressStream, syncFlowVisual, waitUi]);

  const executeTradePlan = useCallback(async () => {
    setConfirmOpen(false);
    setExecutingPlan(true);
    setExecuteError("");
    setPlayback("playing");
    setShouldOrder(true);
    shouldOrderRef.current = true;
    syncFlowVisual("api_order_decision", true);
    setX402Phase("challenge");
    appendAudit({
      mode,
      stepId: "api_order_decision",
      stepName: flowSteps.find((item) => item.id === "api_order_decision")?.title || "Step 6",
      blockchainVerifiable: true,
      decisionBasis: "Manual execute triggered. Starting x402 API settlement and ATAPI order execution.",
      payload: {
        source: "manual_execute_plan",
        stage: "start",
        executionDraft,
      },
    });
    await waitUi(MANUAL_EXEC_PHASE_HOLD_MS);
    setX402Phase("pay+proof");
    try {
      const payload: Record<string, unknown> = {
        symbol: executionDraft.symbol,
        side: executionDraft.side,
        orderType: executionDraft.orderType,
        size: executionDraft.size,
        tif: executionDraft.tif,
        simulate: false,
      };
      if (executionDraft.orderType === "limit" && executionDraft.entryPrice && executionDraft.entryPrice > 0) {
        payload.price = executionDraft.entryPrice;
      }
      if (executionDraft.takeProfit && executionDraft.takeProfit > 0) {
        payload.takeProfit = executionDraft.takeProfit;
      }
      if (executionDraft.stopLoss && executionDraft.stopLoss > 0) {
        payload.stopLoss = executionDraft.stopLoss;
      }
      const apiRun = await fetchJSON<Record<string, unknown>>(
        `${baseUrl}/api/agent001/hyperliquid/order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        240_000
      );
      const requestId = String(apiRun["requestId"] || "").trim();
      const txHash = String(apiRun["txHash"] || "").trim();
      const workflow = apiRun["workflow"] && typeof apiRun["workflow"] === "object" ? (apiRun["workflow"] as Record<string, unknown>) : {};
      const summary = String(
        (workflow["result"] && typeof workflow["result"] === "object"
          ? ((workflow["result"] as Record<string, unknown>)["summary"] || "")
          : "") || apiRun["reason"] || ""
      ).trim();
      if (requestId) setApiEvidenceRequestId(requestId);
      if (requestId && txHash) setReceiptRef(`${requestId}:${txHash}`);
      setExecuteResult({ requestId, txHash, summary });
      setX402Phase("verify");
      await waitUi(MANUAL_EXEC_PHASE_HOLD_MS);
      setX402Phase("unlock");
      await waitUi(MANUAL_EXEC_PHASE_HOLD_MS);
      markPlanHistoryExecuted({ requestId, txHash, summary });
      appendAudit({
        mode,
        stepId: "api_order_decision",
        stepName: flowSteps.find((item) => item.id === "api_order_decision")?.title || "Step 6",
        blockchainVerifiable: true,
        receiptRef: requestId && txHash ? `${requestId}:${txHash}` : requestId || undefined,
        apiGateTxHash: txHash || undefined,
        apiGatePaidAt: new Date().toISOString(),
        decisionBasis: `ATAPI order execution finished: ${summary || "order submitted"}`,
        payload: {
          source: "manual_execute_plan",
          stage: "done",
          requestId,
          txHash,
          summary,
          workflow,
        },
      });
      setDecision(`Plan executed: ${summary || "order submitted"}${requestId ? ` (requestId=${requestId})` : ""}`);
      await refreshMarket();
    } catch (error) {
      const reason = String((error as Error)?.message || "trade_plan_execute_failed").trim();
      setExecuteError(reason);
      setDecision(`Plan execution failed: ${reason}`);
      appendAudit({
        mode,
        stepId: "api_order_decision",
        stepName: flowSteps.find((item) => item.id === "api_order_decision")?.title || "Step 6",
        blockchainVerifiable: true,
        decisionBasis: `ATAPI execution failed: ${reason}`,
        payload: {
          source: "manual_execute_plan",
          stage: "failed",
          reason,
          executionDraft,
        },
      });
    } finally {
      setPlayback("paused");
      setExecutingPlan(false);
    }
  }, [appendAudit, baseUrl, executionDraft, flowSteps, markPlanHistoryExecuted, mode, refreshMarket, syncFlowVisual, waitUi]);

  useEffect(() => {
    if (!candleChartContainerRef.current) return;
    if (candleChartRef.current) return;
    const chart = createChart(candleChartContainerRef.current, {
      layout: {
        textColor: "rgba(226,232,240,0.86)",
        background: { type: ColorType.Solid, color: "rgba(2,6,23,0.7)" },
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.12)" },
        horzLines: { color: "rgba(148,163,184,0.12)" },
      },
      width: candleChartContainerRef.current.clientWidth,
      height: 320,
      rightPriceScale: {
        borderColor: "rgba(148,163,184,0.22)",
      },
      timeScale: {
        borderColor: "rgba(148,163,184,0.22)",
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#f87171",
    });
    candleChartRef.current = chart;
    candleSeriesRef.current = series;

    const onResize = () => {
      if (!candleChartContainerRef.current || !candleChartRef.current) return;
      candleChartRef.current.applyOptions({ width: candleChartContainerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (candleChartRef.current) {
        candleChartRef.current.remove();
        candleChartRef.current = null;
        candleSeriesRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const rows = candles.map((row) => ({
      time: row.time as Time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    }));
    candleSeriesRef.current.setData(rows);
  }, [candles]);

  useEffect(() => {
    void refreshMarket();
    if (marketTimerRef.current) window.clearInterval(marketTimerRef.current);
    marketTimerRef.current = window.setInterval(() => {
      void refreshMarket();
    }, 3000);
    return () => {
      if (marketTimerRef.current) window.clearInterval(marketTimerRef.current);
    };
  }, [refreshMarket, positionScope]);

  const downloadCurrentRunEvidence = useCallback(async () => {
    const sourceIds: Array<{ source: EvidenceArtifact["source"]; requestId: string }> = [
      { source: "service_info", requestId: serviceEvidenceIds.info },
      { source: "service_technical", requestId: serviceEvidenceIds.technical },
      { source: "api_order", requestId: apiEvidenceRequestId },
    ];
    setDownloadingEvidence(true);
    setEvidenceHint("");
    try {
      const artifacts = await buildEvidencePack(sourceIds);
      if (artifacts.length === 0) {
        setEvidenceHint("No downloadable evidence found for this run yet.");
        return;
      }
      const fileName = `agent_network_evidence_pack_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      downloadJson(fileName, {
        exportedAt: new Date().toISOString(),
        run: {
          infoRequestId: serviceEvidenceIds.info,
          technicalRequestId: serviceEvidenceIds.technical,
          apiRequestId: apiEvidenceRequestId,
        },
        artifacts,
      });
      setEvidenceHint(`Evidence pack downloaded (${artifacts.length} artifact${artifacts.length > 1 ? "s" : ""}).`);
    } catch (error) {
      setEvidenceHint(`Evidence export failed: ${String((error as Error)?.message || "unknown_error")}`);
    } finally {
      setDownloadingEvidence(false);
    }
  }, [apiEvidenceRequestId, buildEvidencePack, downloadJson, serviceEvidenceIds.info, serviceEvidenceIds.technical]);

  const downloadEntryEvidence = useCallback(
    async (entry: AuditLogEntry) => {
      const payload = entry.payload || {};
      const sourceIds: Array<{ source: EvidenceArtifact["source"]; requestId: string }> = [
        { source: "service_info", requestId: normalizeRequestId(payload["infoRequestId"]) },
        { source: "service_technical", requestId: normalizeRequestId(payload["technicalRequestId"]) },
        { source: "api_order", requestId: normalizeRequestId(payload["orderRef"]) },
        { source: "api_order", requestId: receiptRefToRequestId(entry.receiptRef) },
      ];
      setDownloadingEvidence(true);
      setEvidenceHint("");
      try {
        const artifacts = await buildEvidencePack(sourceIds);
        if (artifacts.length === 0) {
          setEvidenceHint("No evidence found for this audit item.");
          return;
        }
        const fileName = `agent_network_audit_${entry.stepId}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        downloadJson(fileName, {
          exportedAt: new Date().toISOString(),
          auditEntry: {
            id: entry.id,
            stepId: entry.stepId,
            stepName: entry.stepName,
            tsISO: entry.tsISO,
          },
          artifacts,
        });
        setEvidenceHint(`Evidence downloaded for ${entry.stepName}.`);
      } catch (error) {
        setEvidenceHint(`Evidence export failed: ${String((error as Error)?.message || "unknown_error")}`);
      } finally {
        setDownloadingEvidence(false);
      }
    },
    [buildEvidencePack, downloadJson]
  );

  const executeStep = useCallback(
    async function run(idx: number) {
      if (runningRef.current || idx < 0 || idx >= flowSteps.length) return;
      runningRef.current = true;
      try {
        const step = flowSteps[idx];
        setStepIndex(idx);
        const hi = highlights(step.id, quoteAcceptedRef.current, shouldOrderRef.current, demoView);
        setActiveNodeIds(hi.nodes);
        setActiveEdgeIds(hi.edges);
        if (hi.edges.length > 0) {
          setRevealedEdgeIds((prev) => Array.from(new Set([...prev, ...hi.edges])));
        }

        if (step.id === "erc8004_verify") {
          let proof = randomHex();
          try {
            const agents = await fetchJSON<{ agents?: unknown[] }>(`${baseUrl}/api/network/agents`);
            proof = `0xerc_${String(agents?.agents?.length ?? 0).padStart(2, "0")}${randomHex(58).slice(2)}`;
          } catch {
            // fallback
          }
          setVerificationHash(proof);
          appendAudit({
            mode,
            stepId: step.id,
            stepName: step.title,
            blockchainVerifiable: true,
            verificationHash: proof,
            payload: {
              layer: "ERC8004",
              verifiedAgents: demoView === "general" ? ["agent001", "other-agent"] : ["agent001", "message-agent", "technical-agent"],
              proof,
            },
          });
        }

        if (step.id === "xmtp_quote_request") {
          setDmOpen(true);
          try {
            const live = await ensureLiveServiceRun();
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              xmtpSnippet:
                demoView === "general"
                  ? `Live XMTP DM run executed. traceId=${live.traceId}, requestId=${live.requestId}.`
                  : `Live XMTP DM run executed for News/Technical analysis agents. traceId=${live.traceId}, requestId=${live.requestId}.`,
              payload: {
                executionMode: "live",
                traceId: live.traceId,
                requestId: live.requestId,
                requestedFrom: demoView === "general" ? ["other-agent"] : ["message-agent", "technical-agent"],
                warnings: live.warnings,
              },
            });
          } catch (error) {
            const reason = String((error as Error)?.message || "live_dm_failed").trim();
            const abortReason = `Live XMTP run failed: ${reason}`;
            setDecision(abortReason);
            setQuoteAccepted(false);
            quoteAcceptedRef.current = false;
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              decisionBasis: `Live DM dispatch failed: ${reason}`,
              xmtpSnippet: "Live XMTP request could not be completed.",
              payload: {
                executionMode: "live",
                error: reason,
              },
            });
            abortFlow(abortReason);
            return;
          }
        }

        if (step.id === "xmtp_quote_return") {
          let live: RealServiceRun | null = liveServiceRunRef.current;
          if (!live) {
            try {
              live = await ensureLiveServiceRun();
            } catch {
              live = null;
            }
          }

          if (!live) {
            const basis = "Quote negotiation failed because live XMTP/x402 run did not return usable evidence.";
            setMessageQuote(0);
            setTechnicalQuote(0);
            setAgent001Decision(null);
            setQuoteAccepted(false);
            quoteAcceptedRef.current = false;
            setDecision(basis);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              xmtpSnippet: "Live quote return unavailable.",
              decisionBasis: basis,
              payload: { accepted: false, reason: "live_run_missing" },
            });
            abortFlow(basis);
            return;
          } else {
            setAgent001Decision(live.agent001Decision || null);
            const mQuote = Number((live.info.amount || 0).toFixed(5));
            const tQuote = demoView === "general" ? 0 : Number((live.technical.amount || 0).toFixed(5));
            setMessageQuote(mQuote);
            setTechnicalQuote(tQuote);
            const total = Number((mQuote + tQuote).toFixed(5));
            const accepted = total <= QUOTE_CAP && mQuote > 0;
            setQuoteAccepted(accepted);
            quoteAcceptedRef.current = accepted;
            const basis = accepted
              ? `Live quote accepted. Total ${total.toFixed(5)} <= cap ${QUOTE_CAP.toFixed(5)}.`
              : `Live quote rejected. Total ${total.toFixed(5)} > cap ${QUOTE_CAP.toFixed(5)} or quote missing.`;
            setDecision(basis);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              xmtpSnippet:
                demoView === "general"
                  ? `Other Agent live quote ${mQuote.toFixed(5)} (requestId=${live.info.requestId}).`
                  : `News quote ${mQuote.toFixed(5)} (requestId=${live.info.requestId}), Technical quote ${tQuote.toFixed(5)} (requestId=${live.technical.requestId}).`,
              decisionBasis: basis,
              payload: {
                executionMode: "live",
                messageQuote: mQuote,
                technicalQuote: tQuote,
                totalQuote: total,
                cap: QUOTE_CAP,
                accepted,
                infoRequestId: live.info.requestId,
                technicalRequestId: live.technical.requestId,
              },
            });
            if (!accepted) {
              abortFlow(basis);
              return;
            }
          }
        }

        if (step.id === "x402_settlement") {
          if (!quoteAcceptedRef.current) {
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              decisionBasis: "Skipped. Quote was not accepted, so payment was not initiated.",
              payload: { executed: false },
            });
          } else {
            let p = 0;
            setX402Phase(X402_PHASES[p]);
            if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
            x402TimerRef.current = window.setInterval(() => {
              p += 1;
              if (p >= X402_PHASES.length) {
                if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
                return;
              }
              setX402Phase(X402_PHASES[p]);
            }, 550);

            const live = liveServiceRunRef.current;
            if (live?.info.requestId || live?.technical.requestId) {
              setServiceEvidenceIds({
                info: normalizeRequestId(live?.info.requestId),
                technical: normalizeRequestId(live?.technical.requestId),
              });
            }
            let receipt = `receipt_${randomHex(10).slice(2)}`;
            let serviceTxHashA = live?.info.txHash || "";
            let serviceTxHashB = live?.technical.txHash || "";
            let servicePaidAtA = live?.info.paidAtIso || "";
            let servicePaidAtB = live?.technical.paidAtIso || "";
            if (demoView === "general") {
              serviceTxHashA = live?.info.txHash || live?.technical.txHash || "";
              servicePaidAtA = live?.info.paidAtIso || live?.technical.paidAtIso || "";
              serviceTxHashB = live?.technical.txHash || live?.info.txHash || "";
              servicePaidAtB = live?.technical.paidAtIso || live?.info.paidAtIso || "";
            }
            if (live?.info.requestId && serviceTxHashA) {
              receipt = `${live.info.requestId}:${serviceTxHashA}`;
            }
            if (!serviceTxHashA) {
              const reason = "Live x402 settlement evidence missing for this run.";
              setDecision(reason);
              setQuoteAccepted(false);
              quoteAcceptedRef.current = false;
              appendAudit({
                mode,
                stepId: step.id,
                stepName: step.title,
                blockchainVerifiable: true,
                decisionBasis: reason,
                payload: { executed: false, reason: "missing_live_settlement" },
              });
              abortFlow(reason);
              return;
            }
            setReceiptRef(receipt);
            const staleA = servicePaidAtA ? Date.now() - Date.parse(servicePaidAtA) > TX_STALE_MS : false;
            const staleB = servicePaidAtB ? Date.now() - Date.parse(servicePaidAtB) > TX_STALE_MS : false;
            const staleNotes = [staleA ? "news tx is historical" : "", staleB ? "technical tx is historical" : ""].filter(Boolean);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              receiptRef: receipt,
              messageServiceTxHash: demoView === "general" ? serviceTxHashA : serviceTxHashA,
              messageServicePaidAt: servicePaidAtA || undefined,
              technicalServiceTxHash: serviceTxHashB || undefined,
              technicalServicePaidAt: servicePaidAtB || undefined,
              decisionBasis:
                staleNotes.length > 0
                  ? `x402 payment evidence loaded. ${staleNotes.join("; ")}.`
                  : "x402 payment evidence loaded from this live run.",
              payload: {
                phases: X402_PHASES,
                receipt,
                executed: true,
                messageServiceTxHash: serviceTxHashA,
                messageServicePaidAt: servicePaidAtA || null,
                technicalServiceTxHash: serviceTxHashB || null,
                technicalServicePaidAt: servicePaidAtB || null,
                stale: { message: staleA, technical: staleB },
              },
            });
          }
        }

        if (step.id === "xmtp_service_result") {
          if (!quoteAcceptedRef.current) {
            setDmOpen(false);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              decisionBasis: "No service result returned because payment did not complete.",
              payload: { returned: false },
            });
          } else {
            setDmOpen(true);
            const live = liveServiceRunRef.current;
            if (!live) {
              const reason = "Live XMTP result is unavailable. Service stage did not return task-result payload.";
              setDmOpen(false);
              setMessageScore(0);
              setTechnicalScore(0);
              setDecision(reason);
              appendAudit({
                mode,
                stepId: step.id,
                stepName: step.title,
                blockchainVerifiable: true,
                decisionBasis: reason,
                payload: { delivery: "xmtp_dm", returned: false },
              });
              abortFlow(reason);
              return;
            } else if (demoView === "general") {
              const snippet = live.info.summary || live.technical.summary;
              const score = live.info.confidence || live.technical.confidence || 0;
              setMessageSnippet(snippet);
              setTechnicalSnippet("");
              setMessageScore(score);
              setTechnicalScore(0);
              if (live.agent001Decision?.reason) {
                setDecision(`Agent001 thinking: ${live.agent001Decision.reason}`);
              }
              appendAudit({
                mode,
                stepId: step.id,
                stepName: step.title,
                blockchainVerifiable: true,
                xmtpSnippet: `Live XMTP payload delivered: ${snippet.slice(0, 120)}...`,
                decisionBasis: "Service result is returned by live XMTP DM, with strict x402 evidence bound to this run.",
                payload: {
                  delivery: "xmtp_dm_live",
                  otherAgentResult: snippet,
                  serviceScore: score,
                  agent001Decision: live.agent001Decision || null,
                  infoRequestId: live.info.requestId,
                  technicalRequestId: live.technical.requestId,
                  receiptRef,
                },
              });
            } else {
              const mSnippet = live.info.summary;
              const tSnippet = live.technical.summary;
              const mScore = live.info.confidence;
              const tScore = live.technical.confidence;
              setMessageSnippet(mSnippet);
              setTechnicalSnippet(tSnippet);
              setMessageScore(mScore);
              setTechnicalScore(tScore);
              if (live.agent001Decision?.reason) {
                setDecision(`Agent001 thinking: ${live.agent001Decision.reason}`);
              }
              appendAudit({
                mode,
                stepId: step.id,
                stepName: step.title,
                blockchainVerifiable: true,
                xmtpSnippet: `Live XMTP payload delivered. News: ${mSnippet.slice(0, 100)}...`,
                decisionBasis: "Service results are real XMTP task-results, each with strict x402 payment evidence.",
                payload: {
                  delivery: "xmtp_dm_live",
                  messageResult: mSnippet,
                  technicalResult: tSnippet,
                  messageScore: mScore,
                  technicalScore: tScore,
                  agent001Decision: live.agent001Decision || null,
                  infoRequestId: live.info.requestId,
                  technicalRequestId: live.technical.requestId,
                  receiptRef,
                },
              });
            }
          }
        }

        if (step.id === "api_order_decision") {
          setDmOpen(false);
          if (!quoteAcceptedRef.current) {
            setShouldOrder(false);
            shouldOrderRef.current = false;
            const basis = "Skipped API order decision because quote/payment stage did not pass.";
            setDecision(basis);
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              decisionBasis: basis,
              payload: { apiCalled: false },
            });
          } else {
            let live = liveServiceRunRef.current;
            if (!live) {
              try {
                live = await ensureLiveServiceRun();
              } catch {
                live = null;
              }
            }

            const backendDecision = live?.agent001Decision || agent001Decision;
            if (backendDecision) setAgent001Decision(backendDecision);
            const combined =
              demoView === "general"
                ? Number(messageScore.toFixed(3))
                : Number((messageScore * 0.5 + technicalScore * 0.5).toFixed(3));
            const fallbackRuleApproved =
              demoView === "general"
                ? combined >= EXECUTION_THRESHOLD && messageScore >= 0.45
                : combined >= EXECUTION_THRESHOLD && messageScore >= 0.45 && technicalScore >= 0.45;
            const approvedByBackend = backendDecision ? Boolean(backendDecision.shouldPlaceOrder) : fallbackRuleApproved;
            const approved = forceOrderDemo ? true : approvedByBackend;
            setShouldOrder(approved);
            shouldOrderRef.current = approved;
            const backendReason = String(backendDecision?.reason || backendDecision?.text || "").trim();
            const fallbackReason = approvedByBackend
              ? `Fallback rule approved. Combined score ${combined} reached threshold ${EXECUTION_THRESHOLD}.`
              : `Fallback rule rejected. Combined score ${combined} below threshold ${EXECUTION_THRESHOLD}.`;
            const basisCore = backendReason || fallbackReason;
            const basis = approved
              ? forceOrderDemo
                ? `Order approved by demo override. Original decision: ${basisCore}`
                : `Order approved by Agent001 decision. ${basisCore}`
              : `Order rejected by Agent001 decision. ${basisCore}`;
            let finalBasis = basis;
            setDecision(finalBasis);
            let orderRef = "";
            let apiGateReceipt = "";
            let apiGateTxHash = "";
            let apiGatePaidAt = "";
            const plan = backendDecision?.plan || null;
            const sideCandidate = String(plan?.side || "").trim().toLowerCase();
            const orderSide = sideCandidate === "buy" || sideCandidate === "sell" ? sideCandidate : combined >= 0.72 ? "buy" : "sell";
            const typeCandidate = String(plan?.orderType || "market").trim().toLowerCase();
            let orderType = typeCandidate === "limit" || typeCandidate === "market" ? typeCandidate : "market";
            const orderEntryPriceRaw = Number(plan?.entryPrice ?? NaN);
            const orderEntryPrice = Number.isFinite(orderEntryPriceRaw) && orderEntryPriceRaw > 0 ? Number(orderEntryPriceRaw) : null;
            if (orderType === "limit" && !orderEntryPrice) {
              orderType = "market";
            }
            const orderTif = String(plan?.tif || (orderType === "market" ? "Ioc" : "Gtc")).trim() || (orderType === "market" ? "Ioc" : "Gtc");
            const orderSizeRaw = Number(plan?.size ?? NaN);
            const orderSize = Number.isFinite(orderSizeRaw) && orderSizeRaw > 0 ? Number(orderSizeRaw) : 0.001;
            const orderTakeProfitRaw = Number(plan?.takeProfit ?? NaN);
            const orderStopLossRaw = Number(plan?.stopLoss ?? NaN);
            const orderTakeProfit = Number.isFinite(orderTakeProfitRaw) && orderTakeProfitRaw > 0 ? Number(orderTakeProfitRaw) : null;
            const orderStopLoss = Number.isFinite(orderStopLossRaw) && orderStopLossRaw > 0 ? Number(orderStopLossRaw) : null;
            let orderSummary = "";
            let orderError = "";
            let apiExecutionFailed = false;
            if (approved) {
              let p = 0;
              setX402Phase(X402_PHASES[p]);
              if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
              x402TimerRef.current = window.setInterval(() => {
                p += 1;
                if (p >= X402_PHASES.length) {
                  if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
                  return;
                }
                setX402Phase(X402_PHASES[p]);
              }, 480);

              apiGateReceipt = "";
              try {
                const apiRun = await fetchJSON<Record<string, unknown>>(
                  `${baseUrl}/api/agent001/hyperliquid/order`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      symbol: String(plan?.symbol || "BTCUSDT").trim().toUpperCase() || "BTCUSDT",
                      side: orderSide,
                      orderType,
                      size: orderSize,
                      tif: orderTif,
                      ...(orderType === "limit" && orderEntryPrice ? { price: orderEntryPrice } : {}),
                      ...(orderTakeProfit ? { takeProfit: orderTakeProfit } : {}),
                      ...(orderStopLoss ? { stopLoss: orderStopLoss } : {}),
                      reduceOnly: false,
                      simulate: false,
                    }),
                  },
                  240_000
                );

                orderRef = String(apiRun["requestId"] || "").trim();
                apiGateTxHash = String(apiRun["txHash"] || "").trim();
                const payment =
                  apiRun["payment"] && typeof apiRun["payment"] === "object" ? (apiRun["payment"] as Record<string, unknown>) : {};
                const workflow =
                  apiRun["workflow"] && typeof apiRun["workflow"] === "object"
                    ? (apiRun["workflow"] as Record<string, unknown>)
                    : {};
                if (!apiGateTxHash) {
                  apiGateTxHash = String(payment["txHash"] || "").trim();
                }
                if (!orderRef) {
                  orderRef = String(payment["requestId"] || "").trim();
                }
                orderSummary = String(
                  (workflow["result"] && typeof workflow["result"] === "object"
                    ? ((workflow["result"] as Record<string, unknown>)["summary"] || "")
                    : "") || apiRun["reason"] || ""
                ).trim();

                if (!apiGatePaidAt) {
                  const reqTime = await fetchRequestTiming(orderRef);
                  apiGatePaidAt = reqTime.paidAtIso;
                }
                if (!apiGatePaidAt) {
                  apiGatePaidAt = String(payment["verifiedAt"] || workflow["updatedAt"] || "").trim();
                }
                if (orderRef && apiGateTxHash) {
                  apiGateReceipt = `${orderRef}:${apiGateTxHash}`;
                }
                if (orderRef) {
                  setApiEvidenceRequestId(orderRef);
                }
                const stopText =
                  orderTakeProfit || orderStopLoss
                    ? ` TP=${orderTakeProfit ?? "-"} SL=${orderStopLoss ?? "-"}`
                    : "";
                finalBasis = `${basis} Hyperliquid ${orderType} ${orderSide} submitted (real mode).${stopText}`;
                setDecision(finalBasis);
              } catch (error) {
                const reason = String((error as Error)?.message || "api_gate_run_failed").trim();
                apiExecutionFailed = true;
                orderError = reason;
                finalBasis = `${basis} Hyperliquid API execution failed (real-only, no fallback): ${reason}`;
                setDecision(finalBasis);
              }
              if (apiGateReceipt) setReceiptRef(apiGateReceipt);
            }
            appendAudit({
              mode,
              stepId: step.id,
              stepName: step.title,
              blockchainVerifiable: true,
              receiptRef: apiGateReceipt || receiptRef || orderRef || undefined,
              apiGateTxHash: apiGateTxHash || undefined,
              apiGatePaidAt: apiGatePaidAt || undefined,
              decisionBasis: finalBasis,
              payload: {
                messageScore,
                technicalScore,
                combined,
                apiCalled: approved,
                forceOrderDemo,
                approvedByBackend,
                fallbackRuleApproved,
                orderEndpoint: "/api/agent001/hyperliquid/order",
                orderType,
                orderSide,
                orderSize,
                orderTif,
                orderEntryPrice,
                orderTakeProfit,
                orderStopLoss,
                orderSimulated: false,
                orderSummary,
                orderError,
                apiGateReceipt,
                apiGateTxHash,
                apiGatePaidAt,
                apiGateHistorical: apiGatePaidAt ? Date.now() - Date.parse(apiGatePaidAt) > TX_STALE_MS : false,
                orderRef,
                backendDecision,
                demoView,
              },
            });
            if (apiExecutionFailed) {
              abortFlow(finalBasis);
              return;
            }
          }
        }

        if (playbackRef.current === "playing") {
          if (idx >= flowSteps.length - 1) {
            setPlayback("completed");
          } else {
            if (timerRef.current) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => {
              if (playbackRef.current === "playing") void run(idx + 1);
            }, step.durationMs);
          }
        }
      } finally {
        runningRef.current = false;
      }
    },
    [
      abortFlow,
      agent001Decision,
      appendAudit,
      baseUrl,
      demoView,
      ensureLiveServiceRun,
      fetchRequestTiming,
      forceOrderDemo,
      messageScore,
      mode,
      receiptRef,
      technicalScore,
      flowSteps,
    ]
  );

  const start = useCallback(() => {
    const shouldResume = playbackRef.current === "paused" && stepIndex >= 0 && stepIndex < flowSteps.length - 1;
    if (shouldResume) {
      setPlayback("playing");
      void executeStep(stepIndex + 1);
      return;
    }

    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
    setPlayback("playing");
    setStepIndex(-1);
    setActiveNodeIds([]);
    setActiveEdgeIds([]);
    setRevealedEdgeIds([]);
    setAudit([]);
    setDmOpen(false);
    setX402Phase("challenge");
    setQuoteAccepted(null);
    quoteAcceptedRef.current = null;
    setShouldOrder(null);
    shouldOrderRef.current = null;
    setDecision("Pending quote negotiation.");
    setVerificationHash("");
    setMessageQuote(0);
    setTechnicalQuote(0);
    setMessageSnippet("");
    setTechnicalSnippet("");
    setMessageScore(0);
    setTechnicalScore(0);
    setReceiptRef("");
    setServiceEvidenceIds({ info: "", technical: "" });
    setApiEvidenceRequestId("");
    setAgent001Decision(null);
    setCurrentLiveRun(null);
    setEvidenceHint("");
    liveServiceRunRef.current = null;
    liveServiceRunPromiseRef.current = null;
    void executeStep(0);
  }, [executeStep, stepIndex, flowSteps.length]);

  const pause = useCallback(() => {
    setPlayback("paused");
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const next = useCallback(() => {
    setPlayback("paused");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const target = stepIndex < 0 ? 0 : Math.min(stepIndex + 1, flowSteps.length - 1);
    void executeStep(target);
  }, [executeStep, stepIndex, flowSteps.length]);

  const replay = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (x402TimerRef.current) window.clearInterval(x402TimerRef.current);
    setPlayback("idle");
    setStepIndex(-1);
    setActiveNodeIds([]);
    setActiveEdgeIds([]);
    setRevealedEdgeIds([]);
    setAudit([]);
    setDmOpen(false);
    setX402Phase("challenge");
    setQuoteAccepted(null);
    quoteAcceptedRef.current = null;
    setShouldOrder(null);
    shouldOrderRef.current = null;
    setDecision("Pending quote negotiation.");
    setVerificationHash("");
    setMessageQuote(0);
    setTechnicalQuote(0);
    setMessageSnippet("");
    setTechnicalSnippet("");
    setMessageScore(0);
    setTechnicalScore(0);
    setReceiptRef("");
    setServiceEvidenceIds({ info: "", technical: "" });
    setApiEvidenceRequestId("");
    setAgent001Decision(null);
    setCurrentLiveRun(null);
    setEvidenceHint("");
    liveServiceRunRef.current = null;
    liveServiceRunPromiseRef.current = null;
    setTimeout(() => {
      setPlayback("playing");
      void executeStep(0);
    }, 120);
  }, [executeStep]);

  const localizeNodeData = useCallback(
    (node: Node<NetworkNodeData>): NetworkNodeData => {
      if (lang === "en") return node.data;
      const map: Record<string, { title: string; subtitle: string }> = {
        "message-agent": { title: "消息/基本面分析 Agent", subtitle: "消息侧 · 市场新闻信号" },
        "technical-agent": { title: "技术分析 Agent", subtitle: "技术侧 · 图表信号" },
        "other-agent": { title: "其他 Agent", subtitle: "报价服务提供方" },
        agent001: { title: "Agent001", subtitle: "信号汇总与执行" },
        erc8004: { title: "ERC8004", subtitle: "注册 · 认证 · 声誉 · Agent 发现" },
        "x402-service": { title: "x402 服务结算", subtitle: "支付服务报价并解锁结果" },
        "x402-api": { title: "x402 API 结算", subtitle: "支付 API 网关并解锁下单请求" },
        "trading-api": { title: "交易 API", subtitle: "Web2 下单服务" },
      };
      const localized = map[node.id];
      return localized ? { ...node.data, ...localized } : node.data;
    },
    [lang]
  );

  const localizeEdgeData = useCallback(
    (edge: Edge<NetworkEdgeData>): NetworkEdgeData | undefined => {
      const data = edge.data;
      if (!data || lang === "en") return data;
      const map: Record<string, Partial<NetworkEdgeData>> = {
        "quote-req-msg": { label: "① DM 报价请求（消息面 Agent）" },
        "quote-req-tech": { label: "① DM 报价请求（技术面 Agent）" },
        "quote-res-msg": { label: "② DM 报价回传" },
        "quote-res-tech": { label: "② DM 报价回传" },
        "pay-to-x402-service": { label: "③ x402 支付+证明（服务）" },
        "unlock-msg": { label: "④ 解锁消息面服务" },
        "unlock-tech": { label: "④ 解锁技术面服务" },
        "result-msg": { label: "⑤ DM 服务结果回传" },
        "result-tech": { label: "⑤ DM 服务结果回传" },
        "pay-to-x402-api": { label: "⑥ x402 支付+证明（API）" },
        "unlock-api": { label: "⑥ 解锁 API 下单通道" },
        "api-to-agent": { label: "⑥ API 返回结果 + receiptRef" },
        "unlock-other": { label: "④ 解锁服务" },
        "dm-bi": {
          leftHint: "Other Agent -> Agent001：报价/结果 DM",
          rightHint: "Agent001 -> Other Agent：任务/报价 DM",
        },
      };
      const localized = map[edge.id];
      return localized ? { ...data, ...localized } : data;
    },
    [lang]
  );

  const drawNodes = useMemo(
    () =>
      nodes.map((n) => {
        const active = activeNodeIds.includes(n.id);
        return { ...n, data: { ...localizeNodeData(n), status: active ? "active" : "idle" } };
      }),
    [activeNodeIds, nodes, localizeNodeData]
  );

  const drawEdges = useMemo(
    () =>
      edges.map((e) => {
        const active = activeEdgeIds.includes(e.id);
        const revealed = revealedEdgeIds.includes(e.id);
        const dimmed = revealed && !active;
        const localized = localizeEdgeData(e);
        return {
          ...e,
          hidden: !revealed && !active,
          animated: active,
          data: {
            ...localized,
            active,
            dimmed,
            label: active ? localized?.label : undefined,
            leftHint: active ? localized?.leftHint : undefined,
            rightHint: active ? localized?.rightHint : undefined,
          },
        };
      }),
    [activeEdgeIds, edges, localizeEdgeData, revealedEdgeIds]
  );

  const current = stepIndex >= 0 ? flowSteps[stepIndex] : null;
  const progress = stepIndex >= 0 ? ((stepIndex + 1) / flowSteps.length) * 100 : 0;
  const hasCurrentRunEvidence = Boolean(serviceEvidenceIds.info || serviceEvidenceIds.technical || apiEvidenceRequestId);
  const hasExpandablePlanDetails = Boolean(currentLiveRun || agent001Decision);
  const infoSnippetTooLong = messageSnippet.length > RESULT_SNIPPET_PREVIEW_CHARS;
  const technicalSnippetTooLong = technicalSnippet.length > RESULT_SNIPPET_PREVIEW_CHARS;
  const infoSnippetDisplay =
    !messageSnippet
      ? tr("待返回...", "pending...")
      : infoSnippetExpanded || !infoSnippetTooLong
        ? messageSnippet
        : `${messageSnippet.slice(0, RESULT_SNIPPET_PREVIEW_CHARS)}...`;
  const technicalSnippetDisplay =
    !technicalSnippet
      ? tr("待返回...", "pending...")
      : technicalSnippetExpanded || !technicalSnippetTooLong
        ? technicalSnippet
        : `${technicalSnippet.slice(0, RESULT_SNIPPET_PREVIEW_CHARS)}...`;

  const copyAudit = useCallback(async (entry: AuditLogEntry) => {
    await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 1200);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="order-3 border-emerald-400/20 bg-black/45 py-4 text-white">
        <CardHeader className="space-y-2 px-4 pb-2 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg text-emerald-200">
              <Cpu className="size-4" />
              {tr("Kite Trace Platform", "Kite Trace Platform")}
            </CardTitle>
            <div className="flex items-center gap-1 rounded-lg border border-white/15 bg-black/30 p-1">
              <Button
                size="sm"
                variant={lang === "zh" ? "default" : "ghost"}
                className={cn("h-7 px-2 text-xs", lang === "zh" ? "bg-cyan-500 text-black hover:bg-cyan-400" : "text-slate-200")}
                onClick={() => setLang("zh")}
              >
                中文
              </Button>
              <Button
                size="sm"
                variant={lang === "en" ? "default" : "ghost"}
                className={cn("h-7 px-2 text-xs", lang === "en" ? "bg-cyan-500 text-black hover:bg-cyan-400" : "text-slate-200")}
                onClick={() => setLang("en")}
              >
                EN
              </Button>
            </div>
          </div>
          <CardDescription className="text-slate-300">
            {tr(
              "基于 Kite 测试网打造：BTC K线 + Hyperliquid 测试网仓位 + Agent001 交易计划 + 手动执行。",
              "Built on Kite testnet: BTC K-line + Hyperliquid testnet positions + Agent001 trade plan + manual execution."
            )}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-emerald-400/35 bg-emerald-500/10 text-emerald-200">
              {tr("K线来源", "Candle Source")}: {candleSource}
            </Badge>
            <Badge className="border border-white/25 bg-white/5 text-slate-200">
              {tr("仓位范围", "Position Scope")}: {positionScope.toUpperCase()}
            </Badge>
            <Badge className="border border-white/25 bg-white/5 text-slate-200">
              {tr("更新时间", "Updated")}: {marketUpdatedAt ? formatTxTime(marketUpdatedAt) : tr("待定", "pending")}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 border-white/30 bg-black/35 text-white", positionScope === "btc" ? "border-cyan-400/45 text-cyan-200" : "")}
              onClick={() => setPositionScope("btc")}
            >
              {tr("仅 BTC", "BTC Scope")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 border-white/30 bg-black/35 text-white", positionScope === "all" ? "border-cyan-400/45 text-cyan-200" : "")}
              onClick={() => setPositionScope("all")}
            >
              {tr("全仓位", "All Scope")}
            </Button>
            <Button variant="outline" size="sm" className="h-8 border-cyan-400/35 bg-cyan-500/10 text-cyan-100" onClick={() => void refreshMarket()}>
              {tr("刷新行情", "Refresh Market")}
            </Button>
          </div>
          {marketError ? <p className="text-xs text-amber-200">{marketError}</p> : null}
        </CardHeader>
        <CardContent className="space-y-4 px-4 sm:px-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-cyan-200">{tr("历史计划", "Plan History")}</div>
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-white/15 bg-black/30 px-2 py-1 text-[11px] text-slate-300">{planHistory.length}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-white/30 bg-black/35 text-white"
                  onClick={() => setPlanHistoryOpen((prev) => !prev)}
                >
                  {planHistoryOpen ? tr("收起历史计划", "Hide Plan History") : tr("历史计划", "Show Plan History")}
                </Button>
              </div>
            </div>
            {planHistoryOpen ? (
              <div className="mt-2 rounded-lg border border-white/10 bg-slate-900/50 p-2 text-xs text-slate-200">
                {planHistory.length === 0 ? (
                  <p className="text-slate-400">{tr("暂无历史计划记录。", "No plan history yet.")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {planHistory.slice(0, 8).map((row) => {
                      const active = row.id === activePlanHistoryId;
                      return (
                        <div
                          key={row.id}
                          className={cn(
                            "rounded border px-2 py-1.5",
                            active ? "border-cyan-300/35 bg-cyan-500/10" : "border-white/10 bg-black/25"
                          )}
                        >
                          <p className="text-[11px] text-slate-300">
                            {formatTxTime(row.createdAt)} / {row.version}
                          </p>
                          <p className="mt-0.5">
                            <span className={cn(row.shouldPlaceOrder ? "text-emerald-300" : "text-amber-300")}>
                              {row.shouldPlaceOrder ? tr("可执行", "Ready") : tr("观望", "Skip")}
                            </span>
                            {" · "}
                            <span className="font-mono">
                              {row.plan.symbol} {row.plan.side || "-"} {row.plan.orderType || "-"} size={row.plan.size ?? "-"}
                            </span>
                          </p>
                          <p className="mt-0.5 text-slate-400">{row.reason || "-"}</p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {row.executed ? tr("执行结果", "Execution") : tr("执行状态", "Execution")}:{" "}
                            {row.executed
                              ? `${tr("已执行", "Done")} ${shortHash(row.executeTxHash)}`
                              : tr("未执行", "Pending")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                {tr("默认收起，点击“历史计划”查看。", "Collapsed by default. Click \"Show Plan History\" to expand.")}
              </p>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-white/10 bg-slate-950/75 p-3">
              <div ref={candleChartContainerRef} className="h-[320px] w-full overflow-hidden rounded-lg" />
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="mb-2 text-slate-300">{tr("账户快照", "Account Snapshot")}</div>
                <div className="grid grid-cols-2 gap-2 text-slate-200">
                  <div>{tr("账户权益", "Account Value")}</div>
                  <div className="text-right font-mono">{toNumberOrNull(accountSummary.accountValue)?.toFixed(4) ?? "-"}</div>
                  <div>{tr("已用保证金", "Total Margin Used")}</div>
                  <div className="text-right font-mono">{toNumberOrNull(accountSummary.totalMarginUsed)?.toFixed(4) ?? "-"}</div>
                  <div>{tr("可提余额", "Withdrawable")}</div>
                  <div className="text-right font-mono">{toNumberOrNull(accountSummary.withdrawable)?.toFixed(4) ?? "-"}</div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="mb-2 text-slate-300">{tr("持仓", "Positions")}</div>
                {positionItems.length === 0 ? (
                  <p className="text-slate-400">{tr("当前无持仓。", "No active positions.")}</p>
                ) : (
                  <div className="space-y-2">
                    {positionItems.slice(0, 6).map((row, idx) => (
                      <div key={`${row.symbol}_${idx}`} className="rounded-lg border border-white/10 bg-slate-900/60 p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{row.symbol}</span>
                          <span className={cn("text-[11px] uppercase", row.side === "long" ? "text-emerald-300" : row.side === "short" ? "text-rose-300" : "text-slate-300")}>
                            {row.side || tr("空仓", "flat")}
                          </span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-200">
                          <span>{tr("数量", "Size")}</span>
                          <span className="text-right font-mono">{row.size.toFixed(4)}</span>
                          <span>{tr("开仓 / 标记价", "Entry / Mark")}</span>
                          <span className="text-right font-mono">
                            {row.entryPrice?.toFixed(2) ?? "-"} / {row.markPrice?.toFixed(2) ?? "-"}
                          </span>
                          <span>uPnL</span>
                          <span className={cn("text-right font-mono", (row.unrealizedPnl || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                            {row.unrealizedPnl?.toFixed(4) ?? "-"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="mb-2 text-slate-300">{tr("挂单", "Open Orders")} ({openOrderItems.length})</div>
                {openOrderItems.length === 0 ? (
                  <p className="text-slate-400">{tr("当前无挂单。", "No open orders.")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {openOrderItems.slice(0, 6).map((row, idx) => (
                      <div key={`oo_${idx}`} className="flex items-center justify-between rounded border border-white/10 bg-slate-900/60 px-2 py-1 text-[11px]">
                        <span>{String(row.coin || "BTC")}</span>
                        <span>{String(row.side || "-")}</span>
                        <span className="font-mono">{toFiniteNumber(row.sz, 0).toFixed(4)}</span>
                        <span className="font-mono">{toFiniteNumber(row.limitPx, 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
            <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
              <div className="text-sm font-semibold text-cyan-200">{tr("计划操作", "Plan Actions")}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button className="h-9 bg-gradient-to-r from-cyan-400 to-blue-600 text-black" onClick={() => void fetchCurrentTradePlan()} disabled={planning}>
                  {planning ? tr("正在获取计划...", "Fetching Plan...") : tr("获取当前交易计划", "Fetch Current Trade Plan")}
                </Button>
                <Button
                  variant="outline"
                  className="h-9 border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!agent001Decision || executingPlan}
                >
                  {executingPlan ? tr("执行中...", "Executing...") : tr("执行该计划", "Execute This Plan")}
                </Button>
                {hasExpandablePlanDetails ? (
                  <Button
                    variant="outline"
                    className="h-9 border-white/25 bg-black/35 text-slate-100"
                    onClick={() => setPlanDetailsOpen((prev) => !prev)}
                  >
                    {planDetailsOpen ? tr("收起计划详情", "Hide Plan Details") : tr("展开计划详情", "Show Plan Details")}
                  </Button>
                ) : null}
              </div>
              {planError ? <p className="text-xs text-rose-300">{tr("计划错误", "Plan error")}: {planError}</p> : null}
              {executeError ? <p className="text-xs text-rose-300">{tr("执行错误", "Execute error")}: {executeError}</p> : null}
              {executeResult.requestId ? (
                <div className="rounded-lg border border-white/10 bg-slate-900/60 p-2 text-xs text-slate-200">
                  <p>requestId: <span className="font-mono">{executeResult.requestId}</span></p>
                  <p>
                    txHash:{" "}
                    {txExplorerUrl(executeResult.txHash) ? (
                      <a
                        href={txExplorerUrl(executeResult.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-cyan-200 underline decoration-dotted"
                      >
                        {shortHash(executeResult.txHash)}
                      </a>
                    ) : (
                      <span className="font-mono">{shortHash(executeResult.txHash)}</span>
                    )}
                  </p>
                  <p>{tr("摘要", "summary")}: {executeResult.summary || "-"}</p>
                </div>
              ) : null}
              {agent001Decision ? (
                <p className="text-xs text-slate-300">
                  {tr("计划摘要", "Plan Summary")}:{" "}
                  <span className={cn(agent001Decision.shouldPlaceOrder ? "text-emerald-300" : "text-amber-300")}>
                    {agent001Decision.shouldPlaceOrder ? tr("可执行", "Ready") : tr("观望", "Skip")}
                  </span>
                  {" · "}
                  <span className="font-mono">
                    {agent001Decision.plan.symbol} {agent001Decision.plan.side || "-"} {agent001Decision.plan.orderType || "-"} size=
                    {agent001Decision.plan.size ?? "-"}
                  </span>
                </p>
              ) : currentLiveRun ? (
                <p className="text-xs text-slate-400">{tr("交易计划已生成。点击“展开计划详情”查看完整内容。", "Trade plan generated. Click \"Show Plan Details\" for full details.")}</p>
              ) : (
                <p className="text-xs text-slate-400">{tr("暂无计划。点击“获取当前交易计划”。", "No plan yet. Click Fetch Current Trade Plan.")}</p>
              )}
              {planDetailsOpen && currentLiveRun ? (
                <div className="rounded-lg border border-cyan-400/20 bg-slate-900/60 p-2 text-xs text-slate-200">
                  <p className="font-semibold text-cyan-200">{tr("实时 XMTP + x402 证明", "Live XMTP + x402 Proof")}</p>
                  <p className="mt-1">
                    traceId: <span className="font-mono">{currentLiveRun.traceId || "-"}</span>
                  </p>
                  <p>
                    requestId: <span className="font-mono">{currentLiveRun.requestId || "-"}</span>
                  </p>
                  <div className="mt-2 rounded border border-white/10 bg-black/30 p-2">
                    <p className="font-semibold text-emerald-200">{tr("消息面支付", "Info-side Payment")}</p>
                    <p>requestId: <span className="font-mono">{currentLiveRun.info.requestId || "-"}</span></p>
                    <p>
                      txHash:{" "}
                      {txExplorerUrl(currentLiveRun.info.txHash) ? (
                        <a
                          href={txExplorerUrl(currentLiveRun.info.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-cyan-200 underline decoration-dotted"
                        >
                          {shortHash(currentLiveRun.info.txHash)}
                        </a>
                      ) : (
                        <span className="font-mono">{shortHash(currentLiveRun.info.txHash)}</span>
                      )}
                    </p>
                    <p>{tr("支付时间", "paidAt")}: {formatTxTime(currentLiveRun.info.paidAtIso)} {formatTxAge(currentLiveRun.info.paidAtIso)}</p>
                    <p>{tr("金额", "amount")}: {currentLiveRun.info.amount > 0 ? currentLiveRun.info.amount.toFixed(5) : "-"}</p>
                  </div>
                  <div className="mt-2 rounded border border-white/10 bg-black/30 p-2">
                    <p className="font-semibold text-emerald-200">{tr("技术面支付", "Technical-side Payment")}</p>
                    <p>requestId: <span className="font-mono">{currentLiveRun.technical.requestId || "-"}</span></p>
                    <p>
                      txHash:{" "}
                      {txExplorerUrl(currentLiveRun.technical.txHash) ? (
                        <a
                          href={txExplorerUrl(currentLiveRun.technical.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-cyan-200 underline decoration-dotted"
                        >
                          {shortHash(currentLiveRun.technical.txHash)}
                        </a>
                      ) : (
                        <span className="font-mono">{shortHash(currentLiveRun.technical.txHash)}</span>
                      )}
                    </p>
                    <p>{tr("支付时间", "paidAt")}: {formatTxTime(currentLiveRun.technical.paidAtIso)} {formatTxAge(currentLiveRun.technical.paidAtIso)}</p>
                    <p>{tr("金额", "amount")}: {currentLiveRun.technical.amount > 0 ? currentLiveRun.technical.amount.toFixed(5) : "-"}</p>
                  </div>
                  {currentLiveRun.warnings.length > 0 ? (
                    <p className="mt-2 text-amber-200">{tr("警告", "warning")}: {currentLiveRun.warnings.join(" | ")}</p>
                  ) : null}
                </div>
              ) : null}
              {planDetailsOpen && agent001Decision ? (
                <div className="rounded-lg border border-white/10 bg-slate-900/60 p-2 text-xs text-slate-200">
                  <p className="font-semibold text-emerald-200">Agent001 Plan</p>
                  <p className="mt-1 text-slate-400">
                    {tr("计划版本/时间戳", "Plan version/timestamp")}:{" "}
                    <span className="font-mono">{agent001Decision.version || "v1.1-en"}</span>{" "}
                    /{" "}
                    <span className="font-mono">{agent001Decision.generatedAt ? formatTxTime(agent001Decision.generatedAt) : "-"}</span>
                  </p>
                  <p className="mt-1">
                    {tr("决策", "decision")}: <span className={cn(agent001Decision.shouldPlaceOrder ? "text-emerald-300" : "text-amber-300")}>
                      {agent001Decision.shouldPlaceOrder ? tr("执行计划", "Execute") : tr("暂不执行", "Skip")}
                    </span>
                  </p>
                  <p>
                    {agent001Decision.plan.symbol} {agent001Decision.plan.side || "-"} {agent001Decision.plan.orderType || "-"} size=
                    {agent001Decision.plan.size ?? "-"} entry={agent001Decision.plan.entryPrice ?? "-"} TP={agent001Decision.plan.takeProfit ?? "-"} SL=
                    {agent001Decision.plan.stopLoss ?? "-"}
                  </p>
                  <p className="mt-1 text-slate-300">{tr("原因", "Reason")}: {agent001Decision.reason || agent001Decision.text || "-"}</p>
                  {agent001Decision.text ? (
                    <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-slate-400">
                      {tr("完整说明", "Full")}: {agent001Decision.text}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="mb-1 font-semibold text-cyan-200">{tr("消息面结果", "Info-side Result")}</div>
                <p className="whitespace-pre-wrap break-words text-slate-200">{infoSnippetDisplay}</p>
                {infoSnippetTooLong ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 border-white/20 bg-black/35 px-2 text-[11px] text-slate-100"
                    onClick={() => setInfoSnippetExpanded((prev) => !prev)}
                  >
                    {infoSnippetExpanded ? tr("收起摘要", "Collapse Summary") : tr("展开摘要", "Expand Summary")}
                  </Button>
                ) : null}
                <p className="mt-1 text-slate-400">score: {messageScore > 0 ? messageScore.toFixed(3) : "-"}</p>
                {infoPreviewLines.length > 0 ? (
                  <div className="mt-2 space-y-1 rounded border border-white/10 bg-slate-950/40 p-2 text-[11px] text-slate-300">
                    {infoPreviewLines.map((line, idx) => (
                      <p key={`info_preview_${idx}`} className="break-words">{line}</p>
                    ))}
                  </div>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-300">{tr("展开完整 JSON（可选）", "Expand full JSON (optional)")}</summary>
                  <pre className="mt-2 max-h-56 overflow-y-auto rounded bg-slate-900/70 p-2 text-[11px] whitespace-pre-wrap break-words text-slate-200">
                    {infoRawText || "{}"}
                  </pre>
                </details>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="mb-1 font-semibold text-cyan-200">{tr("技术面结果", "Technical-side Result")}</div>
                <p className="whitespace-pre-wrap break-words text-slate-200">{technicalSnippetDisplay}</p>
                {technicalSnippetTooLong ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 border-white/20 bg-black/35 px-2 text-[11px] text-slate-100"
                    onClick={() => setTechnicalSnippetExpanded((prev) => !prev)}
                  >
                    {technicalSnippetExpanded ? tr("收起摘要", "Collapse Summary") : tr("展开摘要", "Expand Summary")}
                  </Button>
                ) : null}
                <p className="mt-1 text-slate-400">score: {technicalScore > 0 ? technicalScore.toFixed(3) : "-"}</p>
                {technicalPreviewLines.length > 0 ? (
                  <div className="mt-2 space-y-1 rounded border border-white/10 bg-slate-950/40 p-2 text-[11px] text-slate-300">
                    {technicalPreviewLines.map((line, idx) => (
                      <p key={`tech_preview_${idx}`} className="break-words">{line}</p>
                    ))}
                  </div>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-300">{tr("展开完整 JSON（可选）", "Expand full JSON (optional)")}</summary>
                  <pre className="mt-2 max-h-56 overflow-y-auto rounded bg-slate-900/70 p-2 text-[11px] whitespace-pre-wrap break-words text-slate-200">
                    {technicalRawText || "{}"}
                  </pre>
                </details>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="order-1 border-white/10 bg-black/45 py-4 text-white">
        <CardContent className="px-4 sm:px-6">
          <details className="rounded-xl border border-white/10 bg-white/5 p-3">
            <summary className="cursor-pointer select-none text-sm font-semibold text-cyan-200">
              {tr("流程演示控制（可选）", "Flow Demo Controls (Optional)")}
            </summary>
            <p className="mt-1 text-xs text-slate-400">
              {tr("默认收起，避免干扰主交易视图。", "Collapsed by default to keep the main trading view clean.")}
            </p>
            <div className="mt-3 space-y-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Tabs value={demoView} onValueChange={(v) => setDemoView(v as DemoView)} className="w-full lg:max-w-[360px]">
                <TabsList className="grid w-full grid-cols-2 bg-white/8">
                  <TabsTrigger value="general" className="data-[state=active]:bg-cyan-500/30">{tr("通用流程", "General Flow")}</TabsTrigger>
                  <TabsTrigger value="detailed" className="data-[state=active]:bg-blue-500/30">{tr("详细流程", "Detailed Flow")}</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-200">
                {demoView === "general"
                  ? tr(
                      "通用演示：Other Agent 与 Agent001 通过 DM 协商 -> x402(服务) -> x402(API) -> API。",
                      "General Demo: Other Agent <-> Agent001 (DM) -> x402(Service) -> x402(API) -> API"
                    )
                  : tr(
                      "详细演示：消息面+技术面 Agent 与 Agent001 按 报价/支付/回传 协作，并走双 x402 流程。",
                      "Detailed Demo: News/Fundamental + Technical analysis agents collaborate with Agent001 through quote/pay/result + dual x402 flow"
                    )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={start} className="h-10 bg-gradient-to-r from-cyan-400 to-blue-600 text-black">
                <Play className="size-4" />
                {tr("开始可审计流程演示", "Start Auditable Flow Demo")}
              </Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={pause}>
                <CirclePause className="size-4" />
                {tr("暂停", "Pause")}
              </Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={next}>
                <SkipForward className="size-4" />
                {tr("下一步", "Next Step")}
              </Button>
              <Button variant="outline" className="border-white/30 bg-black/35 text-white" onClick={replay}>
                <RotateCcw className="size-4" />
                {tr("重播", "Replay")}
              </Button>
              <Button
                variant="outline"
                className={cn(
                  "border-white/30 bg-black/35 text-white",
                  forceOrderDemo ? "border-emerald-400/40 text-emerald-200" : "border-amber-400/40 text-amber-200"
                )}
                onClick={() => setForceOrderDemo((prev) => !prev)}
              >
                {forceOrderDemo ? tr("强制下单演示：开", "Force Order Demo: ON") : tr("强制下单演示：关", "Force Order Demo: OFF")}
              </Button>
              <Badge className="border border-emerald-400/40 bg-emerald-500/10 text-emerald-200">
                Live XMTP + x402
              </Badge>
              <Badge className="border border-white/25 bg-white/5 text-slate-200">
                x402 {tr("阶段", "phase")}: {x402PhaseLabel}
              </Badge>
            </div>
          </div>

          <div className="grid gap-2 text-sm md:grid-cols-5">
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs text-slate-300">{tr("播放状态", "Playback")}</div>
              <div className="font-semibold">{playback.toUpperCase()}</div>
            </div>
            <div className="rounded-lg border border-purple-400/25 bg-purple-400/8 px-3 py-2">
              <div className="text-xs text-purple-200">verificationHash</div>
              <div className="font-mono text-sm">{shortHash(verificationHash)}</div>
            </div>
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/8 px-3 py-2">
              <div className="text-xs text-cyan-200">{demoView === "general" ? "otherAgentQuote" : "newsQuote"}</div>
              <div className="font-mono text-sm">{messageQuote > 0 ? messageQuote.toFixed(5) : "-"}</div>
            </div>
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/8 px-3 py-2">
              <div className="text-xs text-cyan-200">{demoView === "general" ? "serviceScore" : "technicalQuote"}</div>
              <div className="font-mono text-sm">
                {demoView === "general" ? (messageScore > 0 ? messageScore.toFixed(3) : "-") : technicalQuote > 0 ? technicalQuote.toFixed(5) : "-"}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/8 px-3 py-2">
              <div className="text-xs text-emerald-200">receiptRef</div>
              <div className="font-mono text-sm">{shortHash(receiptRef)}</div>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div animate={{ width: `${progress}%` }} className="h-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-orange-400" />
          </div>
          <p className="text-sm text-slate-300">{current ? `${current.title}: ${current.description}` : tr("已就绪，可运行完整可审计 Agent 工作流。", "Ready to run complete auditable agent workflow.")}</p>
          <p className="text-xs text-amber-200/90">{tr("决策", "Decision")}: {decision}</p>
          {agent001Decision ? (
            <p className="text-xs text-emerald-200/90">
              {tr("Agent001 计划", "Agent001 plan")}: {agent001Decision.plan.symbol} {agent001Decision.plan.side || "-"} {agent001Decision.plan.orderType || "-"} size=
              {agent001Decision.plan.size ?? "-"} entry={agent001Decision.plan.entryPrice ?? "-"} TP={agent001Decision.plan.takeProfit ?? "-"} SL=
              {agent001Decision.plan.stopLoss ?? "-"}
            </p>
          ) : null}
          {agent001Decision?.text ? <p className="text-xs text-slate-300/90">{tr("Agent001 推理", "Agent001 reasoning")}: {agent001Decision.text}</p> : null}
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="order-2 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative overflow-hidden border-white/10 bg-black/45 py-0 text-white">
          <div className="relative h-[70vh] min-h-[620px]">
            <div className="pointer-events-none absolute inset-0 z-0">
              <div className="absolute left-3 top-24 h-[76%] w-[34%] rounded-[30px] border border-cyan-300/20 bg-cyan-400/10 shadow-[0_0_40px_rgba(56,189,248,0.15)]" />
              <div className="absolute left-[38%] top-24 h-[76%] w-[24%] rounded-[30px] border border-blue-300/18 bg-blue-400/10 shadow-[0_0_40px_rgba(59,130,246,0.12)]" />
              <div className="absolute right-3 top-24 h-[76%] w-[35%] rounded-[30px] border border-orange-300/20 bg-orange-400/10 shadow-[0_0_40px_rgba(249,115,22,0.14)]" />
            </div>

            <ReactFlow
              nodes={drawNodes}
              edges={drawEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              connectionLineType={ConnectionLineType.Bezier}
              className="!bg-transparent"
              minZoom={0.55}
              maxZoom={1.35}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#111827" gap={24} size={1} />
              <Controls className="!border-white/20 !bg-black/70 !text-white" />
              <MiniMap className="!hidden sm:!block !border !border-white/10 !bg-black/60" />
              <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-xs tracking-wide">
                {tr("KITE TRACE PLATFORM · 全流程可审计", "KITE TRACE PLATFORM · FULL AUDITABILITY")}
              </div>
            </ReactFlow>

            <div className="pointer-events-none absolute bottom-4 left-4 z-20 w-[320px] rounded-xl border border-white/15 bg-black/65 p-3 text-xs text-slate-100">
              <div className="mb-2 font-semibold text-white">{tr("图例", "Legend")}</div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-purple-500" />
                  {tr("紫色虚线 = ERC8004 验证", "Purple dashed = ERC8004 verification")}
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-sky-400" />
                  {demoView === "general"
                    ? tr("蓝色双向箭头 = XMTP DM（报价+回传）", "Blue double-arrow = XMTP DM (quote + result)")
                    : tr("蓝色箭头 = XMTP DM 报价与服务回传", "Blue arrows = XMTP DM quote + service results")}
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-amber-400" />
                  {tr("琥珀色 = Agent001 决策状态", "Amber = Agent001 decision state")}
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-emerald-500" />
                  {tr("绿色 = x402 服务/API 支付解锁", "Green = x402 service/API payment unlock flows")}
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-8 bg-orange-500" />
                  {tr("橙色 = API 下单请求/响应", "Orange = API order request/response")}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="h-[70vh] min-h-[620px] border-white/10 bg-black/45 py-0 text-white">
          <CardHeader className="border-b border-white/10 pb-4">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="size-4 text-cyan-300" />
                {tr("审计轨迹", "Audit Trail")}
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-cyan-400/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                onClick={() => void downloadCurrentRunEvidence()}
                disabled={downloadingEvidence || !hasCurrentRunEvidence}
                title={hasCurrentRunEvidence ? tr("下载本次运行证据包", "Download current run evidence pack") : tr("当前暂无证据", "No run evidence yet")}
              >
                <Download className="size-3.5" />
                {tr("下载证据包", "Download Evidence Pack")}
              </Button>
            </div>
            <CardDescription className="text-slate-300">{tr("从信号摄取到执行决策的逐步可验证记录。", "Step-by-step verifiable records from signal ingestion to execution decision.")}</CardDescription>
            {evidenceHint ? <p className="text-xs text-cyan-200">{evidenceHint}</p> : null}
          </CardHeader>
          <CardContent className="h-[calc(70vh-92px)] space-y-3 overflow-y-auto px-4 pb-4 pt-4">
            {audit.length === 0 ? <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-300">{tr("暂无审计记录。请先开始演示。", "No audit entries yet. Start demo playback.")}</div> : null}
            {audit.map((entry) => {
              const payload = entry.payload || {};
              const entryRequestIds = [
                normalizeRequestId(payload["infoRequestId"]),
                normalizeRequestId(payload["technicalRequestId"]),
                normalizeRequestId(payload["orderRef"]),
                receiptRefToRequestId(entry.receiptRef),
              ].filter(Boolean);
              const canDownloadEntryEvidence = entryRequestIds.length > 0;

              return (
                <motion.div key={entry.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{entry.stepName}</div>
                      <div className="text-xs text-slate-400">
                        {entry.tsLocal} · {entry.mode.toUpperCase()}
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/20 text-emerald-200">{tr("链上可验证", "Blockchain Verifiable")}</Badge>
                  </div>
                  <Separator className="bg-white/10" />
                  <div className="space-y-1 text-xs text-slate-200">
                    {entry.verificationHash ? (
                      <p>
                        <span className="text-slate-400">{tr("验证哈希", "verificationHash")}:</span> <span className="font-mono">{shortHash(entry.verificationHash)}</span>
                      </p>
                    ) : null}
                    {entry.xmtpSnippet ? (
                      <p>
                        <span className="text-slate-400">{tr("XMTP 摘要", "xmtpSnippet")}:</span> {entry.xmtpSnippet}
                      </p>
                    ) : null}
                    {entry.receiptRef ? (
                      <p>
                        <span className="text-slate-400">{tr("回执引用", "receiptRef")}:</span> <span className="font-mono">{shortHash(entry.receiptRef)}</span>
                      </p>
                    ) : null}
                    {entry.messageServiceTxHash ? (
                      <p>
                        <span className="text-slate-400">{tr("消息面支付Tx", "newsAgentTxHash")}:</span>{" "}
                        <a
                          href={txExplorerUrl(entry.messageServiceTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-cyan-300 underline decoration-cyan-400/40 underline-offset-2"
                        >
                          {shortHash(entry.messageServiceTxHash)}
                        </a>{" "}
                        <span className="text-slate-400">
                          ({formatTxTime(entry.messageServicePaidAt)} {formatTxAge(entry.messageServicePaidAt)})
                        </span>
                      </p>
                    ) : null}
                    {entry.technicalServiceTxHash ? (
                      <p>
                        <span className="text-slate-400">{tr("技术面支付Tx", "technicalAgentTxHash")}:</span>{" "}
                        <a
                          href={txExplorerUrl(entry.technicalServiceTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-cyan-300 underline decoration-cyan-400/40 underline-offset-2"
                        >
                          {shortHash(entry.technicalServiceTxHash)}
                        </a>{" "}
                        <span className="text-slate-400">
                          ({formatTxTime(entry.technicalServicePaidAt)} {formatTxAge(entry.technicalServicePaidAt)})
                        </span>
                      </p>
                    ) : null}
                    {entry.apiGateTxHash ? (
                      <p>
                        <span className="text-slate-400">{tr("API 网关支付Tx", "apiGateTxHash")}:</span>{" "}
                        <a
                          href={txExplorerUrl(entry.apiGateTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-orange-300 underline decoration-orange-400/40 underline-offset-2"
                        >
                          {shortHash(entry.apiGateTxHash)}
                        </a>{" "}
                        <span className="text-slate-400">
                          ({formatTxTime(entry.apiGatePaidAt)} {formatTxAge(entry.apiGatePaidAt)})
                        </span>
                      </p>
                    ) : null}
                    {entry.decisionBasis ? (
                      <p>
                        <span className="text-slate-400">{tr("决策依据", "decisionBasis")}:</span> {entry.decisionBasis}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 border-white/20 bg-black/35 text-xs text-white" onClick={() => void copyAudit(entry)}>
                      {copiedId === entry.id ? (
                        <>
                          <Check className="size-3.5" />
                           {tr("已复制", "Copied")}
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="size-3.5" />
                           {tr("复制", "Copy")}
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-cyan-400/35 bg-cyan-500/10 text-xs text-cyan-100 hover:bg-cyan-500/20"
                      onClick={() => void downloadEntryEvidence(entry)}
                      disabled={!canDownloadEntryEvidence || downloadingEvidence}
                    >
                      <Download className="size-3.5" />
                      {tr("证据", "Evidence")}
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg border-emerald-400/35 bg-slate-950/92 text-white backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="text-emerald-300">{tr("执行交易计划（二次确认）", "Execute Trade Plan (Confirm)")}</DialogTitle>
            <DialogDescription className="text-slate-300">
              {tr(
                "你可以在执行前微调 size / TP / SL，然后提交到 Agent001 执行通道。",
                "You can fine-tune size / TP / SL before submitting to Agent001 execution channel."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <label className="grid gap-1">
              <span className="text-slate-300">Symbol</span>
              <input
                className="rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-white outline-none"
                value={executionDraft.symbol}
                onChange={(e) => setExecutionDraft((prev) => ({ ...prev, symbol: String(e.target.value || "").trim().toUpperCase() }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-slate-300">Side</span>
                <select
                  className="rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-white outline-none"
                  value={executionDraft.side}
                  onChange={(e) =>
                    setExecutionDraft((prev) => ({ ...prev, side: e.target.value === "sell" ? "sell" : "buy" }))
                  }
                >
                  <option value="buy">buy</option>
                  <option value="sell">sell</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-slate-300">Order Type</span>
                <select
                  className="rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-white outline-none"
                  value={executionDraft.orderType}
                  onChange={(e) =>
                    setExecutionDraft((prev) => ({
                      ...prev,
                      orderType: e.target.value === "limit" ? "limit" : "market",
                    }))
                  }
                >
                  <option value="market">market</option>
                  <option value="limit">limit</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-slate-300">Size</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  className="rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-white outline-none"
                  value={executionDraft.size}
                  onChange={(e) => setExecutionDraft((prev) => ({ ...prev, size: Math.max(0, Number(e.target.value || 0)) }))}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-slate-300">Limit Entry</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-white outline-none"
                  value={executionDraft.entryPrice ?? ""}
                  onChange={(e) =>
                    setExecutionDraft((prev) => ({
                      ...prev,
                      entryPrice: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-slate-300">Take Profit</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-white outline-none"
                  value={executionDraft.takeProfit ?? ""}
                  onChange={(e) =>
                    setExecutionDraft((prev) => ({
                      ...prev,
                      takeProfit: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1">
                <span className="text-slate-300">Stop Loss</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-white outline-none"
                  value={executionDraft.stopLoss ?? ""}
                  onChange={(e) =>
                    setExecutionDraft((prev) => ({
                      ...prev,
                      stopLoss: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </label>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="outline" className="border-white/25 bg-black/30 text-white" onClick={() => setConfirmOpen(false)}>
                {tr("取消", "Cancel")}
              </Button>
              <Button
                className="bg-gradient-to-r from-emerald-400 to-cyan-500 text-black"
                onClick={() => void executeTradePlan()}
                disabled={executingPlan || !executionDraft.symbol || executionDraft.size <= 0}
              >
                {executingPlan ? tr("提交中...", "Submitting...") : tr("确认执行", "Confirm Execute")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dmOpen} onOpenChange={setDmOpen}>
        <DialogContent className="max-w-xl border-cyan-400/35 bg-slate-950/92 text-white backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="text-cyan-300">XMTP DM: Quote + Service Result</DialogTitle>
            <DialogDescription className="text-slate-300">
              {demoView === "general"
                ? tr(
                    "Agent001 与 Other Agent 协商单一路径报价，先走 x402(服务) 支付，随后在 API 调用前支付 x402(API)。",
                    "Agent001 negotiates one quote with Other Agent, pays via x402(service), then later pays via x402(API) before API call."
                  )
                : tr(
                    "Agent001 先协商报价，再走 x402(服务) 支付，通过 DM 收到结果，最后在 API 调用前支付 x402(API)。",
                    "Agent001 negotiates quotes first, pays via x402(service), receives results via DM, then pays via x402(API) before API call."
                  )}
            </DialogDescription>
          </DialogHeader>
          {demoView === "general" ? (
            <div className="space-y-3 rounded-xl border border-cyan-400/25 bg-slate-900/70 p-4 text-sm">
              <div>
                <div className="text-xs text-cyan-200">Other Agent</div>
                <p>{tr("报价", "quote")}: {messageQuote > 0 ? messageQuote.toFixed(5) : tr("待返回...", "pending...")}</p>
                <p className="mt-1">{messageSnippet || tr("服务结果待返回...", "service result pending...")}</p>
                <div className="mt-1 text-xs text-slate-400">{tr("结果分数", "result score")}: {messageScore > 0 ? messageScore.toFixed(3) : "-"}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-cyan-400/25 bg-slate-900/70 p-4 text-sm">
              <div>
                <div className="text-xs text-cyan-200">{tr("消息面/基本面 Agent", "News/Fundamental Analysis Agent")}</div>
                <p>{tr("报价", "quote")}: {messageQuote > 0 ? messageQuote.toFixed(5) : tr("待返回...", "pending...")}</p>
                <p className="mt-1">{messageSnippet || tr("服务结果待返回...", "service result pending...")}</p>
                <div className="mt-1 text-xs text-slate-400">{tr("结果分数", "result score")}: {messageScore > 0 ? messageScore.toFixed(3) : "-"}</div>
              </div>
              <Separator className="bg-white/10" />
              <div>
                <div className="text-xs text-cyan-200">{tr("技术面 Agent", "Technical Analysis Agent")}</div>
                <p>{tr("报价", "quote")}: {technicalQuote > 0 ? technicalQuote.toFixed(5) : tr("待返回...", "pending...")}</p>
                <p className="mt-1">{technicalSnippet || tr("服务结果待返回...", "service result pending...")}</p>
                <div className="mt-1 text-xs text-slate-400">{tr("结果分数", "result score")}: {technicalScore > 0 ? technicalScore.toFixed(3) : "-"}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        @keyframes edge-dash {
          to {
            stroke-dashoffset: -44;
          }
        }
      `}</style>
    </div>
  );
}

