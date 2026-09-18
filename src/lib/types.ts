import type { EmbeddingStatus, QaStatus } from "./constants";

export interface CurrentUser {
  id: string;
  displayName: string;
  permissionGroupId: string;
  permissionGroupName: string;
  permissionRank: number;
  canManageQa: boolean;
  canManageUsers: boolean;
}

export interface QaRecord {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[];
  content_revision: number;
  embedding_status: EmbeddingStatus;
  required_permission_level_id: string;
  status: QaStatus;
  updated_by: string;
  created_at: string;
  updated_at: string;
  updater?: { display_name: string } | null;
}

export interface RagQa {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[];
  content_revision: number;
  required_rank: number;
  similarity: number;
}

export interface Citation {
  qaId: string;
  revision: number;
  question: string;
  answer: string;
  markers: string[];
}

export interface StoredCitations {
  dependencies: Citation[];
}
