"use client";

import localforage from "localforage";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_VIEWPORT,
  EMPTY_GRAPH,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasImageNode,
  type CanvasImageNodeData,
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

function sanitizeNodeForPersist(node: CanvasImageNode): CanvasImageNode {
  // Strip transient b64 data to avoid IndexedDB bloat. URLs survive.
  const { b64_json, ...rest } = node.data;
  return {
    ...node,
    data: {
      ...rest,
      // Persist a stable status: if generation was mid-flight, mark as error
      // so the user explicitly retries rather than seeing a stuck spinner.
      status:
        node.data.status === "running" || node.data.status === "queued"
          ? "error"
          : node.data.status,
      error:
        node.data.status === "running" || node.data.status === "queued"
          ? "页面刷新中断，请重新运行"
          : node.data.error,
    },
  };
}

async function readGraph(): Promise<CanvasGraph> {
  const raw = await canvasStorage.getItem<CanvasGraph>(GRAPH_KEY);
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    return EMPTY_GRAPH;
  }
  return {
    nodes: raw.nodes,
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

function createNodeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `node-${crypto.randomUUID()}`;
  }
  return `node-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createEdgeId(source: string, target: string) {
  return `edge-${source}-${target}`;
}

/**
 * Build a fresh image node centred on the viewport-aware drop point.
 */
export function createImageNode(position: { x: number; y: number }): CanvasImageNode {
  return {
    id: createNodeId(),
    type: "image",
    position,
    width: 300,
    height: 360,
    data: {
      prompt: "",
      status: "idle",
      title: "新节点",
    },
  };
}

/**
 * Convenience: clone graph with edge change applied.
 */
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
    edges: [
      ...graph.edges,
      {
        id,
        source,
        target,
        animated: false,
        style: { strokeWidth: 1.5 },
      },
    ],
  };
}

/**
 * React hook exposing canvas state + actions with debounced auto-persist.
 *
 * The hook owns the in-memory graph; React Flow's `applyNodeChanges` /
 * `applyEdgeChanges` callers wire into `setNodes` / `setEdges`. Persistence
 * runs on a 300ms debounce after any mutation.
 */
export function useCanvasStore() {
  const [nodes, setNodes] = useState<CanvasImageNode[]>([]);
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

  // Flush pending writes on unmount.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        void saveCanvas({ nodes, edges, viewport, updatedAt: new Date().toISOString() });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateNodeData = useCallback(
    (nodeId: string, updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => {
      setNodes((prev) =>
        prev.map((node) => (node.id === nodeId ? { ...node, data: updater(node.data) } : node)),
      );
    },
    [],
  );

  const addNode = useCallback((position: { x: number; y: number }) => {
    const node = createImageNode(position);
    setNodes((prev) => [...prev, node]);
    return node;
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
    updateNodeData,
    addNode,
    removeNode,
    removeNodes,
    resetAll,
  };
}
