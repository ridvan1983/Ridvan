import { atom } from 'nanostores';

export const organismProjectId = atom<string | null>(null);
export const organismAccessToken = atom<string | null>(null);

// Set once the preview iframe successfully loads.
export const organismPreviewReadyAt = atom<number | null>(null);

// Tracks whether we already showed the post-build Vertical card for this project.
export const organismVerticalCardShownForProject = atom<string | null>(null);

// One-shot queue: when set, ChatRunner should append this text as a new user message, then clear it.
export const organismBuilderAppendQueue = atom<string | null>(null);
