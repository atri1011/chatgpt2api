/**
 * Canvas data shapes for the Phase B MVP.
 *
 * Derived from infinite-canvas (https://github.com/basketikun/infinite-canvas,
 * AGPL-3.0). MVP keeps a single node kind ("image") and stores graph state
 * locally via localforage.
 */
import type { Edge, Node } from "@xyflow/react";

import type { ImageModel } from "@/lib/api";

export type CanvasNodeStatus = "idle" | "queued" | "running" | "success" | "error";

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
};

export type CanvasImageNode = Node<CanvasImageNodeData, "image">;

export type CanvasEdgeData = Record<string, never>;
export type CanvasEdge = Edge<CanvasEdgeData>;

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasGraph = {
  nodes: CanvasImageNode[];
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
