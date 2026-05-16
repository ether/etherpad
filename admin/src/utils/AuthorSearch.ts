export type AuthorSortBy = 'name' | 'lastSeen';

export type AuthorSearchQuery = {
  pattern: string;
  offset: number;
  limit: number;
  sortBy: AuthorSortBy;
  ascending: boolean;
  includeErased: boolean;
};

export type AuthorRow = {
  authorID: string;
  name: string | null;
  colorId: string | number | null;
  mapper: string[];
  lastSeen: number | null;
  erased: boolean;
};

export type AuthorSearchResult = {
  total: number;
  cappedAt?: number;
  results: AuthorRow[];
  error?: string;
};

export type AnonymizePreview = {
  authorID: string;
  name: string | null;
  affectedPads: number;
  removedTokenMappings: number;
  removedExternalMappings: number;
  clearedChatMessages: number;
  error?: string;
};

export type AnonymizeResult = {
  authorID: string;
  affectedPads?: number;
  removedTokenMappings?: number;
  removedExternalMappings?: number;
  clearedChatMessages?: number;
  error?: string;
};
