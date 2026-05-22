"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { PromptCard } from "@/components/prompts/prompt-card";
import { PromptFilterBar } from "@/components/prompts/prompt-filter-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { collectCategories, collectTags, filterPrompts } from "@/lib/prompt-search";
import { usePromptStore } from "@/store/prompts";
import { cn } from "@/lib/utils";
import { ALL_PROMPTS_CATEGORY, type Prompt } from "@/types/prompt";

type PromptSelectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen prompt text. `mode` defaults to "replace". */
  onApply: (text: string, mode: "replace" | "append") => void;
  /** When true, applying a prompt should append to the existing input. */
  hasExistingInput: boolean;
};

const PAGE_SIZE = 18;

export function PromptSelectDialog({
  open,
  onOpenChange,
  onApply,
  hasExistingInput,
}: PromptSelectDialogProps) {
  const { prompts, favorites, toggleFavoriteAction, isLoading } = usePromptStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_PROMPTS_CATEGORY);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [applyMode, setApplyMode] = useState<"replace" | "append">("replace");

  const categories = useMemo(() => collectCategories(prompts), [prompts]);
  const allTags = useMemo(() => collectTags(prompts), [prompts]);

  const filtered = useMemo(() => {
    let base = filterPrompts(prompts, { query, category, tags: selectedTags });
    if (onlyFavorites) {
      const favoriteSet = new Set(favorites);
      base = base.filter((item) => favoriteSet.has(item.id));
    }
    return base;
  }, [prompts, query, category, selectedTags, onlyFavorites, favorites]);

  const visiblePrompts = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visiblePrompts.length;

  const handleApply = (prompt: Prompt) => {
    const mode = hasExistingInput ? applyMode : "replace";
    onApply(prompt.prompt, mode);
    onOpenChange(false);
  };

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag],
    );
    setVisibleCount(PAGE_SIZE);
  };

  const handleCategoryChange = (next: string) => {
    setCategory(next);
    setVisibleCount(PAGE_SIZE);
  };

  const handleQueryChange = (next: string) => {
    setQuery(next);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86vh,720px)] w-[min(96vw,1080px)] max-w-none flex-col gap-3 overflow-hidden rounded-[28px] p-0">
        <DialogHeader className="border-b border-stone-100 px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Sparkles className="size-5 text-amber-500" />
            提示词库
          </DialogTitle>
          <DialogDescription className="text-xs text-stone-500">
            选中后直接应用到工作台输入框{hasExistingInput ? "，可选择追加或覆盖" : ""}。
          </DialogDescription>
        </DialogHeader>

        <div className="px-6">
          <PromptFilterBar
            query={query}
            onQueryChange={handleQueryChange}
            category={category}
            categories={categories}
            onCategoryChange={handleCategoryChange}
            tags={allTags}
            selectedTags={selectedTags}
            onToggleTag={handleToggleTag}
            onlyFavorites={onlyFavorites}
            onToggleFavorites={(next) => {
              setOnlyFavorites(next);
              setVisibleCount(PAGE_SIZE);
            }}
            total={filtered.length}
            compact
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="h-44 animate-pulse rounded-2xl bg-stone-100" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-stone-400">
              没有匹配的提示词
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visiblePrompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  favorite={favorites.includes(prompt.id)}
                  onOpenDetail={() => handleApply(prompt)}
                  onApply={handleApply}
                  onToggleFavorite={(target) => void toggleFavoriteAction(target.id)}
                  compact
                />
              ))}
            </div>
          )}

          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-full border-stone-200 px-4 text-xs"
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              >
                加载更多 ({filtered.length - visiblePrompts.length})
              </Button>
            </div>
          ) : null}
        </div>

        {hasExistingInput ? (
          <DialogFooter className="border-t border-stone-100 px-6 py-3">
            <div className="flex w-full items-center justify-between gap-3 text-xs text-stone-500">
              <span>当前输入框已有内容，应用方式：</span>
              <div className="flex items-center gap-1 rounded-full bg-stone-100 p-0.5">
                {(["replace", "append"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setApplyMode(mode)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-medium transition",
                      applyMode === mode
                        ? "bg-white text-stone-900 shadow-sm"
                        : "text-stone-500 hover:text-stone-800",
                    )}
                  >
                    {mode === "replace" ? "覆盖" : "追加"}
                  </button>
                ))}
              </div>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
