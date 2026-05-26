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
import { decodeBase64Bytes } from "@/lib/base64";

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 90; // ~3 minutes
const MAX_UPSTREAM_DEPTH = 12; // safety bound for transitive walk

function createClientTaskId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `canvas-${crypto.randomUUID()}`;
  }
  return `canvas-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function humanizeImageTaskError(message?: string): string {
  const raw = (message || "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("no available image quota")) {
    return "号池中没有可用生图账号或账号额度已耗尽，请先在账号管理中添加/刷新可用账号。";
  }
  if (lower.includes("newapi image request failed") && lower.includes("status=524")) {
    return "NewAPI 生图上游超时（524），请检查 NewAPI 服务状态、网络连通性或更换可用上游。";
  }
  if (lower.includes("expecting value: line 1 column 1")) {
    return "生图上游返回了空响应或非 JSON 内容，请检查上游服务状态和代理连接。";
  }
  return raw || "生成失败";
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string): File {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const bytes = new Uint8Array(decodeBase64Bytes(content || ""));
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
 * Resolve **direct** parent nodes for a target, honouring an optional
 * `inputOrder` array on the target's metadata. Nodes not yet wired in
 * `inputOrder` fall through to their edge-insertion order.
 *
 * This is the one-hop primitive used by the preview modal for ordering
 * controls. For run-time resource collection use
 * {@link collectUpstreamContributions}, which walks transitively.
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

export type UpstreamTextFragment = {
  /** Originating node id; for prompt-from-image use the image node id. */
  nodeId: string;
  /** Optional label used in the preview modal. */
  title: string;
  source: "prompt" | "config" | "image-prompt";
  text: string;
};

export type UpstreamContributions = {
  /** Concrete image nodes (success + data) — terminal content. */
  imageNodes: CanvasImageNode[];
  /** Text fragments in collection order. */
  textFragments: UpstreamTextFragment[];
};

/**
 * Walk transitively upstream from `targetNodeId`, collecting:
 *
 * - **Text fragments** from `prompt` nodes, `config` node prompts, and the
 *   prompt of any image node we visit before terminating on it.
 * - **Image references** from `image` nodes that have completed successfully
 *   and carry payload (`url` or `b64_json`). Such nodes are terminal — we
 *   do **not** recurse past them, because their pixels already encode the
 *   composition of their upstream.
 *
 * Pass-through rules:
 * - `prompt` nodes contribute their text and pass through (the user uses
 *   them as in-line annotations between images).
 * - `config` nodes contribute their text and pass through (chained configs).
 * - `image` batch roots are placeholders; we expand them to their successful
 *   `batchChildIds` and stop.
 * - `image` nodes without payload (queued / running / error) pass through so
 *   we can find usable references further back.
 *
 * Ordering: at every hop we honour `inputOrder` for the directly-connected
 * children; for transitively-discovered ancestors we use edge-insertion
 * order. Nodes are de-duplicated.
 */
export function collectUpstreamContributions(
  targetNodeId: string,
  nodes: CanvasAnyNode[],
  edges: CanvasEdge[],
  inputOrder?: string[],
): UpstreamContributions {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const seenImageIds = new Set<string>();
  const imageNodes: CanvasImageNode[] = [];
  const textFragments: UpstreamTextFragment[] = [];

  function pushImage(node: CanvasImageNode) {
    if (seenImageIds.has(node.id)) return;
    if (node.data.status !== "success") return;
    if (!node.data.url && !node.data.b64_json) return;
    seenImageIds.add(node.id);
    imageNodes.push(node);
  }

  function pushText(fragment: UpstreamTextFragment) {
    if (!fragment.text) return;
    textFragments.push(fragment);
  }

  function walk(currentId: string, depth: number) {
    if (depth > MAX_UPSTREAM_DEPTH) return;
    if (visited.has(currentId)) return;
    visited.add(currentId);

    const parents = getOrderedUpstreamNodes(
      currentId,
      nodes,
      edges,
      currentId === targetNodeId ? inputOrder : undefined,
    );

    for (const parent of parents) {
      if (isPromptNode(parent)) {
        pushText({
          nodeId: parent.id,
          title: parent.data.title || "提示词节点",
          source: "prompt",
          text: parent.data.prompt?.trim() ?? "",
        });
        walk(parent.id, depth + 1);
        continue;
      }

      if (isConfigNode(parent)) {
        pushText({
          nodeId: parent.id,
          title: parent.data.title || "配置节点",
          source: "config",
          text: parent.data.prompt?.trim() ?? "",
        });
        walk(parent.id, depth + 1);
        continue;
      }

      if (isImageNode(parent)) {
        if (parent.data.isBatchRoot) {
          // Expand the root to its successful children, then stop.
          for (const childId of parent.data.batchChildIds ?? []) {
            const child = nodeMap.get(childId);
            if (child && isImageNode(child)) {
              pushImage(child);
            }
          }
          continue;
        }

        if (parent.data.status === "success" && (parent.data.url || parent.data.b64_json)) {
          pushImage(parent);
          if (parent.data.prompt?.trim()) {
            pushText({
              nodeId: `${parent.id}:prompt`,
              title: parent.data.title || "图片节点",
              source: "image-prompt",
              text: parent.data.prompt.trim(),
            });
          }
          // Terminal — image already encodes upstream context.
          continue;
        }

        // Incomplete image: recurse to look for usable references upstream.
        walk(parent.id, depth + 1);
      }
    }
  }

  walk(targetNodeId, 0);
  return { imageNodes, textFragments };
}

/**
 * Convert collected image nodes into File references. Returns files in the
 * same order as `imageNodes`; unreachable URLs are skipped silently.
 */
async function imageNodesToFiles(
  imageNodes: CanvasImageNode[],
  ownerId: string,
): Promise<File[]> {
  const files: File[] = [];
  let index = 0;
  for (const node of imageNodes) {
    index += 1;
    const fileName = `upstream-${ownerId}-${index}.png`;
    if (node.data.b64_json) {
      files.push(
        dataUrlToFile(`data:image/png;base64,${node.data.b64_json}`, fileName, "image/png"),
      );
      continue;
    }
    if (node.data.url) {
      try {
        files.push(await fetchImageAsFile(node.data.url, fileName));
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
  const { imageNodes } = collectUpstreamContributions(targetNodeId, nodes, edges);
  return imageNodesToFiles(imageNodes, targetNodeId);
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
    const message = humanizeImageTaskError(cause instanceof Error ? cause.message : undefined);
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
 * 1. Resolve transitive upstream → reference files + combined prompt
 * 2. Submit one task per result node concurrently
 * 3. Patch each result node with its terminal state
 * 4. Mirror first success to the root result + mark Config status
 */
export async function runConfigNode(ctx: ConfigRunContext): Promise<void> {
  const { configNode, rootId: _rootId, childIds, nodes, edges } = ctx;
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

  const { imageNodes, textFragments } = collectUpstreamContributions(
    configNode.id,
    nodes,
    edges,
    configNode.data.inputOrder,
  );

  const basePrompt = [configNode.data.prompt?.trim(), ...textFragments.map((f) => f.text)]
    .filter((segment): segment is string => Boolean(segment && segment.length > 0))
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
    referenceFiles = await imageNodesToFiles(imageNodes, configNode.id);
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

        if (firstSuccessChildId === null) {
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
        const message = humanizeImageTaskError(cause instanceof Error ? cause.message : undefined);
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
      error: humanizeImageTaskError(task.error),
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
