"use client";

import { ImageIcon, Maximize2, Plus, Settings2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CanvasToolbarProps = {
  nodeCount: number;
  selectionCount: number;
  onAddPrompt: () => void;
  onAddImage: () => void;
  onAddConfig: () => void;
  onDeleteSelected: () => void;
  onFitView: () => void;
  onResetAll: () => void;
  className?: string;
};

export function CanvasToolbar({
  nodeCount,
  selectionCount,
  onAddPrompt,
  onAddImage,
  onAddConfig,
  onDeleteSelected,
  onFitView,
  onResetAll,
  className,
}: CanvasToolbarProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-white/95 px-2 py-1.5 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.12)] backdrop-blur-md transition-all duration-300",
        className,
      )}
    >
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-full bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/10 transition-all duration-150 hover:-translate-y-[1px] hover:bg-indigo-700 hover:shadow-md hover:shadow-indigo-500/20 active:translate-y-0"
        onClick={onAddPrompt}
      >
        <Plus className="size-3.5 stroke-[2.5]" />
        提示词
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-full border-stone-200 bg-white px-3 text-xs text-stone-700 shadow-sm transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-50 hover:text-stone-900 active:translate-y-0"
        onClick={onAddImage}
      >
        <ImageIcon className="size-3.5 text-stone-500" />
        图片
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-full border-stone-200 bg-white px-3 text-xs text-stone-700 shadow-sm transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-50 hover:text-stone-900 active:translate-y-0"
        onClick={onAddConfig}
      >
        <Settings2 className="size-3.5 text-stone-500" />
        配置
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-full px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onDeleteSelected}
        disabled={selectionCount === 0}
      >
        <Trash2 className="size-3.5 text-stone-500" />
        删除
        {selectionCount > 0 ? (
          <span className="ml-1 rounded-full border border-indigo-100/60 bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-600">
            {selectionCount}
          </span>
        ) : null}
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-full px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onFitView}
        disabled={nodeCount === 0}
      >
        <Maximize2 className="size-3.5 text-stone-500" />
        适配
      </Button>

      <div className="mx-1.5 h-5 w-px bg-stone-200" />

      <span className="px-2 text-[11px] font-bold text-stone-400">{nodeCount} 节点</span>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-full px-3 text-xs font-semibold text-rose-500 transition-all duration-150 hover:-translate-y-[1px] hover:bg-rose-50 hover:text-rose-600 active:translate-y-0"
        onClick={onResetAll}
        disabled={nodeCount === 0}
      >
        清空
      </Button>
    </div>
  );
}
