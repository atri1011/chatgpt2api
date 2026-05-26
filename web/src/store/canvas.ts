"use client";

import localforage from "localforage";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_VIEWPORT,
  EMPTY_GRAPH,
  MAX_COUNT,
  MIN_COUNT,
  isConfigNode,
  isImageNode,
  isPromptNode,
  type CanvasAnyNode,
  type CanvasConfigNode,
  type CanvasConfigNodeData,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasImageNode,
  type CanvasImageNodeData,
  type CanvasPromptNode,
  type CanvasPromptNodeData,
  type CanvasViewport,
} from "@/types/canvas";

const canvasStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "canvas",
});

const GRAPH_KEY = "graph";
let writeQueue: Promise<void> = Promise.resolve();
const PERSIST_DEBOUNCE_MS = 300;
const CANVAS_EXPORT_APP = "chatgpt2api-canvas";
const CANVAS_EXPORT_VERSION = 1;
const HISTORY_LIMIT = 80;

export type CanvasExportPayload = {
  app: typeof CANVAS_EXPORT_APP;
  version: typeof CANVAS_EXPORT_VERSION;
  exportedAt: string;
  graph: CanvasGraph;
};

function cloneGraph(graph: CanvasGraph): CanvasGraph {
  return {
    nodes: graph.nodes.map((node) => {
      const data = { ...node.data };
      if ("inputOrder" in data && Array.isArray(data.inputOrder)) {
        data.inputOrder = [...data.inputOrder];
      }
      if ("batchChildIds" in data && Array.isArray(data.batchChildIds)) {
        data.batchChildIds = [...data.batchChildIds];
      }
      return {
        ...node,
        selected: false,
        position: { ...node.position },
        data,
      } as CanvasAnyNode;
    }),
    edges: graph.edges.map((edge) => ({
      ...edge,
      selected: false,
      style: edge.style ? { ...edge.style } : edge.style,
    })),
    viewport: { ...graph.viewport },
    updatedAt: graph.updatedAt,
  };
}

function graphHistoryKey(graph: CanvasGraph) {
  return JSON.stringify({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      width: node.width,
      height: node.height,
      data: node.data,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  });
}

function queueWrite(operation: () => Promise<void>): Promise<void> {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => undefined);
  return result;
}

function sanitizeImageData(data: CanvasImageNodeData): CanvasImageNodeData {
  const { b64_json: _stripped, ...rest } = data;
  const wasInflight = data.status === "running" || data.status === "queued";
  return {
    ...rest,
    status: wasInflight ? "error" : data.status,
    error: wasInflight ? "页面刷新中断，请重新运行" : data.error,
  };
}

function sanitizeConfigData(data: CanvasConfigNodeData): CanvasConfigNodeData {
  const wasInflight = data.status === "running" || data.status === "queued";
  return {
    ...data,
    status: wasInflight ? "error" : data.status,
    error: wasInflight ? "页面刷新中断，请重新运行" : data.error,
  };
}

function sanitizeNodeForPersist(node: CanvasAnyNode): CanvasAnyNode {
  if (isImageNode(node)) {
    return { ...node, selected: false, data: sanitizeImageData(node.data) };
  }
  if (isConfigNode(node)) {
    return { ...node, selected: false, data: sanitizeConfigData(node.data) };
  }
  if (isPromptNode(node)) {
    // Prompt nodes have no remote state — store as-is.
    return { ...node, selected: false };
  }
  return node;
}

