"use client";

import { LoaderCircle } from "lucide-react";

import { CanvasFlow } from "@/components/canvas/canvas-flow";
import { useAuthGuard } from "@/lib/use-auth-guard";

export default function CanvasPage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <section className="h-[calc(100dvh-3.5rem)] w-full">
      <CanvasFlow />
    </section>
  );
}
