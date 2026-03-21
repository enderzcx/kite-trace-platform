"use client";

import { motion } from "framer-motion";
import { Bot, Cpu, Server, ShieldCheck, Wallet } from "lucide-react";
import { Handle, NodeProps, Position } from "reactflow";

type NodeKind = "agent" | "protocol" | "settlement" | "api" | "decision";

export interface NetworkNodeData {
  title: string;
  subtitle: string;
  kind: NodeKind;
  status?: "idle" | "active";
}

const ICONS: Record<NodeKind, typeof Bot> = {
  agent: Bot,
  protocol: ShieldCheck,
  settlement: Wallet,
  api: Server,
  decision: Cpu,
};

const BORDERS: Record<NodeKind, string> = {
  agent: "rgba(56, 189, 248, 0.75)",
  protocol: "rgba(168, 85, 247, 0.8)",
  settlement: "rgba(34, 197, 94, 0.78)",
  api: "rgba(249, 115, 22, 0.78)",
  decision: "rgba(245, 158, 11, 0.78)",
};

export function NetworkNode({ data }: NodeProps<NetworkNodeData>) {
  const Icon = ICONS[data.kind];
  const active = data.status === "active";
  return (
    <motion.div
      animate={{ scale: active ? 1.03 : 1, boxShadow: active ? `0 0 26px ${BORDERS[data.kind]}` : "none" }}
      className="min-w-[220px] rounded-2xl border bg-black/55 px-4 py-3 text-white backdrop-blur-lg"
      style={{ borderColor: BORDERS[data.kind] }}
    >
      <Handle id="t-top" type="target" position={Position.Top} className="!opacity-0" />
      <Handle id="t-left" type="target" position={Position.Left} className="!opacity-0" />
      <Handle id="t-right" type="target" position={Position.Right} className="!opacity-0" />
      <Handle id="t-bottom" type="target" position={Position.Bottom} className="!opacity-0" />
      <Handle id="s-top" type="source" position={Position.Top} className="!opacity-0" />
      <Handle id="s-left" type="source" position={Position.Left} className="!opacity-0" />
      <Handle id="s-right" type="source" position={Position.Right} className="!opacity-0" />
      <Handle id="s-bottom" type="source" position={Position.Bottom} className="!opacity-0" />
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full border" style={{ borderColor: BORDERS[data.kind] }}>
          <Icon className="size-4" />
        </span>
        <span className="text-[15px] font-semibold">{data.title}</span>
      </div>
      <p className="text-[12px] text-slate-200">{data.subtitle}</p>
    </motion.div>
  );
}
