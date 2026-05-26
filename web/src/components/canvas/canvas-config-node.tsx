"use client";

import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import {
  Eye,
  Image as ImageIcon,
  Loader2,
  Minus,
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

  const isRunning = data.status === "running" || data.status === "queued";

  const handleModeChange = (mode: CanvasGenerationMode) => {
    if (mode === "text") return; // disabled per Phase C scope B
    ctx.onChangeConfigData(id, { generationMode: mode });
  };

  const sizeOptions = IMAGE_SIZE_OPTIONS.filter((option) => option.value !== "");
  const currentSize = data.size && data.size.length > 0 ? data.size : "1:1";
  const currentModel = data.model ?? "gpt-image-2";

  return (
    <div
      className={cn(
        "relative flex w-[320px] flex-col rounded-lg border border-l-4 border-l-indigo-500 bg-white/95 shadow-[0_12px_28px_-22px_rgba(28,25,23,0.24)] backdrop-blur-md transition-all duration-200",
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/10 shadow-[0_12px_40px_-15px_rgba(99,102,241,0.25)]"
          : "border-stone-200/85",
      )}
    >
      <NodeResizer
        minWidth={300}
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
              className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-sm font-semibold text-stone-900 outline-none ring-2 ring-indigo-500/10 focus:border-indigo-500"
            />
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setTitleDraft(data.title ?? "");
                setEditingTitle(true);
              }}
              className="min-w-0 flex-1 truncate text-left text-sm font-bold text-stone-800 transition-colors hover:text-indigo-600"
            >
              {data.title || "生成配置"}
            </button>
          )}

          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-stone-200/50 bg-stone-100 p-0.5">
            <button
              type="button"
              onClick={() => handleModeChange("image")}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                data.generationMode === "image"
                  ? "border border-stone-200/30 bg-white text-indigo-600 shadow-sm"
                  : "text-stone-500 hover:text-stone-800",
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
                  ? "border border-stone-200/30 bg-white text-indigo-600 shadow-sm"
                  : "text-stone-400 opacity-50",
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
            className="shrink-0 rounded-full p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-rose-500"
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
            className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
          >
            提示词 {stats.promptCount} 个
          </button>
          <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-600">
            参考图 {stats.referenceCount} 张
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onOpenPreview(id);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50/70 px-2.5 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
          >
            <Eye className="size-3" />
            预览
          </button>
          {(() => {
            const cfg = STATUS_CONFIG[data.status] ?? STATUS_CONFIG.idle;
            return (
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors duration-150",
                  cfg.bgClass,
                  cfg.textClass,
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dotClass)} />
                {cfg.label}
              </span>
            );
          })()}
        </div>

        {showPrompt ? (
          <Textarea
            value={data.prompt}
            onChange={(event) =>
              ctx.onChangeConfigData(id, { prompt: event.target.value })
            }
            placeholder="本节点提示词（与上游文本节点拼合后作为最终提示词）..."
            rows={3}
            className="resize-none rounded-md border-stone-200 bg-stone-50 px-3 py-2 text-[12px] leading-relaxed text-stone-800 placeholder:text-stone-400 transition-all focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/20"
          />
        ) : null}

        <div className="grid grid-cols-[1fr_84px_64px] gap-2">
          <Select
            value={currentModel}
            onValueChange={(value) =>
              ctx.onChangeConfigData(id, { model: value as typeof currentModel })
            }
          >
            <SelectTrigger className="h-9 rounded-md border-stone-200 bg-stone-50 px-3 text-[12px] text-stone-700 shadow-none transition-colors hover:bg-stone-100/50 focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/20">
              <SelectValue placeholder="模型" />
            </SelectTrigger>
            <SelectContent className="rounded-md border-stone-200 bg-white">
              {IMAGE_MODEL_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-[12px] text-stone-700 focus:bg-stone-50 focus:text-stone-900"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={currentSize}
            onValueChange={(value) => ctx.onChangeConfigData(id, { size: value })}
          >
            <SelectTrigger className="h-9 rounded-md border-stone-200 bg-stone-50 px-3 text-[12px] text-stone-700 shadow-none transition-colors hover:bg-stone-100/50 focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/20">
              <SelectValue placeholder="比例" />
            </SelectTrigger>
            <SelectContent className="rounded-md border-stone-200 bg-white">
              {sizeOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-[12px] text-stone-700 focus:bg-stone-50 focus:text-stone-900"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex h-9 items-center justify-between gap-1 rounded-md border border-stone-200 bg-stone-50 px-1.5 text-[12px] font-semibold text-stone-700">
            <button
              type="button"
              aria-label="减少数量"
              disabled={data.count <= MIN_COUNT}
              onClick={(event) => {
                event.stopPropagation();
                ctx.onChangeConfigData(id, {
                  count: Math.max(MIN_COUNT, data.count - 1),
                });
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[1.5rem] select-none text-center tabular-nums">
              {data.count}
            </span>
            <button
              type="button"
              aria-label="增加数量"
              disabled={data.count >= MAX_COUNT}
              onClick={(event) => {
                event.stopPropagation();
                ctx.onChangeConfigData(id, {
                  count: Math.min(MAX_COUNT, data.count + 1),
                });
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        <Button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            ctx.onRunConfig(id);
          }}
          disabled={isRunning}
          className="h-10 w-full rounded-md bg-indigo-600 text-[13px] font-semibold text-white shadow-sm shadow-indigo-500/10 transition-all duration-150 hover:bg-indigo-700 hover:shadow-md hover:shadow-indigo-500/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-600">
            {data.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

CanvasConfigNode.displayName = "CanvasConfigNode";
