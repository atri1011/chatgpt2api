"use client";

import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ALL_PROMPTS_CATEGORY } from "@/types/prompt";

type PromptFilterBarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  category: string;
  categories: string[];
  onCategoryChange: (value: string) => void;
  tags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onlyFavorites?: boolean;
  onToggleFavorites?: (next: boolean) => void;
  total: number;
  compact?: boolean;
};

export function PromptFilterBar({
  query,
  onQueryChange,
  category,
  categories,
  onCategoryChange,
  tags,
  selectedTags,
  onToggleTag,
  onlyFavorites,
  onToggleFavorites,
  total,
  compact = false,
}: PromptFilterBarProps) {
  const showFavorites = typeof onToggleFavorites === "function";

  return (
    <div className={cn("flex flex-col gap-3", compact && "gap-2")}>
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-stone-400" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索标题、提示词、标签..."
          className="h-10 rounded-full border-stone-200 bg-white pl-9 pr-9 text-sm shadow-none focus-visible:ring-stone-300"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-3 inline-flex size-5 items-center justify-center rounded-full bg-stone-100 text-stone-500 hover:text-stone-800"
            aria-label="清空搜索"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>

      <div className="hide-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
        {categories.map((item) => {
          const active = item === category || (item === ALL_PROMPTS_CATEGORY && !category);
          return (
            <button
              key={item}
              type="button"
              onClick={() => onCategoryChange(item)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition",
                active
                  ? "border-stone-950 bg-stone-950 text-white"
                  : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900",
              )}
            >
              {item}
            </button>
          );
        })}
        {showFavorites ? (
          <button
            type="button"
            onClick={() => onToggleFavorites?.(!onlyFavorites)}
            className={cn(
              "ml-1 shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition",
              onlyFavorites
                ? "border-rose-300 bg-rose-50 text-rose-600"
                : "border-stone-200 bg-white text-stone-500 hover:text-stone-900",
            )}
          >
            ♥ 收藏
          </button>
        ) : null}
        <span className="ml-auto shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-500">
          {total} 条
        </span>
      </div>

      {tags.length > 0 ? (
        <div className="hide-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
          {tags.slice(0, compact ? 12 : 24).map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition",
                  active
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200",
                )}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