async function readGraph(): Promise<CanvasGraph> {
  const raw = await canvasStorage.getItem<CanvasGraph>(GRAPH_KEY);
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    return EMPTY_GRAPH;
  }
  // Old MVP graphs stored plain image nodes without `type`. Normalise.
  const normalised = (raw.nodes as Array<Record<string, unknown>>).map((node) => {
    if (!node.type) return { ...node, type: "image" as const };
    return node;
  });
  return {
    nodes: normalised as CanvasAnyNode[],
    edges: raw.edges,
    viewport: raw.viewport ?? DEFAULT_VIEWPORT,
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

async function writeGraph(graph: CanvasGraph): Promise<void> {
  const persisted: CanvasGraph = {
    nodes: graph.nodes.map(sanitizeNodeForPersist),
    edges: graph.edges,
    viewport: graph.viewport,
    updatedAt: new Date().toISOString(),
  };
  await canvasStorage.setItem(GRAPH_KEY, persisted);
}

export async function loadCanvas(): Promise<CanvasGraph> {
  return readGraph();
}

export async function saveCanvas(graph: CanvasGraph): Promise<void> {
  await queueWrite(() => writeGraph(graph));
}

export async function clearCanvas(): Promise<void> {
  await queueWrite(() => canvasStorage.removeItem(GRAPH_KEY));
}

function createNodeId(prefix: string = "node") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createEdgeId(source: string, target: string) {
  return `edge-${source}-${target}`;
}

function makeEdge(source: string, target: string): CanvasEdge {
  return {
    id: createEdgeId(source, target),
    source,
    target,
    animated: false,
    style: { strokeWidth: 1.5 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normaliseStatus(value: unknown): CanvasImageNodeData["status"] {
  if (
    value === "idle" ||
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "error"
  ) {
    return value;
  }
  return "idle";
}

function normalisePosition(raw: unknown) {
  if (!isRecord(raw)) return { x: 0, y: 0 };
  return {
    x: numberValue(raw.x, 0),
    y: numberValue(raw.y, 0),
  };
}

function normaliseImportedNode(raw: unknown): CanvasAnyNode | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;

  const type =
    raw.type === "config" || raw.type === "prompt" || raw.type === "image" ? raw.type : "image";
  const data = isRecord(raw.data) ? raw.data : {};
  const position = normalisePosition(raw.position);

  if (type === "config") {
    const node = createConfigNode(position);
    return sanitizeNodeForPersist({
      ...node,
      id: raw.id,
      width: numberValue(raw.width, node.width ?? 320),
      height: numberValue(raw.height, node.height ?? 280),
      selected: false,
      data: {
        ...node.data,
        prompt: stringValue(data.prompt, ""),
        status: normaliseStatus(data.status),
        title: stringValue(data.title, "生成配置"),
        generationMode: data.generationMode === "text" ? "text" : "image",
        generationType:
          data.generationType === "edit" || data.generationType === "generation"
            ? data.generationType
            : undefined,
        model: stringValue(data.model, "gpt-image-2") as CanvasConfigNodeData["model"],
        size: stringValue(data.size, "1:1"),
        count: clampCount(numberValue(data.count, 1)),
        inputOrder: Array.isArray(data.inputOrder)
          ? data.inputOrder.filter((item): item is string => typeof item === "string")
          : [],
        error: typeof data.error === "string" ? data.error : undefined,
      },
    } as CanvasConfigNode);
  }

  if (type === "prompt") {
    const node = createPromptNode(position);
    return {
      ...node,
      id: raw.id,
      width: numberValue(raw.width, node.width ?? 320),
      height: numberValue(raw.height, node.height ?? 200),
      selected: false,
      data: {
        status: "idle",
        prompt: stringValue(data.prompt, ""),
        title: stringValue(data.title, "提示词"),
      },
    };
  }

  const node = createImageNode(position);
  return sanitizeNodeForPersist({
    ...node,
    id: raw.id,
    width: numberValue(raw.width, node.width ?? 300),
    height: numberValue(raw.height, node.height ?? 360),
    selected: false,
    data: {
      ...node.data,
      prompt: stringValue(data.prompt, ""),
      status: normaliseStatus(data.status),
      taskId: typeof data.taskId === "string" ? data.taskId : undefined,
      url: typeof data.url === "string" ? data.url : undefined,
      b64_json: typeof data.b64_json === "string" ? data.b64_json : undefined,
      model: stringValue(data.model, "gpt-image-2") as CanvasImageNodeData["model"],
      size: typeof data.size === "string" ? data.size : undefined,
      error: typeof data.error === "string" ? data.error : undefined,
      title: stringValue(data.title, "图片节点"),
      isBatchRoot: data.isBatchRoot === true,
      batchChildIds: Array.isArray(data.batchChildIds)
        ? data.batchChildIds.filter((item): item is string => typeof item === "string")
        : undefined,
      batchRootId: typeof data.batchRootId === "string" ? data.batchRootId : undefined,
      primaryImageId: typeof data.primaryImageId === "string" ? data.primaryImageId : undefined,
      imageBatchExpanded: data.imageBatchExpanded !== false,
    },
  } as CanvasImageNode);
}

export function normaliseCanvasGraph(raw: unknown): CanvasGraph | null {
  const graphCandidate =
    isRecord(raw) && isRecord(raw.graph) && raw.app === CANVAS_EXPORT_APP ? raw.graph : raw;
  if (!isRecord(graphCandidate) || !Array.isArray(graphCandidate.nodes)) return null;

  const seenNodeIds = new Set<string>();
  const nodes = graphCandidate.nodes
    .map(normaliseImportedNode)
    .filter((node): node is CanvasAnyNode => {
      if (node === null || seenNodeIds.has(node.id)) return false;
      seenNodeIds.add(node.id);
      return true;
    });
  if (nodes.length === 0) return null;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenEdgeIds = new Set<string>();
  const edges = Array.isArray(graphCandidate.edges)
    ? graphCandidate.edges
        .map((edge): CanvasEdge | null => {
          if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") {
            return null;
          }
          if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null;
          const id = typeof edge.id === "string" ? edge.id : createEdgeId(edge.source, edge.target);
          if (seenEdgeIds.has(id)) return null;
          seenEdgeIds.add(id);
          return {
            id,
            source: edge.source,
            target: edge.target,
            animated: edge.animated === true,
            selected: false,
            style: { strokeWidth: 1.5 },
          };
        })
        .filter((edge): edge is CanvasEdge => edge !== null)
    : [];

  return {
    nodes,
    edges,
    viewport: normalisePosition(graphCandidate.viewport)
      ? {
          ...DEFAULT_VIEWPORT,
          ...normalisePosition(graphCandidate.viewport),
          zoom: isRecord(graphCandidate.viewport)
            ? numberValue(graphCandidate.viewport.zoom, DEFAULT_VIEWPORT.zoom)
            : DEFAULT_VIEWPORT.zoom,
        }
      : DEFAULT_VIEWPORT,
    updatedAt: new Date().toISOString(),
  };
}

export function createCanvasExportPayload(graph: CanvasGraph): CanvasExportPayload {
  return {
    app: CANVAS_EXPORT_APP,
    version: CANVAS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    graph: {
      nodes: graph.nodes.map(sanitizeNodeForPersist),
      edges: graph.edges.map((edge) => ({ ...edge, selected: false })),
      viewport: graph.viewport,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function createStarterCanvasGraph(): CanvasGraph {
  const prompt = createPromptNode({ x: 0, y: 0 });
  prompt.data = {
    ...prompt.data,
    title: "主提示词",
    prompt:
      "生成一张干净、有明确主体的产品概念图。画面构图稳定，细节丰富，光线自然，适合作为后续继续编辑的基础图。",
  };

  const config = createConfigNode({ x: 420, y: -32 });
  config.data = {
    ...config.data,
    title: "首轮生成",
    count: 4,
    size: "1:1",
    model: "gpt-image-2",
    inputOrder: [prompt.id],
  };

  return {
    nodes: [prompt, config],
    edges: [makeEdge(prompt.id, config.id)],
    viewport: DEFAULT_VIEWPORT,
    updatedAt: new Date().toISOString(),
  };
}

function withCopyTitle(title: string | undefined, fallback: string) {
  const base = title?.trim() || fallback;
  return `${base} 副本`;
}

function cloneImageNodeForDuplicate(node: CanvasImageNode): CanvasImageNode {
  const wasInflight = node.data.status === "running" || node.data.status === "queued";
  const {
    batchChildIds: _batchChildIds,
    batchRootId: _batchRootId,
    imageBatchExpanded: _imageBatchExpanded,
    isBatchRoot: _isBatchRoot,
    primaryImageId: _primaryImageId,
    taskId: _taskId,
    ...data
  } = node.data;

  return {
    ...node,
    id: createNodeId("img"),
    position: { x: node.position.x + 40, y: node.position.y + 40 },
    selected: true,
    data: {
      ...data,
      status: wasInflight ? "idle" : data.status,
      error: wasInflight ? undefined : data.error,
      title: withCopyTitle(data.title, "图片节点"),
    },
  };
}

function cloneConfigNodeForDuplicate(node: CanvasConfigNode): CanvasConfigNode {
  const wasInflight = node.data.status === "running" || node.data.status === "queued";
  return {
    ...node,
    id: createNodeId("cfg"),
    position: { x: node.position.x + 40, y: node.position.y + 40 },
    selected: true,
    data: {
      ...node.data,
      status: wasInflight ? "idle" : node.data.status,
      error: wasInflight ? undefined : node.data.error,
      title: withCopyTitle(node.data.title, "生成配置"),
      inputOrder: [],
    },
  };
}

function clonePromptNodeForDuplicate(node: CanvasPromptNode): CanvasPromptNode {
  return {
    ...node,
    id: createNodeId("prm"),
    position: { x: node.position.x + 40, y: node.position.y + 40 },
    selected: true,
    data: {
      ...node.data,
      title: withCopyTitle(node.data.title, "提示词"),
    },
  };
}

function cloneNodeForDuplicate(node: CanvasAnyNode): CanvasAnyNode {
  if (isImageNode(node)) return cloneImageNodeForDuplicate(node);
  if (isConfigNode(node)) return cloneConfigNodeForDuplicate(node);
  return clonePromptNodeForDuplicate(node);
}

export function createImageNode(position: { x: number; y: number }): CanvasImageNode {
  return {
    id: createNodeId("img"),
    type: "image",
    position,
    width: 300,
    height: 360,
    data: {
      prompt: "",
      status: "idle",
      title: "图片节点",
    },
  };
}

export function createConfigNode(position: { x: number; y: number }): CanvasConfigNode {
  return {
    id: createNodeId("cfg"),
    type: "config",
    position,
    width: 320,
    height: 280,
    data: {
      prompt: "",
      status: "idle",
      title: "生成配置",
      generationMode: "image",
      model: "gpt-image-2",
      size: "1:1",
      count: 1,
      inputOrder: [],
    },
  };
}

export function createPromptNode(position: { x: number; y: number }): CanvasPromptNode {
  return {
    id: createNodeId("prm"),
    type: "prompt",
    position,
    width: 320,
    height: 200,
    data: {
      status: "idle",
      prompt: "",
      title: "提示词",
    },
  };
}

/**
 * Build a placeholder child image node (used by a Config batch fan-out).
 * Width matches the canonical image node so siblings line up in the grid.
 */
export function createBatchChildPlaceholder(
  position: { x: number; y: number },
  options: { batchRootId: string; title?: string },
): CanvasImageNode {
  return {
    id: createNodeId("img"),
    type: "image",
    position,
    width: 300,
    height: 360,
    data: {
      prompt: "",
      status: "queued",
      title: options.title ?? "结果",
      batchRootId: options.batchRootId,
    },
  };
}

/**
 * Build a "root" image node that owns a batch of children. The root shows the
 * primary child's preview once any child completes.
 */
export function createBatchRootPlaceholder(
  position: { x: number; y: number },
  options: { childIds: string[]; title?: string },
): CanvasImageNode {
  return {
    id: createNodeId("img"),
    type: "image",
    position,
    width: 300,
    height: 360,
    data: {
      prompt: "",
      status: "queued",
      title: options.title ?? "批次",
      isBatchRoot: true,
      batchChildIds: options.childIds,
      imageBatchExpanded: true,
    },
  };
}

export function addEdgeConnection(
  graph: CanvasGraph,
  source: string,
  target: string,
): CanvasGraph {
  if (source === target) return graph;
  const id = createEdgeId(source, target);
  if (graph.edges.some((edge) => edge.id === id)) return graph;
  return {
    ...graph,
    edges: [...graph.edges, makeEdge(source, target)],
  };
}

export function duplicateCanvasSelection(
  graph: CanvasGraph,
  nodeIds: string[],
): { graph: CanvasGraph; duplicatedNodeIds: string[] } {
  const selectedIds = new Set(nodeIds);
  if (selectedIds.size === 0) {
    return { graph, duplicatedNodeIds: [] };
  }

  const idMap = new Map<string, string>();
  const duplicatedNodes = graph.nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => {
      const clone = cloneNodeForDuplicate(node);
      idMap.set(node.id, clone.id);
      return clone;
    });

  const duplicatedEdges: CanvasEdge[] = [];
  graph.edges.forEach((edge) => {
    if (!selectedIds.has(edge.source) || !selectedIds.has(edge.target)) return;
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) return;
    duplicatedEdges.push({
      ...edge,
      id: createEdgeId(source, target),
      source,
      target,
      selected: false,
    });
  });

  const duplicatedNodeIds = duplicatedNodes.map((node) => node.id);
  return {
    graph: {
      ...graph,
      nodes: [
        ...graph.nodes.map((node) => ({ ...node, selected: false }) as CanvasAnyNode),
        ...duplicatedNodes,
      ],
      edges: [...graph.edges.map((edge) => ({ ...edge, selected: false })), ...duplicatedEdges],
      updatedAt: new Date().toISOString(),
    },
    duplicatedNodeIds,
  };
}

export function arrangeCanvasGraph(graph: CanvasGraph): CanvasGraph {
  if (graph.nodes.length <= 1) {
    return graph;
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const incomingCount = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  graph.edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });

  const queue = graph.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((a, b) => a.position.y - b.position.y)
    .map((node) => node.id);
  const layerById = new Map<string, number>();

  queue.forEach((id) => layerById.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const layer = layerById.get(id) ?? 0;
    (outgoing.get(id) ?? []).forEach((targetId) => {
      const nextLayer = Math.max(layerById.get(targetId) ?? 0, layer + 1);
      layerById.set(targetId, nextLayer);
      incomingCount.set(targetId, Math.max(0, (incomingCount.get(targetId) ?? 0) - 1));
      if (incomingCount.get(targetId) === 0) {
        queue.push(targetId);
      }
    });
  }

  graph.nodes.forEach((node) => {
    if (!layerById.has(node.id)) {
      layerById.set(node.id, 0);
    }
  });

  const minX = Math.min(...graph.nodes.map((node) => node.position.x));
  const minY = Math.min(...graph.nodes.map((node) => node.position.y));
  const nodesByLayer = new Map<number, CanvasAnyNode[]>();
  graph.nodes.forEach((node) => {
    const layer = layerById.get(node.id) ?? 0;
    nodesByLayer.set(layer, [...(nodesByLayer.get(layer) ?? []), node]);
  });

  const positions = new Map<string, { x: number; y: number }>();
  Array.from(nodesByLayer.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([layer, nodesInLayer]) => {
      nodesInLayer
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .forEach((node, index) => {
          positions.set(node.id, {
            x: minX + layer * 420,
            y: minY + index * 420,
          });
        });
    });

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })) as CanvasAnyNode[],
    updatedAt: new Date().toISOString(),
  };
}

