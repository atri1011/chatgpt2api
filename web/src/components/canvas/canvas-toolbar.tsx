"use client";

import {
  Copy,
  Download,
  ImageIcon,
  Import,
  LayoutGrid,
  Maximize2,
  Plus,
  Redo2,
  Settings2,
  Trash2,
  Undo2,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CanvasToolbarProps = {
  nodeCount: number;
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onAddPrompt: () => void;
  onAddImage: () => void;
  onAddConfig: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onFitView: () => void;
  onZoomSelection: () => void;
  onArrange: () => void;
  onExport: () => void;
  onImport: () => void;
  onLoadTemplate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetAll: () => void;
  className?: string;
};

export function CanvasToolbar({
  nodeCount,
  selectionCount,
  canUndo,
  canRedo,
  onAddPrompt,
  onAddImage,
  onAddConfig,
  onDeleteSelected,
  onDuplicateSelected,
  onFitView,
  onZoomSelection,
  onArrange,
  onExport,
  onImport,
  onLoadTemplate,
  onUndo,
  onRedo,
  onResetAll,
  className,
}: CanvasToolbarProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 rounded-lg border border-stone-200/80 bg-white/95 px-1.5 py-1.5 shadow-[0_12px_40px_-12px_rgba(28,25,23,0.12)] backdrop-blur-md transition-all duration-300",
        className,
      )}
    >
      <Button
        type="button"
        size="sm"
        title="添加提示词节点"
        className="h-8 rounded-md bg-amber-500 px-3 text-xs font-semibold text-white shadow-sm shadow-amber-500/10 transition-all duration-150 hover:-translate-y-[1px] hover:bg-amber-600 hover:shadow-md hover:shadow-amber-500/20 active:translate-y-0"
        onClick={onAddPrompt}
      >
        <Plus className="size-3.5 stroke-[2.5]" />
        提示词
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        title="添加图片节点"
        className="h-8 rounded-md border-stone-200 bg-white px-3 text-xs text-stone-700 shadow-sm transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-50 hover:text-stone-900 active:translate-y-0"
        onClick={onAddImage}
      >
        <ImageIcon className="size-3.5 text-stone-500" />
        图片
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        title="添加配置节点"
        className="h-8 rounded-md border-stone-200 bg-white px-3 text-xs text-stone-700 shadow-sm transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-50 hover:text-stone-900 active:translate-y-0"
        onClick={onAddConfig}
      >
        <Settings2 className="size-3.5 text-stone-500" />
        配置
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="删除选中节点"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
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
        title="复制选中节点"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onDuplicateSelected}
        disabled={selectionCount === 0}
      >
        <Copy className="size-3.5 text-stone-500" />
        复制
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="适配全部节点"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onFitView}
        disabled={nodeCount === 0}
      >
        <Maximize2 className="size-3.5 text-stone-500" />
        适配
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="聚焦选中节点"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onZoomSelection}
        disabled={selectionCount === 0}
      >
        <Maximize2 className="size-3.5 text-stone-500" />
        选区
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="整理节点布局"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onArrange}
        disabled={nodeCount <= 1}
      >
        <LayoutGrid className="size-3.5 text-stone-500" />
        整理
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="载入起步模板"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onLoadTemplate}
      >
        <Workflow className="size-3.5 text-stone-500" />
        模板
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="导出工作流 JSON"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onExport}
        disabled={nodeCount === 0}
      >
        <Download className="size-3.5 text-stone-500" />
        导出
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="导入工作流 JSON"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onImport}
      >
        <Import className="size-3.5 text-stone-500" />
        导入
      </Button>

      <div className="mx-1.5 h-5 w-px bg-stone-200" />

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="撤销"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onUndo}
        disabled={!canUndo}
      >
        <Undo2 className="size-3.5 text-stone-500" />
        撤销
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="重做"
        className="h-8 rounded-md px-3 text-xs text-stone-600 transition-all duration-150 hover:-translate-y-[1px] hover:bg-stone-100 hover:text-stone-900 active:translate-y-0"
        onClick={onRedo}
        disabled={!canRedo}
      >
        <Redo2 className="size-3.5 text-stone-500" />
        重做
      </Button>

      <div className="mx-1.5 h-5 w-px bg-stone-200" />

      <span className="px-2 text-[11px] font-bold text-stone-400">{nodeCount} 节点</span>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        title="清空画布"
        className="h-8 rounded-md px-3 text-xs font-semibold text-rose-500 transition-all duration-150 hover:-translate-y-[1px] hover:bg-rose-50 hover:text-rose-600 active:translate-y-0"
        onClick={onResetAll}
        disabled={nodeCount === 0}
      >
        清空
      </Button>
    </div>
  );
}
