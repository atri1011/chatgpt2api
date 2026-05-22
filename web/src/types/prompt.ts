/**
 * Prompt schema for the local prompt library.
 *
 * Derived from infinite-canvas (https://github.com/basketikun/infinite-canvas,
 * AGPL-3.0). The original schema lives at model/prompt.go and is exposed via
 * a Go backend; here we maintain the same shape but store data locally.
 */

export type Prompt = {
  id: string;
  title: string;
  coverUrl?: string;
  prompt: string;
  tags: string[];
  category: string;
  githubUrl?: string;
  preview?: string;
  createdAt: string;
  updatedAt: string;
  /** Marks prompts added by the user via the UI, kept separate from seed data. */
  custom?: boolean;
};

export type PromptCategory = {
  category: string;
  name: string;
  description?: string;
};

export type PromptFilter = {
  query: string;
  category: string;
  tags: string[];
  onlyFavorites: boolean;
};

export const ALL_PROMPTS_CATEGORY = "全部";
