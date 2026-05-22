"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PromptCard } from "@/components/prompts/prompt-card";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { PromptFilterBar } from "@/components/prompts/prompt-filter-bar";
import { Button } from "@/components/ui/button";
import { collectCategories, collectTags, filterPrompts } from "@/lib/prompt-search";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { usePromptStore } from "@/store/prompts";
import { ALL_PROMPTS_CATEGORY, type Prompt } from "@/types/prompt";

const PAGE_SIZE = 20;

function PromptsContent() {
  const router = useRouter();
  const { prompts, favorites, isLoading, toggleFavoriteAction } = usePromptStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_PROMPTS_CATEGORY);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activePrompt, setActivePrompt] = useState<Prompt | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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
    const encoded = encodeURIComponent(prompt.prompt);
    router.push(`/image?prompt=${encoded}`);
    toast.success(`已发送到工作台：${prompt.title}`);
  };

  const handleOpenDetail = (prompt: Prompt) => {
    setActivePrompt(prompt);
    setDetailOpen(true);
  };

  const handleToggleFavorite = (prompt: Prompt) => {
    void toggleFavoriteAction(prompt.id);
  };

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag],
    );
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <section className="mx-auto w-full max-w-[1380px] px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">
            <Sparkles className="size-5 text-amber-500" />
            提示词库
          </h1>
          <p className="mt-1 text-xs text-stone-500 sm:text-sm">
            预设了多种风格的 AI 绘图提示词，点击「应用」即可发送到画图工作台。
          </p>
        </div>
      </header>

      <div className="mb-6">
        <PromptFilterBar
          query={query}
          onQueryChange={(value) => {
            setQuery(value);
            setVisibleCount(PAGE_SIZE);
          }}
          category={category}
          categories={categories}
          onCategoryChange={(value) => {
            setCategory(value);
            setVisibleCount(PAGE_SIZE);
          }}
          tags={allTags}
          selectedTags={selectedTags}
          onToggleTag={handleToggleTag}
          onlyFavorites={onlyFavorites}
          onToggleFavorites={(next) => {
            setOnlyFavorites(next);
            setVisibleCount(PAGE_SIZE);
          }}
          total={filtered.length}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-72 animate-pulse rounded-3xl bg-stone-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-3xl border border-dashed border-stone-200 bg-stone-50 text-sm text-stone-400">
          没有匹配的提示词
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visiblePrompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              favorite={favorites.includes(prompt.id)}
              onOpenDetail={handleOpenDetail}
              onApply={handleApply}
              onToggleFavorite={handleToggleFavorite}
            />
          ))}
        </div>
      )}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 rounded-full border-stone-200 px-5 text-sm"
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
          >
            加载更多（剩 {filtered.length - visiblePrompts.length} 条）
          </Button>
        </div>
      ) : null}

      <PromptDetailDialog
        prompt={activePrompt}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        favorite={activePrompt ? favorites.includes(activePrompt.id) : false}
        onApply={(prompt) => {
          setDetailOpen(false);
          handleApply(prompt);
        }}
        onToggleFavorite={handleToggleFavorite}
      />
    </section>
  );
}

export default function PromptsPage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <PromptsContent />;
}
