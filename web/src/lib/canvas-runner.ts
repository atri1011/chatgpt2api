"use client";

import {
  createImageEditTask,
  createImageGenerationTask,
  fetchImageTasks,
  type ImageTask,
} from "@/lib/api";
import { clampCount } from "@/store/canvas";
import {
  isConfigNode,
  isImageNode,
  isPromptNode,
  type CanvasAnyNode,
  type CanvasConfigNode,
  type CanvasEdge,
  type CanvasImageNode,
  type CanvasImageNodeData,
} from "@/types/canvas";

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 90; // ~3 minutes

function createClientTaskId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `canvas-${crypto.randomUUID()}`;
  }
  return `canvas-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string): File {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType || matchedMimeType || "image/png" });
}

async function fetchImageAsFile(url: string, fileName: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("读取上游节点图失败");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

/**
 * Resolve direct parent nodes for a target, honouring an optional
 * `inputOrder` array on the target's metadata. Nodes not yet wired in
 * `inputOrder` fall through to their edge-insertion order.
 */
export function getOrderedUpstreamNodes(
  targetNodeId: string,
  nodes: CanvasAnyNode[],
  edges: CanvasEdge[],
  inputOrder?: string[],
): CanvasAnyNode[] {
  const parentIds = edges
    .filter((edge) => edge.target === targetNodeId)
    .map((edge) => edge.source);
  if (parentIds.length === 0) return [];

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const parentSet = new Set(parentIds);
  const ordered: CanvasAnyNode[] = [];
  const seen = new Set<string>();

  (inputOrder ?? []).forEach((id) => {
    if (!parentSet.has(id) || seen.has(id)) return;
    const node = nodeMap.get(id);
    if (node) {
      ordered.push(node);
      seen.add(id);
    }
  });

  parentIds.forEach((id) => {
    if (seen.has(id)) return;
    const node = nodeMap.get(id);
    if (node) {
      ordered.push(node);
      seen.add(id);
    }
  });

  return ordered;
}

/**
 * Convert ordered upstream image nodes into File references, skipping
 * non-success entries silently.
 */
async function buildReferenceFiles(
  ordered: CanvasAnyNode[],
  ownerId: string,
): Promise<File[]> {
  const files: File[] = [];
  let index = 0;
  for (const upstream of ordered) {
    if (!isImageNode(upstream)) continue;
    if (upstream.data.status !== "success") continue;
    if (upstream.data.isBatchRoot) {
      // Roots only mirror a child; skip them so we don't duplicate the primary.
      continue;
    }
    index += 1;
    const fileName = `upstream-${ownerId}-${index}.png`;
    if (upstream.data.b64_json) {
      files.push(
        dataUrlToFile(`data:image/png;base64,${upstream.data.b64_json}`, fileName, "image/png"),
      );
      continue;
    }
    if (upstream.data.url) {
      try {
        files.push(await fetchImageAsFile(upstream.data.url, fileName));
      } catch {
        // skip unreachable upstream
      }
    }
  }
  return files;
}

// ── Legacy single-image runner (kept for the standalone image node) ──────

export type RunNodeContext = {
  node: CanvasImageNode;
  references: File[];
  onUpdate: (updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => void;
};

export async function collectUpstreamReferences(
  targetNodeId: string,
  nodes: CanvasAnyNode[],
  edges: CanvasEdge[],
): Promise<File[]> {
  const ordered = getOrderedUpstreamNodes(targetNodeId, nodes, edges);
  return buildReferenceFiles(ordered, targetNodeId);
}

export async function runNode({ node, references, onUpdate }: RunNodeContext): Promise<void> {
  const prompt = node.data.prompt.trim();
  if (!prompt) {
    onUpdate((data) => ({ ...data, status: "error", error: "请输入提示词" }));
    return;
  }

  const clientTaskId = createClientTaskId();
  onUpdate((data) => ({
    ...data,
    status: "running",
    taskId: clientTaskId,
    error: undefined,
    url: undefined,
    b64_json: undefined,
  }));

  try {
    const submitted =
      references.length > 0
        ? await createImageEditTask(
            clientTaskId,
            references,
            prompt,
            node.data.model,
            node.data.size,
          )
        : await createImageGenerationTask(
            clientTaskId,
            prompt,
            node.data.model,
            node.data.size,
          );

    applyTaskUpdate(submitted, onUpdate);
    await pollUntilTerminal(clientTaskId, onUpdate);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "生成失败";
    onUpdate((data) => ({ ...data, status: "error", error: message }));
  }
}

// ── Config-node fan-out runner ──────────────────────────────────────────

export type ConfigRunContext = {
  configNode: CanvasConfigNode;
  rootId: string;
  childIds: string[];
  nodes: CanvasAnyNode[];
  edges: CanvasEdge[];
  /** Set status + metadata on the batch root (mirrors first success). */
  onUpdateRoot: (updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => void;
  /** Set status + metadata on a specific batch child. */
  onUpdateChild: (
    childId: string,
    updater: (data: CanvasImageNodeData) => CanvasImageNodeData,
  ) => void;
  /** Set status + error on the Config node itself. */
  onUpdateConfig: (status: "running" | "success" | "error", error?: string) => void;
};

/**
 * Run a Config node end-to-end:
 * 1. Resolve ordered upstream → reference files + prompt prefix
 * 2. Submit N independent (count=1) tasks concurrently
 * 3. Patch each child node with its terminal state
 * 4. Mirror first success to the batch root + mark Config status
 */
export async function runConfigNode(ctx: ConfigRunContext): Promise<void> {
  const { configNode, rootId, childIds, nodes, edges } = ctx;
  const safeCount = clampCount(configNode.data.count || 1);
  if (childIds.length !== safeCount) {
    ctx.onUpdateConfig("error", "批次占位与张数不一致");
    return;
  }

  if (configNode.data.generationMode !== "image") {
    ctx.onUpdateConfig("error", "文本模式暂未启用");
    return;
  }

  ctx.onUpdateConfig("running");

  const ordered = getOrderedUpstreamNodes(configNode.id, nodes, edges, configNode.data.inputOrder);
  const upstreamText = ordered
    .map((node) => {
      if (isPromptNode(node)) return node.data.prompt?.trim();
      if (isConfigNode(node)) return node.data.prompt?.trim();
      if (isImageNode(node) && !node.data.isBatchRoot) return node.data.prompt?.trim();
      return undefined;
    })
    .filter((text): text is string => Boolean(text && text.length > 0));

  const basePrompt = [configNode.data.prompt?.trim(), ...upstreamText]
    .filter(Boolean)
    .join("\n\n");

  if (!basePrompt) {
    ctx.onUpdateConfig("error", "请输入提示词，或连接含提示词的上游节点");
    childIds.forEach((id) =>
      ctx.onUpdateChild(id, (data) => ({
        ...data,
        status: "error",
        error: "缺少提示词",
      })),
    );
    return;
  }

  let referenceFiles: File[];
  try {
    referenceFiles = await buildReferenceFiles(ordered, configNode.id);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "读取参考图失败";
    ctx.onUpdateConfig("error", message);
    childIds.forEach((id) =>
      ctx.onUpdateChild(id, (data) => ({ ...data, status: "error", error: message })),
    );
    return;
  }

  const generationType = referenceFiles.length > 0 ? "edit" : "generation";

  // Mark every child + root as running so the UI shows spinners immediately.
  ctx.onUpdateRoot((data) => ({ ...data, status: "running", error: undefined }));
  childIds.forEach((id) =>
    ctx.onUpdateChild(id, (data) => ({
      ...data,
      prompt: basePrompt,
      status: "running",
      error: undefined,
      url: undefined,
      b64_json: undefined,
      model: configNode.data.model,
      size: configNode.data.size,
    })),
  );

  let firstSuccessChildId: string | null = null;
  const failures: string[] = [];

  await Promise.all(
    childIds.map(async (childId) => {
      const clientTaskId = createClientTaskId();
      ctx.onUpdateChild(childId, (data) => ({
        ...data,
        taskId: clientTaskId,
      }));
      try {
        const submitted =
          generationType === "edit"
            ? await createImageEditTask(
                clientTaskId,
                referenceFiles,
                basePrompt,
                configNode.data.model,
                configNode.data.size,
              )
            : await createImageGenerationTask(
                clientTaskId,
                basePrompt,
                configNode.data.model,
                configNode.data.size,
              );

        applyTaskUpdate(submitted, (updater) => ctx.onUpdateChild(childId, updater));
        await pollUntilTerminal(clientTaskId, (updater) => ctx.onUpdateChild(childId, updater));

        // After polling, the child's status is whatever the last update set.
        // We cannot read it back here, so we track success via the task tail.
        // The poll loop sets either success or error via applyTaskUpdate.
        // For root mirroring, we mark the first success seen.
        if (firstSuccessChildId === null) {
          // Best-effort: read the latest task — used to gate root preview update.
          const latest = await fetchTaskOnce(clientTaskId);
          if (latest?.status === "success") {
            firstSuccessChildId = childId;
            const primary = latest.data?.[0];
            ctx.onUpdateRoot((data) => ({
              ...data,
              status: "success",
              primaryImageId: childId,
              url: primary?.url ?? data.url,
              b64_json: primary?.b64_json ?? data.b64_json,
              error: undefined,
            }));
          }
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "生成失败";
        failures.push(message);
        ctx.onUpdateChild(childId, (data) => ({
          ...data,
          status: "error",
          error: message,
        }));
      }
    }),
  );

  if (firstSuccessChildId === null) {
    ctx.onUpdateRoot((data) => ({
      ...data,
      status: "error",
      error: failures[0] ?? "所有生成均失败",
    }));
    ctx.onUpdateConfig("error", failures[0] ?? "所有生成均失败");
  } else {
    ctx.onUpdateConfig("success");
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────

async function pollUntilTerminal(
  clientTaskId: string,
  onUpdate: (updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => void,
): Promise<void> {
  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    const latest = await fetchTaskOnce(clientTaskId);
    if (latest) {
      applyTaskUpdate(latest, onUpdate);
      if (latest.status === "success" || latest.status === "error") {
        return;
      }
    }
    await sleep(POLL_INTERVAL_MS);
    attempts += 1;
  }
  onUpdate((data) => ({ ...data, status: "error", error: "等待超时，请重试" }));
}

async function fetchTaskOnce(taskId: string): Promise<ImageTask | null> {
  try {
    const list = await fetchImageTasks([taskId]);
    return list.items.find((item) => item.id === taskId) ?? null;
  } catch {
    return null;
  }
}

function applyTaskUpdate(
  task: ImageTask,
  onUpdate: (updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => void,
) {
  if (task.status === "success") {
    const first = task.data?.[0];
    onUpdate((data) => ({
      ...data,
      status: "success",
      taskId: task.id,
      b64_json: first?.b64_json ?? data.b64_json,
      url: first?.url ?? data.url,
      error: undefined,
    }));
    return;
  }
  if (task.status === "error") {
    onUpdate((data) => ({
      ...data,
      status: "error",
      taskId: task.id,
      error: task.error || "生成失败",
    }));
    return;
  }
  onUpdate((data) => ({
    ...data,
    status: "running",
    taskId: task.id,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