export function clampCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_COUNT;
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.floor(value)));
}

export type BatchPlacement = {
  rootId: string;
  childIds: string[];
  newNodes: CanvasImageNode[];
  newEdges: CanvasEdge[];
};

/**
 * Build a placement (without mutating the store) for a Config-node fan-out.
 * Single-image runs create one direct result node; multi-image runs keep the
 * batch root + child grid so grouped results stay manageable.
 */
export function buildBatchPlacement(options: {
  sourceNodeId: string;
  sourcePosition: { x: number; y: number };
  count: number;
  rootTitle?: string;
  childTitle?: (index: number) => string;
}): BatchPlacement {
  const { sourceNodeId, sourcePosition, count, rootTitle, childTitle } = options;
  const safeCount = clampCount(count);

  const rootX = sourcePosition.x + 380;
  const rootY = sourcePosition.y;
  const childGapX = 340;
  const childGapY = 400;

  const childIds: string[] = [];
  const newNodes: CanvasImageNode[] = [];
  const newEdges: CanvasEdge[] = [];

  if (safeCount === 1) {
    const result = createImageNode({ x: rootX, y: rootY });
    result.data = {
      ...result.data,
      status: "queued",
      title: childTitle ? childTitle(0) : rootTitle ?? "结果",
    };
    childIds.push(result.id);
    newNodes.push(result);
    newEdges.push(makeEdge(sourceNodeId, result.id));
    return { rootId: result.id, childIds, newNodes, newEdges };
  }

  // Root placeholder (must be created first so children can reference it)
  const rootBare = createBatchRootPlaceholder(
    { x: rootX, y: rootY },
    { childIds: [], title: rootTitle ?? "生成批次" },
  );
  newNodes.push(rootBare);
  newEdges.push(makeEdge(sourceNodeId, rootBare.id));

  for (let index = 0; index < safeCount; index += 1) {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const childPos = {
      x: rootX + 380 + col * childGapX,
      y: rootY + row * childGapY,
    };
    const child = createBatchChildPlaceholder(childPos, {
      batchRootId: rootBare.id,
      title: childTitle ? childTitle(index) : `结果 ${index + 1}`,
    });
    childIds.push(child.id);
    newNodes.push(child);
    newEdges.push(makeEdge(rootBare.id, child.id));
  }

  // Patch root with the child id list + primary now that ids are known.
  const root = newNodes[0] as CanvasImageNode;
  root.data = {
    ...root.data,
    batchChildIds: childIds,
    primaryImageId: childIds[0],
  };

  return { rootId: root.id, childIds, newNodes, newEdges };
}

