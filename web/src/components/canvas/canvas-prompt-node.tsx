"use client";

import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";

import { useCanvasNodeContext } from "@/components/canvas/canvas-node-context";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CanvasPromptNode as CanvasPromptNodeType } from "@/types/canvas";

/**
 * Prompt-only node — white card with amber accent. Italic typography hints
 * that this is "input copy"; concatenated into the final prompt by the
 * runner when wired upstream of a Config node.
 */
export function CanvasPromptNode({ id, data, selected }: NodeProps<CanvasPromptNodeType>) {
  const ctx = useCanvasNodeContext();
  const [titleDraft, setTitleDraft] = useState(data.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);

  return (
    <div
      className={cn(
        "group relative flex w-[320px] flex-col rounded-3xl border border-l-4 border-l-amber-500/80 bg-white/95 shadow-[0_12px_40px_-20px_rgba(28,25,23,0.15)] backdrop-blur-md transition-all duration-200",
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/10 shadow-[0_12px_40px_-15px_rgba(99,102,241,0.25)]"
          : "border-stone-200/85",
      )}
    >
      <NodeResizer
        minWidth={260}
        minHeight={140}
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

      <div className="flex flex-col gap-2 p-4">
        <header className="flex items-center justify-between gap-2 opacity-0 transition group-hover:opacity-100">
          {editingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                ctx.onChangeTitle(id, titleDraft.trim() || "提示词");
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
              className="min-w-0 flex-1 truncate text-left font-serif text-[11px] font-semibold italic tracking-wider text-amber-600/90 transition-colors hover:text-indigo-600"
            >
              {data.title || "提示词"}
            </button>
          )}

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

        <Textarea
          value={data.prompt}
          onChange={(event) => ctx.onChangePromptText(id, event.target.value)}
          placeholder="输入提示词，用作下游 Config 节点的文本输入..."
          rows={5}
          className="min-h-[120px] resize-none border-0 bg-transparent px-0 py-0 text-[13px] italic leading-relaxed text-stone-800 shadow-none placeholder:text-stone-400 focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

CanvasPromptNode.displayName = "CanvasPromptNode";
