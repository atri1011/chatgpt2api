"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type PromptCoverProps = {
  src?: string;
  title: string;
  className?: string;
  aspect?: string;
};

/**
 * Lazy-loaded prompt cover image with graceful fallback.
 *
 * When `src` is missing or fails to load, renders a stone-gradient placeholder
 * with the title's first character as a soft monogram. Avoids bundling cover
 * art in-repo while keeping the UI presentable offline.
 */
export function PromptCover({ src, title, className, aspect = "aspect-[4/3]" }: PromptCoverProps) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setErrored(false);
    setLoaded(false);
  }, [src]);

  const monogram = (title || "?").trim().slice(0, 1).toUpperCase();
  const showImage = src && !errored;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-stone-100 via-stone-50 to-stone-200",
        aspect,
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {!showImage || !loaded ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="select-none text-5xl font-black tracking-tight text-stone-300/80">
            {monogram}
          </span>
        </div>
      ) : null}
    </div>
  );
}