/**
 * React hook exposing canvas state + actions with debounced auto-persist.
 */
export function useCanvasStore() {
  const [nodes, setNodes] = useState<CanvasAnyNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>(DEFAULT_VIEWPORT);
  const [isLoaded, setIsLoaded] = useState(false);
  const [historyCursor, setHistoryCursor] = useState(0);
  const historyRef = useRef<CanvasGraph[]>([]);
  const dirtyRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const nodesRef = useRef<CanvasAnyNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const viewportRef = useRef<CanvasViewport>(DEFAULT_VIEWPORT);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    let cancelled = false;
    void loadCanvas().then((graph) => {
      if (cancelled) return;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setViewport(graph.viewport);
      historyRef.current = [cloneGraph(graph)];
      setHistoryCursor(0);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const getCurrentGraph = useCallback(
    (): CanvasGraph => ({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      viewport: viewportRef.current,
      updatedAt: new Date().toISOString(),
    }),
    [],
  );

  const applyGraph = useCallback((graph: CanvasGraph) => {
    nodesRef.current = graph.nodes;
    edgesRef.current = graph.edges;
    viewportRef.current = graph.viewport;
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setViewport(graph.viewport);
  }, []);

  const pushHistory = useCallback((graph: CanvasGraph) => {
    const snapshot = cloneGraph(graph);
    setHistoryCursor((currentCursor) => {
      const stack = historyRef.current.slice(0, currentCursor + 1);
      const last = stack[stack.length - 1];
      if (last && graphHistoryKey(last) === graphHistoryKey(snapshot)) {
        return currentCursor;
      }
      stack.push(snapshot);
      if (stack.length > HISTORY_LIMIT) {
        stack.shift();
      }
      historyRef.current = stack;
      return stack.length - 1;
    });
  }, []);

  const commitGraph = useCallback(
    (graph: CanvasGraph) => {
      const next = {
        ...graph,
        updatedAt: new Date().toISOString(),
      };
      applyGraph(next);
      pushHistory(next);
    },
    [applyGraph, pushHistory],
  );

  const setNodesWithHistory = useCallback(
    (
      updater:
        | CanvasAnyNode[]
        | ((current: CanvasAnyNode[]) => CanvasAnyNode[]),
    ) => {
      const current = getCurrentGraph();
      const nextNodes =
        typeof updater === "function" ? updater(current.nodes) : updater;
      commitGraph({ ...current, nodes: nextNodes });
    },
    [commitGraph, getCurrentGraph],
  );

  const setEdgesWithHistory = useCallback(
    (
      updater:
        | CanvasEdge[]
        | ((current: CanvasEdge[]) => CanvasEdge[]),
    ) => {
      const current = getCurrentGraph();
      const nextEdges =
        typeof updater === "function" ? updater(current.edges) : updater;
      commitGraph({ ...current, edges: nextEdges });
    },
    [commitGraph, getCurrentGraph],
  );

  const schedulePersist = useCallback((next: CanvasGraph) => {
    dirtyRef.current = true;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      dirtyRef.current = false;
      void saveCanvas(next);
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    schedulePersist({
      nodes,
      edges,
      viewport,
      updatedAt: new Date().toISOString(),
    });
  }, [nodes, edges, viewport, isLoaded, schedulePersist]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        void saveCanvas({ nodes, edges, viewport, updatedAt: new Date().toISOString() });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateImageNodeData = useCallback(
    (nodeId: string, updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => {
      setNodesWithHistory((prev) =>
        prev.map((node) =>
          node.id === nodeId && isImageNode(node)
            ? ({ ...node, data: updater(node.data) } as CanvasImageNode)
            : node,
        ),
      );
    },
    [setNodesWithHistory],
  );

  const updateConfigNodeData = useCallback(
    (nodeId: string, updater: (data: CanvasConfigNodeData) => CanvasConfigNodeData) => {
      setNodesWithHistory((prev) =>
        prev.map((node) =>
          node.id === nodeId && isConfigNode(node)
            ? ({ ...node, data: updater(node.data) } as CanvasConfigNode)
            : node,
        ),
      );
    },
    [setNodesWithHistory],
  );

  const updatePromptNodeData = useCallback(
    (nodeId: string, updater: (data: CanvasPromptNodeData) => CanvasPromptNodeData) => {
      setNodesWithHistory((prev) =>
        prev.map((node) =>
          node.id === nodeId && isPromptNode(node)
            ? ({ ...node, data: updater(node.data) } as CanvasPromptNode)
            : node,
        ),
      );
    },
    [setNodesWithHistory],
  );

  const addImageNode = useCallback((position: { x: number; y: number }) => {
    const node = createImageNode(position);
    setNodesWithHistory((prev) => [...prev, node]);
    return node;
  }, [setNodesWithHistory]);

  const addConfigNode = useCallback((position: { x: number; y: number }) => {
    const node = createConfigNode(position);
    setNodesWithHistory((prev) => [...prev, node]);
    return node;
  }, [setNodesWithHistory]);

  const addPromptNode = useCallback((position: { x: number; y: number }) => {
    const node = createPromptNode(position);
    setNodesWithHistory((prev) => [...prev, node]);
    return node;
  }, [setNodesWithHistory]);

  const insertBatchPlacement = useCallback((placement: BatchPlacement) => {
    const current = getCurrentGraph();
    commitGraph({
      ...current,
      nodes: [...current.nodes, ...placement.newNodes],
      edges: [...current.edges, ...placement.newEdges],
    });
  }, [commitGraph, getCurrentGraph]);

  const removeNode = useCallback((nodeId: string) => {
    const current = getCurrentGraph();
    commitGraph({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    });
  }, [commitGraph, getCurrentGraph]);

  const removeNodes = useCallback((nodeIds: string[]) => {
    const removeSet = new Set(nodeIds);
    const current = getCurrentGraph();
    commitGraph({
      ...current,
      nodes: current.nodes.filter((node) => !removeSet.has(node.id)),
      edges: current.edges.filter(
        (edge) => !removeSet.has(edge.source) && !removeSet.has(edge.target),
      ),
    });
  }, [commitGraph, getCurrentGraph]);

  const duplicateNodes = useCallback(
    (nodeIds: string[]) => {
      const result = duplicateCanvasSelection(
        {
          nodes,
          edges,
          viewport,
          updatedAt: new Date().toISOString(),
        },
        nodeIds,
      );
      if (result.duplicatedNodeIds.length === 0) {
        return [];
      }
      commitGraph(result.graph);
      return result.duplicatedNodeIds;
    },
    [nodes, edges, viewport, commitGraph],
  );

  const arrangeNodes = useCallback(() => {
    const graph = arrangeCanvasGraph({
      nodes,
      edges,
      viewport,
      updatedAt: new Date().toISOString(),
    });
    commitGraph(graph);
  }, [nodes, edges, viewport, commitGraph]);

  const replaceGraph = useCallback((graph: CanvasGraph) => {
    commitGraph(graph);
  }, [commitGraph]);

  const loadStarterTemplate = useCallback(() => {
    const graph = createStarterCanvasGraph();
    commitGraph(graph);
    return graph;
  }, [commitGraph]);

  const resetAll = useCallback(() => {
    commitGraph({
      nodes: [],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
      updatedAt: new Date().toISOString(),
    });
    void clearCanvas();
  }, [commitGraph]);

  const undo = useCallback(() => {
    setHistoryCursor((currentCursor) => {
      if (currentCursor <= 0) return currentCursor;
      const nextCursor = currentCursor - 1;
      const snapshot = historyRef.current[nextCursor];
      if (snapshot) {
        applyGraph(cloneGraph(snapshot));
      }
      return nextCursor;
    });
  }, [applyGraph]);

  const redo = useCallback(() => {
    setHistoryCursor((currentCursor) => {
      if (currentCursor >= historyRef.current.length - 1) return currentCursor;
      const nextCursor = currentCursor + 1;
      const snapshot = historyRef.current[nextCursor];
      if (snapshot) {
        applyGraph(cloneGraph(snapshot));
      }
      return nextCursor;
    });
  }, [applyGraph]);

  return {
    nodes,
    edges,
    viewport,
    isLoaded,
    canUndo: historyCursor > 0,
    canRedo: historyCursor < historyRef.current.length - 1,
    setNodes: setNodesWithHistory,
    setEdges: setEdgesWithHistory,
    setViewport,
    updateImageNodeData,
    updateConfigNodeData,
    updatePromptNodeData,
    addImageNode,
    addConfigNode,
    addPromptNode,
    insertBatchPlacement,
    removeNode,
    removeNodes,
    duplicateNodes,
    arrangeNodes,
    replaceGraph,
    loadStarterTemplate,
    undo,
    redo,
    resetAll,
  };
}
