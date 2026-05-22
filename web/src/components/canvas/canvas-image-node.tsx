"use client";

import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Loader2, Play, RefreshCcw, X } from "lucide-react";

import { useCanvasNodeContext } from "@/components/canvas/canvas-node-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CanvasImageNode as CanvasImageNodeType } from "@/types/canvas";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  idle: { label: "待运行", className: "bg-stone-100 text-stone-500" },
  queued: { label: "排队中", className: "bg-amber-50 text-amber-600" },
  running: { label: "生成中", className: "bg-blue-50 text-blue-600" },
  success: { label: "完成", className: "bg-emerald-50 text-emerald-600" },
  error: { label: "失败", className: "bg-rose-50 text-rose-600" },
};

export function CanvasImageNode({ id, data, selected }: NodeProps<CanvasImageNodeType>) {
  const ctx = useCanvasNodeContext();
  const status = data.status;
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.idle;
  const previewSrc = data.b64_json
    ? `data:image/png;base64,${data.b64_json}`
    : data.url || "";
  const [titleDraft, setTitleDraft] = useState(data.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);

  return (
    <div
      className={cn(
        "relative flex w-[300px] flex-col rounded-3xl border bg-white shadow-[0_18px_45px_-30px_rgba(15,23,42,0.4)]",
        selected ? "border-stone-900" : "border-stone-200",
      )}
    >
      <NodeResizer
        minWidth={260}
        minHeight={320}
        isVisible={selected}
        lineClassName="!border-stone-300"
        handleClassName="!h-2 !w-2 !rounded-full !border-stone-300 !bg-white"
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!z-10 !h-3 !w-3 !rounded-full !border-stone-400 !bg-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!z-10 !h-3 !w-3 !rounded-full !border-stone-400 !bg-white"
      />

      <div className="flex flex-1 flex-col overflow-hidden rounded-[inherit]">
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
            className="min-w-0 flex-1 rounded-md bg-stone-50 px-2 py-1 text-xs font-semibold text-stone-900 outline-none ring-1 ring-stone-200"
          />
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setTitleDraft(data.title ?? "");
              setEditingTitle(true);
            }}
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-stone-900 hover:text-stone-600"
          >
            {data.title || "节点"}
          </button>
        )}

        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            ctx.onDelete(id);
          }}
          className="shrink-0 rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-rose-500"
          aria-label="删除节点"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="relative aspect-[4/3] bg-stone-50">
        {status === "running" ? (
          <div className="absolute inset-0 flex items-center justify-center text-stone-400">
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
            {status === "error" ? data.error : "运行后显示生成图"}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <Textarea
          value={data.prompt}
          onChange={(event) => ctx.onChangePrompt(id, event.target.value)}
          placeholder="输入提示词..."
          rows={3}
          className="h-20 resize-none rounded-2xl border-stone-200 bg-stone-50 px-3 py-2 text-[12px] leading-relaxed text-stone-800 shadow-none focus-visible:ring-stone-300"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-stone-400">
            {status === "error" && data.error ? `错误：${data.error.slice(0, 40)}` : ""}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-7 rounded-full bg-stone-950 px-3 text-[11px] text-white hover:bg-stone-800"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onRun(id);
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
      </div>
    </div>
  );
}

CanvasImageNode.displayName = "CanvasImageNode";
