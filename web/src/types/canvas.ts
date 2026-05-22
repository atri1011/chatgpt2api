/**
 * Canvas data shapes.
 *
 * Derived from infinite-canvas (https://github.com/basketikun/infinite-canvas,
 * AGPL-3.0). The 3-kind model (image / config) and batch-result idea
 * (root + N children) follows the upstream design; we keep React Flow as
 * the rendering layer and persist via localforage.
 */
import type { Edge, Node } from "@xyflow/react";

import type { ImageModel } from "@/lib/api";

export type CanvasNodeStatus = "idle" | "queued" | "running" | "success" | "error";
export type CanvasGenerationMode = "image" | "text";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasImageNodeData = {
  prompt: string;
  status: CanvasNodeStatus;
  /** Server-side task id returned by /api/image-tasks/* */
  taskId?: string;
  /** Resolved image URL (preferred for persistence) */
  url?: string;
  /** Base64 payload; only kept in-memory unless the user opts in */
  b64_json?: string;
  /** Optional override; falls back to settings default */
  model?: ImageModel;
  /** Optional aspect ratio, e.g. "16:9" */
  size?: string;
  error?: string;
  /** Free-form node label shown in the header */
  title?: string;

  // ── Batch metadata (results from a Config node fan-out) ───────────────
  /** Marks a "root" placeholder that owns N children produced by a single batch. */
  isBatchRoot?: boolean;
  /** Children ids when this node is the batch root. */
  batchChildIds?: string[];
  /** Back-pointer from a child to its batch root. */
  batchRootId?: string;
  /** Child id whose preview is mirrored on the root. */
  primaryImageId?: string;
  /** UX flag — root can collapse to show only the primary. */
  imageBatchExpanded?: boolean;
};

export type CanvasConfigNodeData = {
  status: CanvasNodeStatus;
  title?: string;
  /** Free-form local prompt; merged with upstream text inputs at run time. */
  prompt: string;
  generationMode: CanvasGenerationMode;
  /** Resolved at run time from upstream references; persisted for retries. */
  generationType?: CanvasImageGenerationType;
  model?: ImageModel;
  /** Aspect ratio string compatible with /v1/images/* size param. */
  size?: string;
  /** N children to produce; clamped 1..15 at the runner boundary. */
  count: number;
  /** Ordered list of upstream nodeIds; overrides edge insertion order. */
  inputOrder?: string[];
  error?: string;
};

/**
 * Pure prompt-only node. No image generation, no remote task. When wired
 * upstream of a Config node, its `prompt` text is concatenated into the
 * final prompt. Mirrors the dark "二次元风格..." card in the spec.
 */
export type CanvasPromptNodeData = {
  status: "idle"; // always idle; kept for shape consistency across nodes
  title?: string;
  prompt: string;
};

export type CanvasNodeData = CanvasImageNodeData | CanvasConfigNodeData | CanvasPromptNodeData;

export type CanvasImageNode = Node<CanvasImageNodeData, "image">;
export type CanvasConfigNode = Node<CanvasConfigNodeData, "config">;
export type CanvasPromptNode = Node<CanvasPromptNodeData, "prompt">;
export type CanvasAnyNode = CanvasImageNode | CanvasConfigNode | CanvasPromptNode;

export type CanvasEdgeData = Record<string, never>;
export type CanvasEdge = Edge<CanvasEdgeData>;

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasGraph = {
  nodes: CanvasAnyNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  updatedAt: string;
};

export const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

export const EMPTY_GRAPH: CanvasGraph = {
  nodes: [],
  edges: [],
  viewport: DEFAULT_VIEWPORT,
  updatedAt: new Date(0).toISOString(),
};

export const MIN_COUNT = 1;
export const MAX_COUNT = 15;

export const IMAGE_SIZE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "未指定" },
  { value: "1:1", label: "1:1 正方形" },
  { value: "16:9", label: "16:9 横版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "9:16", label: "9:16 竖版" },
];

export const IMAGE_MODEL_OPTIONS: ReadonlyArray<{ value: ImageModel; label: string }> = [
  { value: "gpt-image-2", label: "gpt-image-2" },
  { value: "codex-gpt-image-2", label: "codex-gpt-image-2" },
];

export function isImageNode(node: CanvasAnyNode): node is CanvasImageNode {
  return node.type === "image";
}

export function isConfigNode(node: CanvasAnyNode): node is CanvasConfigNode {
  return node.type === "config";
}

export function isPromptNode(node: CanvasAnyNode): node is CanvasPromptNode {
  return node.type === "prompt";
}
