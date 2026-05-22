"use client";

import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";

import { useCanvasNodeContext } from "@/components/canvas/canvas-node-context";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CanvasPromptNode as CanvasPromptNodeType } from "@/types/canvas";

/**
 * Prompt-only node — dark card with just a textarea. Mirrors the
 * "二次元风格..." card in the spec. When wired upstream of a Config node,
 * its text is concatenated into the final prompt by the runner.
 */
export function CanvasPromptNode({ id, data, selected }: NodeProps<CanvasPromptNodeType>) {
  const ctx = useCanvasNodeContext();
  const [titleDraft, setTitleDraft] = useState(data.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);

  return (
    <div
      className={cn(
        "group relative flex w-[320px] flex-col rounded-3xl border bg-stone-900 text-stone-100 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.6)]",
        selected ? "border-sky-400" : "border-stone-800",
      )}
    >
      <NodeResizer
        minWidth={260}
        minHeight={140}
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
              className="min-w-0 flex-1 rounded-md bg-stone-800 px-2 py-1 text-xs font-semibold text-white outline-none ring-1 ring-stone-700"
            />
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setTitleDraft(data.title ?? "");
                setEditingTitle(true);
              }}
              className="min-w-0 flex-1 truncate text-left text-[11px] font-medium uppercase tracking-wider text-stone-500 hover:text-stone-300"
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
            className="shrink-0 rounded-full p-1 text-stone-500 hover:bg-stone-800 hover:text-rose-400"
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
          className="min-h-[140px] resize-none border-0 bg-transparent px-0 py-0 text-[13px] leading-relaxed text-stone-100 placeholder:text-stone-500 shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

CanvasPromptNode.displayName = "CanvasPromptNode";
