"use client";

import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Layers, Loader2, Play, RefreshCcw, X } from "lucide-react";

import { useCanvasNodeContext } from "@/components/canvas/canvas-node-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { normalizeBase64 } from "@/lib/base64";
import { cn } from "@/lib/utils";
import type { CanvasImageNode as CanvasImageNodeType } from "@/types/canvas";

const STATUS_CONFIG: Record<
  string,
  { label: string; dotClass: string; bgClass: string; textClass: string }
> = {
  idle: {
    label: "待运行",
    dotClass: "bg-stone-400",
    bgClass: "bg-stone-50 border-stone-200",
    textClass: "text-stone-600",
  },
  queued: {
    label: "排队中",
    dotClass: "bg-amber-400 animate-pulse",
    bgClass: "bg-amber-50 border-amber-100",
    textClass: "text-amber-700",
  },
  running: {
    label: "生成中",
    dotClass: "bg-indigo-500 animate-pulse",
    bgClass: "bg-indigo-50 border-indigo-100",
    textClass: "text-indigo-700",
  },
  success: {
    label: "完成",
    dotClass: "bg-emerald-500",
    bgClass: "bg-emerald-50 border-emerald-100",
    textClass: "text-emerald-700",
  },
  error: {
    label: "失败",
    dotClass: "bg-rose-500",
    bgClass: "bg-rose-50 border-rose-100",
    textClass: "text-rose-700",
  },
};

export function CanvasImageNode({ id, data, selected }: NodeProps<CanvasImageNodeType>) {
  const ctx = useCanvasNodeContext();
  const status = data.status;
  const previewSrc = data.b64_json
    ? `data:image/png;base64,${normalizeBase64(data.b64_json)}`
    : data.url || "";
  const [titleDraft, setTitleDraft] = useState(data.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);

  const isBatchChild = Boolean(data.batchRootId);
  const isBatchRoot = Boolean(data.isBatchRoot);
  const isStandalone = !isBatchChild && !isBatchRoot;
  const childCount = data.batchChildIds?.length ?? 0;

  return (
    <div
      className={cn(
        "relative flex w-[300px] flex-col rounded-lg border bg-white/95 shadow-[0_12px_28px_-22px_rgba(28,25,23,0.24)] backdrop-blur-md transition-all duration-200",
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/10 shadow-[0_12px_40px_-15px_rgba(99,102,241,0.25)]"
          : "border-stone-200/85",
      )}
    >
      <NodeResizer
        minWidth={260}
        minHeight={260}
        isVisible={selected}
        lineClassName="!border-indigo-500/40"
        handleClassName="!h-2 !w-2 !rounded-full !border-indigo-500 !bg-white"
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!z-10 !h-2.5 !w-2.5 !rounded-full !border-2 !border-stone-300 !bg-white transition-all duration-150 hover:!scale-110 hover:!border-indigo-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!z-10 !h-2.5 !w-2.5 !rounded-full !border-2 !border-stone-300 !bg-white transition-all duration-150 hover:!scale-110 hover:!border-indigo-500"
      />

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg">
        <header className="flex items-center justify-between gap-2 border-b border-stone-100 px-3 py-2">
          {editingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                ctx.onChangeTitle(id, titleDraft.trim() || "节点");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-900 outline-none ring-2 ring-indigo-500/10 focus:border-indigo-500"
            />
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setTitleDraft(data.title ?? "");
                setEditingTitle(true);
              }}
              className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-xs font-bold text-stone-800 transition-colors hover:text-indigo-600"
            >
              {isBatchRoot ? <Layers className="size-3 shrink-0 text-indigo-500" /> : null}
              <span className="truncate">{data.title || "节点"}</span>
              {isBatchRoot && childCount > 0 ? (
                <span className="ml-1 shrink-0 rounded-full border border-indigo-100 bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-600">
                  ×{childCount}
                </span>
              ) : null}
            </button>
          )}

          {(() => {
            const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
            return (
              <span
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors duration-150",
                  cfg.bgClass,
                  cfg.textClass,
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dotClass)} />
                {cfg.label}
              </span>
            );
          })()}

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onDelete(id);
            }}
            className="shrink-0 rounded-full p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-rose-500"
            aria-label="删除节点"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div className="relative aspect-[4/3] bg-stone-50">
          {status === "running" || status === "queued" ? (
            <div className="absolute inset-0 flex items-center justify-center text-indigo-400">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt={data.title || "生成图"}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-stone-400">
              {status === "error"
                ? data.error
                : isBatchRoot
                  ? "等待批次中首个成功结果"
                  : isBatchChild
                    ? "等待生成"
                    : "运行后显示生成图"}
            </div>
          )}
        </div>

        {isStandalone ? (
          <div className="flex flex-1 flex-col gap-2 p-3">
            <Textarea
              value={data.prompt}
              onChange={(event) => ctx.onChangeImagePrompt(id, event.target.value)}
              placeholder="输入提示词..."
              rows={3}
              className="h-20 resize-none rounded-md border-stone-200 bg-stone-50 px-3 py-2 text-[12px] leading-relaxed text-stone-800 shadow-none transition-colors focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/20"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] text-stone-400">
                {status === "error" && data.error ? `错误：${data.error.slice(0, 40)}` : ""}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-full bg-indigo-600 px-3 text-[11px] text-white shadow-sm shadow-indigo-500/10 transition-all duration-150 hover:bg-indigo-700 hover:shadow-md hover:shadow-indigo-500/15"
                onClick={(event) => {
                  event.stopPropagation();
                  ctx.onRunImage(id);
                }}
                disabled={status === "running" || status === "queued" || !data.prompt.trim()}
              >
                {status === "success" || status === "error" ? (
                  <RefreshCcw className="size-3" />
                ) : (
                  <Play className="size-3" />
                )}
                {status === "running"
                  ? "生成中..."
                  : status === "success" || status === "error"
                    ? "重新运行"
                    : "运行"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 text-[11px] text-stone-500">
            {isBatchRoot
              ? `批次根节点（共 ${childCount} 张），由上游 Config 节点驱动`
              : "批次子节点 — 跟随父级 Config 节点运行"}
            {status === "error" && data.error ? (
              <div className="mt-1 font-medium text-rose-500">错误：{data.error.slice(0, 60)}</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

CanvasImageNode.displayName = "CanvasImageNode";
