"use client";

import {
  createImageEditTask,
  createImageGenerationTask,
  fetchImageTasks,
  type ImageTask,
} from "@/lib/api";
import type {
  CanvasEdge,
  CanvasImageNode,
  CanvasImageNodeData,
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
 * Collect direct-parent image references for a given target node.
 *
 * MVP semantics: only walks one BFS layer (direct upstream nodes). Each
 * parent node that completed successfully contributes a File built from its
 * b64_json (preferred, in-memory) or url (fetched as Blob).
 */
export async function collectUpstreamReferences(
  targetNodeId: string,
  nodes: CanvasImageNode[],
  edges: CanvasEdge[],
): Promise<File[]> {
  const parentEdges = edges.filter((edge) => edge.target === targetNodeId);
  if (parentEdges.length === 0) return [];

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const references: File[] = [];

  for (let index = 0; index < parentEdges.length; index += 1) {
    const parent = nodeMap.get(parentEdges[index].source);
    if (!parent || parent.data.status !== "success") continue;
    const fileName = `upstream-${parent.id}-${index + 1}.png`;
    if (parent.data.b64_json) {
      references.push(
        dataUrlToFile(`data:image/png;base64,${parent.data.b64_json}`, fileName, "image/png"),
      );
      continue;
    }
    if (parent.data.url) {
      try {
        references.push(await fetchImageAsFile(parent.data.url, fileName));
      } catch {
        // Skip unreachable upstream image rather than blocking the entire run.
      }
    }
  }

  return references;
}

export type RunNodeContext = {
  node: CanvasImageNode;
  references: File[];
  onUpdate: (updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => void;
};

/**
 * Run a single node end-to-end: submit task, poll until terminal, update data.
 *
 * Caller is responsible for first updating node status to "queued" if it wants
 * UI feedback before this function runs (which happens immediately on entry).
 */
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
    const submitted = references.length > 0
      ? await createImageEditTask(clientTaskId, references, prompt, node.data.model, node.data.size)
      : await createImageGenerationTask(clientTaskId, prompt, node.data.model, node.data.size);

    applyTaskUpdate(submitted, onUpdate);

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
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "生成失败";
    onUpdate((data) => ({ ...data, status: "error", error: message }));
  }
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
