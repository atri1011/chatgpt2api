"use client";

import { ArrowDown, ArrowUp, ImageIcon, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  type CanvasAnyNode,
  type CanvasConfigNode,
  type CanvasEdge,
} from "@/types/canvas";
import {
  collectUpstreamContributions,
  getOrderedUpstreamNodes,
} from "@/lib/canvas-runner";
import { normalizeBase64 } from "@/lib/base64";
import { cn } from "@/lib/utils";

type PreviewItem =
  | {
      kind: "text";
      nodeId: string;
      title: string;
      text: string;
      /** True when the contribution originates from a direct parent (reorderable). */
      reorderable: boolean;
    }
  | {
      kind: "image";
      nodeId: string;
      title: string;
      src: string;
      status: string;
      reorderable: boolean;
    };

type CanvasPreviewModalProps = {
  open: boolean;
  configNode: CanvasConfigNode | null;
  nodes: CanvasAnyNode[];
  edges: CanvasEdge[];
  onOpenChange: (open: boolean) => void;
  /** Persist a new input order for the Config node. */
  onReorder: (configNodeId: string, nextOrder: string[]) => void;
};

function buildPreviewItems(
  configNode: CanvasConfigNode,
  nodes: CanvasAnyNode[],
  edges: CanvasEdge[],
  directParentIds: Set<string>,
): PreviewItem[] {
  const { imageNodes, textFragments } = collectUpstreamContributions(
    configNode.id,
    nodes,
    edges,
    configNode.data.inputOrder,
  );
  const items: PreviewItem[] = [];

  imageNodes.forEach((node) => {
    const src = node.data.b64_json
      ? `data:image/png;base64,${normalizeBase64(node.data.b64_json)}`
      : node.data.url || "";
    items.push({
      kind: "image",
      nodeId: node.id,
      title: node.data.title || "图片节点",
      src,
      status: node.data.status,
      reorderable: directParentIds.has(node.id),
    });
  });

  textFragments.forEach((fragment) => {
    // For image-prompt fragments the nodeId is suffixed (":prompt") — strip
    // the suffix to test reorder eligibility against the real node id.
    const realId = fragment.nodeId.split(":")[0];
    items.push({
      kind: "text",
      nodeId: fragment.nodeId,
      title: fragment.title,
      text: fragment.text,
      reorderable: directParentIds.has(realId),
    });
  });

  return items;
}

function move(ordered: string[], nodeId: string, offset: -1 | 1): string[] {
  const index = ordered.indexOf(nodeId);
  if (index < 0) return ordered;
  const target = index + offset;
  if (target < 0 || target >= ordered.length) return ordered;
  const next = ordered.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function CanvasPreviewModal({
  open,
  configNode,
  nodes,
  edges,
  onOpenChange,
  onReorder,
}: CanvasPreviewModalProps) {
  if (!configNode) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>预览</DialogTitle>
            <DialogDescription>未选择配置节点。</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const directParents = getOrderedUpstreamNodes(
    configNode.id,
    nodes,
    edges,
    configNode.data.inputOrder,
  );
  const directParentIds = new Set(directParents.map((node) => node.id));
  const orderedSourceIds = directParents.map((node) => node.id);

  const items = buildPreviewItems(configNode, nodes, edges, directParentIds);
  const imageItems = items.filter((item) => item.kind === "image") as Extract<
    PreviewItem,
    { kind: "image" }
  >[];
  const textItems = items.filter((item) => item.kind === "text") as Extract<
    PreviewItem,
    { kind: "text" }
  >[];

  const handleMove = (sourceNodeId: string, offset: -1 | 1) => {
    onReorder(configNode.id, move(orderedSourceIds, sourceNodeId, offset));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>预览生成输入</DialogTitle>
          <DialogDescription>
            上游图片（含跨提示词节点透传发现的）按当前顺序作为参考图，所有文本提示词与本节点提示词拼合为最终提示词。直连父节点可拖动排序。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-stone-700">
              参考图（{imageItems.length}）
            </h3>
            {imageItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-stone-200 px-4 py-6 text-center text-xs text-stone-400">
                上游暂无成功生成的图片
              </div>
            ) : (
              <ul className="space-y-2">
                {imageItems.map((item) => (
                  <li
                    key={item.nodeId}
                    className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-2"
                  >
                    <div className="size-12 shrink-0 overflow-hidden rounded-md bg-stone-100">
                      {item.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.src} alt={item.title} className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-stone-400">
                          {item.status === "running" ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <ImageIcon className="size-4" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-stone-900">
                        {item.title}
                      </div>
                      <div
                        className={cn(
                          "mt-0.5 text-[11px]",
                          item.status === "success" ? "text-emerald-600" : "text-stone-400",
                        )}
                      >
                        {item.status === "success" ? "可用" : `状态：${item.status}`}
                        {item.reorderable ? null : (
                          <span className="ml-1 text-stone-400">· 透传</span>
                        )}
                      </div>
                    </div>
                    {item.reorderable ? (
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => handleMove(item.nodeId, -1)}
                          className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                          aria-label="上移"
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(item.nodeId, 1)}
                          className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                          aria-label="下移"
                        >
                          <ArrowDown className="size-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-stone-700">
              文本提示词（{textItems.length}）
            </h3>
            {textItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-stone-200 px-4 py-6 text-center text-xs text-stone-400">
                上游暂无文本提示词
              </div>
            ) : (
              <ul className="space-y-2">
                {textItems.map((item) => (
                  <li
                    key={item.nodeId}
                    className="rounded-lg border border-stone-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-xs font-medium text-stone-500">
                        {item.title}
                      </div>
                      {item.reorderable ? null : (
                        <span className="shrink-0 text-[10px] text-stone-400">透传</span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-stone-800">
                      {item.text}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
