"use client";

import localforage from "localforage";
import { useEffect, useMemo, useState } from "react";

import seedJson from "@/data/prompts/seed.json";
import type { Prompt, PromptCategory } from "@/types/prompt";

type SeedFile = {
  version: number;
  categories: PromptCategory[];
  prompts: Prompt[];
};

const seed = seedJson as SeedFile;

const promptStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "prompts_library",
});

const CUSTOM_PROMPTS_KEY = "custom_prompts";
const FAVORITES_KEY = "favorite_ids";
const SEED_VERSION_KEY = "seed_version";

let writeQueue: Promise<void> = Promise.resolve();

function queueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readCustomPrompts(): Promise<Prompt[]> {
  const items = (await promptStorage.getItem<Prompt[]>(CUSTOM_PROMPTS_KEY)) || [];
  return items.filter((item) => item && typeof item.id === "string");
}

async function readFavorites(): Promise<string[]> {
  const items = (await promptStorage.getItem<string[]>(FAVORITES_KEY)) || [];
  return items.filter((id) => typeof id === "string");
}

export async function listCustomPrompts(): Promise<Prompt[]> {
  return readCustomPrompts();
}

export async function saveCustomPrompt(prompt: Prompt): Promise<void> {
  await queueWrite(async () => {
    const items = await readCustomPrompts();
    const next = [{ ...prompt, custom: true }, ...items.filter((item) => item.id !== prompt.id)];
    await promptStorage.setItem(CUSTOM_PROMPTS_KEY, next);
  });
}

export async function deleteCustomPrompt(id: string): Promise<void> {
  await queueWrite(async () => {
    const items = await readCustomPrompts();
    await promptStorage.setItem(
      CUSTOM_PROMPTS_KEY,
      items.filter((item) => item.id !== id),
    );
  });
}

export async function listFavoriteIds(): Promise<string[]> {
  return readFavorites();
}

export async function toggleFavorite(id: string): Promise<string[]> {
  return queueWrite(async () => {
    const items = await readFavorites();
    const has = items.includes(id);
    const next = has ? items.filter((value) => value !== id) : [id, ...items];
    await promptStorage.setItem(FAVORITES_KEY, next);
    return next;
  });
}

export async function getSeedVersion(): Promise<number> {
  const value = await promptStorage.getItem<number>(SEED_VERSION_KEY);
  return typeof value === "number" ? value : 0;
}

export async function setSeedVersion(version: number): Promise<void> {
  await promptStorage.setItem(SEED_VERSION_KEY, version);
}

export function getSeedPrompts(): Prompt[] {
  return seed.prompts;
}

export function getSeedCategories(): PromptCategory[] {
  return seed.categories;
}

export function getSeedVersionStatic(): number {
  return seed.version;
}

export type PromptStoreState = {
  prompts: Prompt[];
  favorites: string[];
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
};

export type PromptStoreActions = {
  reload: () => Promise<void>;
  toggleFavoriteAction: (id: string) => Promise<void>;
  addCustom: (prompt: Omit<Prompt, "id" | "createdAt" | "updatedAt" | "custom">) => Promise<Prompt>;
  removeCustom: (id: string) => Promise<void>;
};

function createPromptId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `user-${crypto.randomUUID()}`;
  }
  return `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * React hook providing the merged prompt list (seed + custom) and favorite state.
 * Seed data is bundled at build time; only user-authored custom prompts and
 * favorite ids are persisted via localforage.
 */
export function usePromptStore(): PromptStoreState & PromptStoreActions {
  const [customPrompts, setCustomPrompts] = useState<Prompt[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useMemo(
    () => async () => {
      setIsLoading(true);
      try {
        const [customs, favs, seedVersion] = await Promise.all([
          readCustomPrompts(),
          readFavorites(),
          getSeedVersion(),
        ]);
        if (seedVersion !== seed.version) {
          await setSeedVersion(seed.version);
        }
        setCustomPrompts(customs);
        setFavorites(favs);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "加载提示词库失败");
      } finally {
        setIsInitialized(true);
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleFavoriteAction = useMemo(
    () => async (id: string) => {
      const next = await toggleFavorite(id);
      setFavorites(next);
    },
    [],
  );

  const addCustom = useMemo(
    () =>
      async (input: Omit<Prompt, "id" | "createdAt" | "updatedAt" | "custom">) => {
        const now = new Date().toISOString();
        const created: Prompt = {
          ...input,
          id: createPromptId(),
          createdAt: now,
          updatedAt: now,
          custom: true,
        };
        await saveCustomPrompt(created);
        setCustomPrompts((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        return created;
      },
    [],
  );

  const removeCustom = useMemo(
    () => async (id: string) => {
      await deleteCustomPrompt(id);
      setCustomPrompts((prev) => prev.filter((item) => item.id !== id));
    },
    [],
  );

  const prompts = useMemo(() => [...customPrompts, ...seed.prompts], [customPrompts]);

  return {
    prompts,
    favorites,
    isInitialized,
    isLoading,
    error,
    reload,
    toggleFavoriteAction,
    addCustom,
    removeCustom,
  };
}
