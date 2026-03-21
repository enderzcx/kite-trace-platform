"use client";

import { BaseEdge, EdgeLabelRenderer, EdgeProps, getBezierPath } from "reactflow";

type EdgeChannel = "xmtp" | "x402" | "erc8004" | "decision" | "api";

export interface NetworkEdgeData {
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

const COLORS: Record<EdgeChannel, string> = {
  xmtp: "#38bdf8",
  x402: "#22c55e",
  erc8004: "#a855f7",
  decision: "#f59e0b",
  api: "#f97316",
};

export function GlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  data,
}: EdgeProps<NetworkEdgeData>) {
  const [path, x, y] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: data?.curvature ?? 0.24,
  });
  const color = COLORS[data?.channel ?? "api"];
  const active = Boolean(data?.active);
  const dim = Boolean(data?.dimmed);
  const dashed = data?.channel === "erc8004";
  const showLabel = Boolean(data?.label);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: active ? 3 : 2,
          opacity: dim ? 0.32 : active ? 1 : 0.72,
          filter: active ? `drop-shadow(0 0 8px ${color})` : "none",
          strokeDasharray: dashed ? "8 6" : active ? "14 8" : undefined,
          animation: active ? "edge-dash 1.2s linear infinite" : undefined,
        }}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[11px] text-white"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              whiteSpace: "nowrap",
              transform: `translate(-50%, -50%) translate(${x + (data?.labelOffsetX ?? 0)}px, ${y + (data?.labelOffsetY ?? -8)}px)`,
            }}
          >
            {data?.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {data?.leftHint || data?.rightHint ? (
        <EdgeLabelRenderer>
          <>
            {data.leftHint ? (
              <div
                className="nodrag nopan rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[11px] text-white"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  whiteSpace: "nowrap",
                  transform: `translate(-50%, -50%) translate(${x - 170}px, ${y + (data.leftHintOffsetY ?? 18)}px)`,
                }}
              >
                {data.leftHint}
              </div>
            ) : null}
            {data.rightHint ? (
              <div
                className="nodrag nopan rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[11px] text-white"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  whiteSpace: "nowrap",
                  transform: `translate(-50%, -50%) translate(${x + 170}px, ${y + (data.rightHintOffsetY ?? -24)}px)`,
                }}
              >
                {data.rightHint}
              </div>
            ) : null}
          </>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
