"use client";

import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import {
  Eye,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCcw,
  Type as TypeIcon,
  X,
} from "lucide-react";

import { useCanvasNodeContext } from "@/components/canvas/canvas-node-context";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  IMAGE_MODEL_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  MAX_COUNT,
  MIN_COUNT,
  type CanvasConfigNode as CanvasConfigNodeType,
  type CanvasGenerationMode,
} from "@/types/canvas";

type CanvasConfigNodeProps = NodeProps<CanvasConfigNodeType>;

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  idle: { label: "待运行", className: "bg-stone-100 text-stone-500" },
  queued: { label: "排队中", className: "bg-amber-50 text-amber-600" },
  running: { label: "生成中", className: "bg-blue-50 text-blue-600" },
  success: { label: "完成", className: "bg-emerald-50 text-emerald-600" },
  error: { label: "失败", className: "bg-rose-50 text-rose-600" },
};

export function CanvasConfigNode({ id, data, selected }: CanvasConfigNodeProps) {
  const ctx = useCanvasNodeContext();
  const [titleDraft, setTitleDraft] = useState(data.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const upstreamStats = ctx.getConfigStats(id);
  const localPromptCount = data.prompt?.trim() ? 1 : 0;
  const promptCount = upstreamStats.promptCount + localPromptCount;
  const referenceCount = upstreamStats.referenceCount;
  const stats = { promptCount, referenceCount };

  const badge = STATUS_BADGE[data.status] ?? STATUS_BADGE.idle;
  const isRunning = data.status === "running" || data.status === "queued";

  const handleModeChange = (mode: CanvasGenerationMode) => {
    if (mode === "text") {
      // Text mode is intentionally disabled — see ENHANCE-CANVAS plan.
      return;
    }
    ctx.onChangeConfigData(id, { generationMode: mode });
  };

  const sizeOptions = IMAGE_SIZE_OPTIONS.filter((option) => option.value !== "");
  const currentSize = data.size && data.size.length > 0 ? data.size : "1:1";
  const currentModel = data.model ?? "gpt-image-2";

  return (
    <div
      className={cn(
        "relative flex w-[320px] flex-col rounded-3xl border bg-stone-950 text-stone-100 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.6)]",
        selected ? "border-stone-500" : "border-stone-800",
      )}
    >
      <NodeResizer
        minWidth={300}
        minHeight={260}
        isVisible={selected}
        lineClassName="!border-stone-600"
        handleClassName="!h-2 !w-2 !rounded-full !border-stone-600 !bg-stone-900"
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!z-10 !h-3 !w-3 !rounded-full !border-stone-500 !bg-stone-800"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!z-10 !h-3 !w-3 !rounded-full !border-stone-500 !bg-stone-800"
      />

      <div className="flex flex-col gap-3 p-4">
        <header className="flex items-center justify-between gap-2">
          {editingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                ctx.onChangeTitle(id, titleDraft.trim() || "生成配置");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                }
              }}
              className="min-w-0 flex-1 rounded-md bg-stone-800 px-2 py-1 text-sm font-semibold text-white outline-none ring-1 ring-stone-700"
            />
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setTitleDraft(data.title ?? "");
                setEditingTitle(true);
              }}
              className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-white hover:text-stone-300"
            >
              {data.title || "生成配置"}
            </button>
          )}

          <div className="flex shrink-0 items-center gap-1 rounded-full bg-stone-800/70 p-0.5">
            <button
              type="button"
              onClick={() => handleModeChange("image")}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                data.generationMode === "image"
                  ? "bg-white text-stone-950"
                  : "text-stone-400 hover:text-stone-200",
              )}
            >
              <ImageIcon className="size-3" />
              生图
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("text")}
              disabled
              title="文本模式即将推出"
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                data.generationMode === "text"
                  ? "bg-white text-stone-950"
                  : "text-stone-500 opacity-50",
              )}
            >
              <TypeIcon className="size-3" />
              文本
            </button>
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onDelete(id);
            }}
            className="shrink-0 rounded-full p-1 text-stone-400 hover:bg-stone-800 hover:text-rose-400"
            aria-label="删除节点"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowPrompt((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-stone-800 px-2.5 py-1 text-[11px] font-medium text-stone-200 hover:bg-stone-700"
          >
            提示词 {stats.promptCount} 个
          </button>
          <span className="inline-flex items-center gap-1 rounded-full bg-stone-800 px-2.5 py-1 text-[11px] font-medium text-stone-300">
            参考图 {stats.referenceCount} 张
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onOpenPreview(id);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-stone-800 px-2.5 py-1 text-[11px] font-medium text-stone-300 hover:bg-stone-700"
          >
            <Eye className="size-3" />
            预览
          </button>
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </div>

        {showPrompt ? (
          <Textarea
            value={data.prompt}
            onChange={(event) =>
              ctx.onChangeConfigData(id, { prompt: event.target.value })
            }
            placeholder="本节点提示词（与上游文本节点拼合后作为最终提示词）..."
            rows={3}
            className="resize-none rounded-2xl border-stone-700 bg-stone-900 px-3 py-2 text-[12px] leading-relaxed text-stone-100 placeholder:text-stone-500 focus-visible:ring-stone-600"
          />
        ) : null}

        <div className="grid grid-cols-[1fr_84px_64px] gap-2">
          <Select
            value={currentModel}
            onValueChange={(value) =>
              ctx.onChangeConfigData(id, { model: value as typeof currentModel })
            }
          >
            <SelectTrigger className="h-9 rounded-2xl border-stone-700 bg-stone-900 px-3 text-[12px] text-stone-100 shadow-none focus-visible:ring-stone-600">
              <SelectValue placeholder="模型" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              {IMAGE_MODEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-[12px]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={currentSize}
            onValueChange={(value) => ctx.onChangeConfigData(id, { size: value })}
          >
            <SelectTrigger className="h-9 rounded-2xl border-stone-700 bg-stone-900 px-3 text-[12px] text-stone-100 shadow-none focus-visible:ring-stone-600">
              <SelectValue placeholder="比例" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              {sizeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-[12px]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            type="number"
            min={MIN_COUNT}
            max={MAX_COUNT}
            value={data.count}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              ctx.onChangeConfigData(id, {
                count: Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.floor(next))),
              });
            }}
            className="h-9 rounded-2xl border border-stone-700 bg-stone-900 px-3 text-center text-[12px] font-semibold text-stone-100 outline-none focus-visible:ring-1 focus-visible:ring-stone-600"
          />
        </div>

        <Button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            ctx.onRunConfig(id);
          }}
          disabled={isRunning}
          className="h-10 w-full rounded-2xl bg-white text-[13px] font-semibold text-stone-950 hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRunning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : data.status === "success" || data.status === "error" ? (
            <RefreshCcw className="size-3.5" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {isRunning
            ? "生成中..."
            : data.status === "success" || data.status === "error"
              ? "重新生成"
              : "开始生成"}
        </Button>

        {data.error && data.status === "error" ? (
          <div className="rounded-xl bg-rose-950/50 px-3 py-2 text-[11px] text-rose-300">
            {data.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

CanvasConfigNode.displayName = "CanvasConfigNode";
