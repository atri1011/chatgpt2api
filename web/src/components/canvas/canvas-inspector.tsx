"use client";

import { CircleAlert, ImageIcon, Layers3, Network, Settings2, Type } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  isConfigNode,
  isImageNode,
  isPromptNode,
  type CanvasAnyNode,
  type CanvasEdge,
  type CanvasNodeStatus,
} from "@/types/canvas";

type CanvasInspectorProps = {
  nodes: CanvasAnyNode[];
  edges: CanvasEdge[];
  selectedNodeIds: string[];
  className?: string;
};

const STATUS_LABEL: Record<CanvasNodeStatus, string> = {
  idle: "待运行",
  queued: "排队中",
  running: "生成中",
  success: "完成",
  error: "失败",
};

function getNodeTitle(node: CanvasAnyNode) {
  if (isImageNode(node)) return node.data.title || "图片节点";
  if (isConfigNode(node)) return node.data.title || "生成配置";
  return node.data.title || "提示词";
}

function getNodeKind(node: CanvasAnyNode) {
  if (isImageNode(node)) return "图片";
  if (isConfigNode(node)) return "配置";
  return "提示词";
}

function getNodeIcon(node: CanvasAnyNode) {
  if (isImageNode(node)) return ImageIcon;
  if (isConfigNode(node)) return Settings2;
  return Type;
}

function getStatusClass(status: CanvasNodeStatus) {
  if (status === "success") return "bg-emerald-500";
  if (status === "error") return "bg-rose-500";
  if (status === "running" || status === "queued") return "bg-amber-500";
  return "bg-stone-400";
}

function countByStatus(nodes: CanvasAnyNode[]) {
  return nodes.reduce<Record<CanvasNodeStatus, number>>(
    (acc, node) => {
      if (isPromptNode(node)) {
        acc.idle += 1;
        return acc;
      }
      acc[node.data.status] += 1;
      return acc;
    },
    { idle: 0, queued: 0, running: 0, success: 0, error: 0 },
  );
}

function NodeSummary({ node, edges }: { node: CanvasAnyNode; edges: CanvasEdge[] }) {
  const Icon = getNodeIcon(node);
  const incoming = edges.filter((edge) => edge.target === node.id).length;
  const outgoing = edges.filter((edge) => edge.source === node.id).length;
  const status = isPromptNode(node) ? "idle" : node.data.status;
  const prompt =
    isPromptNode(node) || isImageNode(node) || isConfigNode(node) ? node.data.prompt.trim() : "";

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-600">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-stone-900">
            {getNodeTitle(node)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-500">
            <span>{getNodeKind(node)}</span>
            <span className="h-1 w-1 rounded-full bg-stone-300" />
            <span className="inline-flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", getStatusClass(status))} />
              {STATUS_LABEL[status]}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-md bg-stone-50 px-2 py-2">
          <div className="font-semibold text-stone-900">{incoming}</div>
          <div className="text-stone-500">输入</div>
        </div>
        <div className="rounded-md bg-stone-50 px-2 py-2">
          <div className="font-semibold text-stone-900">{outgoing}</div>
          <div className="text-stone-500">输出</div>
        </div>
        <div className="rounded-md bg-stone-50 px-2 py-2">
          <div className="font-semibold text-stone-900">
            {Math.round(node.position.x)}, {Math.round(node.position.y)}
          </div>
          <div className="text-stone-500">坐标</div>
        </div>
      </div>

      {isImageNode(node) && node.data.isBatchRoot ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
          <Layers3 className="size-3" />
          批次 {node.data.batchChildIds?.length ?? 0} 张
        </div>
      ) : null}

      {!isPromptNode(node) && node.data.error ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-100 bg-rose-50 px-2 py-1.5 text-[11px] font-medium text-rose-700">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-3">{node.data.error}</span>
        </div>
      ) : null}

      {prompt ? (
        <div className="mt-2 rounded-md bg-stone-50 px-2 py-1.5 text-[11px] leading-relaxed text-stone-600">
          <span className="line-clamp-4">{prompt}</span>
        </div>
      ) : null}
    </div>
  );
}

export function CanvasInspector({
  nodes,
  edges,
  selectedNodeIds,
  className,
}: CanvasInspectorProps) {
  const selectedSet = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter((node) => selectedSet.has(node.id));
  const statusCounts = countByStatus(nodes);
  const imageCount = nodes.filter(isImageNode).length;
  const configCount = nodes.filter(isConfigNode).length;
  const promptCount = nodes.filter(isPromptNode).length;

  return (
    <aside
      className={cn(
        "pointer-events-auto w-[300px] rounded-lg border border-stone-200/80 bg-white/95 p-3 shadow-[0_18px_44px_-24px_rgba(28,25,23,0.24)] backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-600">
            <Network className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-stone-900">画布状态</div>
            <div className="text-[11px] text-stone-500">
              {nodes.length} 节点 / {edges.length} 连线
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-md bg-amber-50 px-2 py-2 text-amber-700">
          <div className="font-bold">{promptCount}</div>
          <div>提示词</div>
        </div>
        <div className="rounded-md bg-sky-50 px-2 py-2 text-sky-700">
          <div className="font-bold">{imageCount}</div>
          <div>图片</div>
        </div>
        <div className="rounded-md bg-indigo-50 px-2 py-2 text-indigo-700">
          <div className="font-bold">{configCount}</div>
          <div>配置</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5 text-[10px] font-medium text-stone-600">
        {(["queued", "running", "success", "error"] as CanvasNodeStatus[]).map((status) => (
          <div
            key={status}
            className="flex items-center justify-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-1.5 py-1"
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", getStatusClass(status))} />
            {statusCounts[status]}
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {selectedNodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-3 py-4 text-center text-xs text-stone-500">
            未选择节点
          </div>
        ) : selectedNodes.length === 1 ? (
          <NodeSummary node={selectedNodes[0]} edges={edges} />
        ) : (
          <div className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="text-sm font-semibold text-stone-900">
              已选择 {selectedNodes.length} 个节点
            </div>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
              {selectedNodes.map((node) => {
                const Icon = getNodeIcon(node);
                return (
                  <div
                    key={node.id}
                    className="flex items-center gap-2 rounded-md bg-stone-50 px-2 py-1.5 text-[11px] text-stone-600"
                  >
                    <Icon className="size-3.5 shrink-0 text-stone-500" />
                    <span className="truncate">{getNodeTitle(node)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
