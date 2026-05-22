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
        "pointer-events-auto inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white/95 px-1.5 py-1 shadow-[0_18px_60px_-32px_rgba(15,23,42,0.4)] backdrop-blur",
        className,
      )}
    >
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-full bg-stone-950 px-3 text-xs text-white hover:bg-stone-800"
        onClick={onAddPrompt}
      >
        <Plus className="size-3.5" />
        提示词
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-full border-stone-200 bg-white px-3 text-xs text-stone-700 hover:bg-stone-50"
        onClick={onAddImage}
      >
        <ImageIcon className="size-3.5" />
        图片
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-full border-stone-200 bg-white px-3 text-xs text-stone-700 hover:bg-stone-50"
        onClick={onAddConfig}
      >
        <Settings2 className="size-3.5" />
        配置
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-full px-3 text-xs text-stone-600"
        onClick={onDeleteSelected}
        disabled={selectionCount === 0}
      >
        <Trash2 className="size-3.5" />
        删除
        {selectionCount > 0 ? (
          <span className="rounded-full bg-stone-100 px-1.5 text-[10px] text-stone-500">
            {selectionCount}
          </span>
        ) : null}
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-full px-3 text-xs text-stone-600"
        onClick={onFitView}
        disabled={nodeCount === 0}
      >
        <Maximize2 className="size-3.5" />
        适配
      </Button>

      <div className="mx-1 h-5 w-px bg-stone-200" />

      <span className="px-2 text-[11px] font-medium text-stone-400">{nodeCount} 节点</span>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-full px-3 text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600"
        onClick={onResetAll}
        disabled={nodeCount === 0}
      >
        清空
      </Button>
    </div>
  );
}
