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
    return { ...node, data: sanitizeImageData(node.data) };
  }
  if (isConfigNode(node)) {
    return { ...node, data: sanitizeConfigData(node.data) };
  }
  if (isPromptNode(node)) {
    // Prompt nodes have no remote state — store as-is.
    return node;
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
 * Build a placement (without mutating the store) for a Config-node fan-out of
 * `count` image results to the right of the source. Layout: root sits adjacent
 * to source, children sit further right in a 2-column grid.
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
  const dirtyRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCanvas().then((graph) => {
      if (cancelled) return;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setViewport(graph.viewport);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId && isImageNode(node)
            ? ({ ...node, data: updater(node.data) } as CanvasImageNode)
            : node,
        ),
      );
    },
    [],
  );

  const updateConfigNodeData = useCallback(
    (nodeId: string, updater: (data: CanvasConfigNodeData) => CanvasConfigNodeData) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId && isConfigNode(node)
            ? ({ ...node, data: updater(node.data) } as CanvasConfigNode)
            : node,
        ),
      );
    },
    [],
  );

  const updatePromptNodeData = useCallback(
    (nodeId: string, updater: (data: CanvasPromptNodeData) => CanvasPromptNodeData) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId && isPromptNode(node)
            ? ({ ...node, data: updater(node.data) } as CanvasPromptNode)
            : node,
        ),
      );
    },
    [],
  );

  const addImageNode = useCallback((position: { x: number; y: number }) => {
    const node = createImageNode(position);
    setNodes((prev) => [...prev, node]);
    return node;
  }, []);

  const addConfigNode = useCallback((position: { x: number; y: number }) => {
    const node = createConfigNode(position);
    setNodes((prev) => [...prev, node]);
    return node;
  }, []);

  const addPromptNode = useCallback((position: { x: number; y: number }) => {
    const node = createPromptNode(position);
    setNodes((prev) => [...prev, node]);
    return node;
  }, []);

  const insertBatchPlacement = useCallback((placement: BatchPlacement) => {
    setNodes((prev) => [...prev, ...placement.newNodes]);
    setEdges((prev) => [...prev, ...placement.newEdges]);
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== nodeId));
    setEdges((prev) => prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  }, []);

  const removeNodes = useCallback((nodeIds: string[]) => {
    const removeSet = new Set(nodeIds);
    setNodes((prev) => prev.filter((node) => !removeSet.has(node.id)));
    setEdges((prev) =>
      prev.filter((edge) => !removeSet.has(edge.source) && !removeSet.has(edge.target)),
    );
  }, []);

  const resetAll = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setViewport(DEFAULT_VIEWPORT);
    void clearCanvas();
  }, []);

  return {
    nodes,
    edges,
    viewport,
    isLoaded,
    setNodes,
    setEdges,
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
    resetAll,
  };
}
