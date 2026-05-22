"use client";

import { useState } from "react";
import { Copy, ExternalLink, Heart, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PromptCover } from "@/components/prompts/prompt-cover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Prompt } from "@/types/prompt";

type PromptDetailDialogProps = {
  prompt: Prompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  favorite: boolean;
  onApply: (prompt: Prompt) => void;
  onToggleFavorite: (prompt: Prompt) => void;
};

export function PromptDetailDialog({
  prompt,
  open,
  onOpenChange,
  favorite,
  onApply,
  onToggleFavorite,
}: PromptDetailDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!prompt) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.prompt);
      setCopied(true);
      toast.success("提示词已复制");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败，请手动选择文本");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,820px)] max-w-none gap-0 overflow-hidden rounded-[28px] p-0">
        <div className="grid gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="bg-stone-50 p-4 md:p-5">
            <PromptCover src={prompt.coverUrl} title={prompt.title} aspect="aspect-[4/3]" className="rounded-2xl" />
            <div className="mt-3 flex flex-wrap gap-1">
              {prompt.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] text-stone-600"
                >
                  #{tag}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-stone-500">
              <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-stone-200">
                {prompt.category}
              </span>
              {prompt.custom ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-600 ring-1 ring-amber-200">
                  自定义
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold tracking-tight text-stone-900">
                {prompt.title}
              </DialogTitle>
              {prompt.preview ? (
                <DialogDescription className="text-xs leading-relaxed text-stone-500">
                  {prompt.preview}
                </DialogDescription>
              ) : null}
            </DialogHeader>

            <div className="max-h-[40vh] overflow-y-auto rounded-2xl border border-stone-200 bg-stone-50 p-4 text-[13px] leading-relaxed text-stone-800">
              {prompt.prompt}
            </div>

            <DialogFooter className="flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 rounded-full px-3 text-xs",
                  favorite ? "text-rose-500 hover:text-rose-600" : "text-stone-500 hover:text-stone-900",
                )}
                onClick={() => onToggleFavorite(prompt)}
              >
                <Heart className={cn("size-3.5", favorite && "fill-current")} />
                {favorite ? "已收藏" : "收藏"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-full border-stone-200 px-3 text-xs"
                onClick={() => void handleCopy()}
              >
                <Copy className="size-3.5" />
                {copied ? "已复制" : "复制"}
              </Button>
              {prompt.githubUrl ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full border-stone-200 px-3 text-xs"
                >
                  <a href={prompt.githubUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" />
                    来源
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-full bg-stone-950 px-4 text-xs text-white hover:bg-stone-800"
                onClick={() => onApply(prompt)}
              >
                <Sparkles className="size-3.5" />
                应用到工作台
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
