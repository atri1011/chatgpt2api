"use client";

import { Heart, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PromptCover } from "@/components/prompts/prompt-cover";
import { cn } from "@/lib/utils";
import type { Prompt } from "@/types/prompt";

type PromptCardProps = {
  prompt: Prompt;
  favorite: boolean;
  onOpenDetail: (prompt: Prompt) => void;
  onApply: (prompt: Prompt) => void;
  onToggleFavorite: (prompt: Prompt) => void;
  compact?: boolean;
};

export function PromptCard({
  prompt,
  favorite,
  onOpenDetail,
  onApply,
  onToggleFavorite,
  compact = false,
}: PromptCardProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-30px_rgba(15,23,42,0.45)]",
        compact ? "rounded-2xl" : "rounded-3xl",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetail(prompt)}
        className="flex flex-col text-left"
        aria-label={`查看 ${prompt.title} 详情`}
      >
        <PromptCover src={prompt.coverUrl} title={prompt.title} aspect={compact ? "aspect-[5/3]" : "aspect-[4/3]"} />
        <div className={cn("flex flex-col gap-1.5 px-4 pt-3", compact ? "pb-3" : "pb-2")}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="line-clamp-1 text-sm font-semibold text-stone-900">{prompt.title}</h3>
            <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500">
              {prompt.category}
            </span>
          </div>
          <p className="line-clamp-2 text-[12px] leading-relaxed text-stone-500">{prompt.prompt}</p>
          {!compact && prompt.tags.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {prompt.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-stone-200 px-2 py-0.5 text-[10px] text-stone-600"
                >
                  {tag}
                </span>
              ))}
              {prompt.tags.length > 3 ? (
                <span className="text-[10px] text-stone-400">+{prompt.tags.length - 3}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>

      <div className={cn("flex items-center justify-between gap-2 px-4 pb-4", compact && "pb-3")}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 rounded-full px-2 text-xs",
            favorite ? "text-rose-500 hover:text-rose-600" : "text-stone-400 hover:text-stone-700",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(prompt);
          }}
          aria-label={favorite ? "取消收藏" : "收藏"}
        >
          <Heart className={cn("size-3.5", favorite && "fill-current")} />
          <span className="hidden sm:inline">{favorite ? "已收藏" : "收藏"}</span>
        </Button>

        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 rounded-full bg-stone-950 px-3 text-xs text-white hover:bg-stone-800"
          onClick={(event) => {
            event.stopPropagation();
            onApply(prompt);
          }}
        >
          <Sparkles className="size-3.5" />
          应用
        </Button>
      </div>
    </div>
  );
}
