export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type PermissionLevelRow = { id: string; name: string; rank: number };
type PermissionGroupRow = {
  id: string;
  name: string;
  permission_level_id: string;
  can_manage_qa: boolean;
};
type AdministratorAccountRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
type AppUserRow = {
  id: string;
  email: string;
  display_name: string;
  permission_group_id: string;
  created_at: string;
};
type QaRow = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[];
  content_revision: number;
  embedding: string | null;
  embedding_profile: string | null;
  embedding_revision: number | null;
  embedding_status: "pending" | "ready" | "failed";
  required_permission_level_id: string;
  status: "active" | "excluded" | "deleted";
  updated_by: string;
  created_at: string;
  updated_at: string;
};
type ChatLogRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  sequence_number: number;
  role: "user" | "assistant";
  content: string;
  citations: Json | null;
  created_at: string;
};

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Array<{
    foreignKeyName: string;
    columns: string[];
    isOneToOne: boolean;
    referencedRelation: string;
    referencedColumns: string[];
  }>;
};

export type Database = {
  public: {
    Tables: {
      administrator_accounts: Table<
        AdministratorAccountRow,
        {
          id?: string;
          email: string;
          display_name?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      permission_level: Table<PermissionLevelRow, { id?: string; name: string; rank: number }>;
      permission_group: Table<
        PermissionGroupRow,
        {
          id?: string;
          name: string;
          permission_level_id: string;
          can_manage_qa?: boolean;
        }
      >;
      app_user: Table<
        AppUserRow,
        {
          id?: string;
          email: string;
          display_name: string;
          permission_group_id: string;
          created_at?: string;
        }
      >;
      qa: Table<
        QaRow,
        {
          id?: string;
          question: string;
          answer: string;
          category?: string | null;
          tags?: string[];
          content_revision?: number;
          embedding?: string | null;
          embedding_profile?: string | null;
          embedding_revision?: number | null;
          embedding_status?: "pending" | "ready" | "failed";
          required_permission_level_id: string;
          status?: "active" | "excluded" | "deleted";
          updated_by: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      chat_log: Table<
        ChatLogRow,
        {
          id?: string;
          user_id: string;
          conversation_id: string;
          sequence_number: number;
          role: "user" | "assistant";
          content: string;
          citations?: Json | null;
          created_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      import_qa_csv: {
        Args: { p_rows: Json; p_replace: boolean; p_updated_by: string; p_user_rank: number };
        Returns: QaRow[];
      };
      update_qa_content: {
        Args: {
          p_qa_id: string;
          p_expected_revision: number;
          p_question: string;
          p_answer: string;
          p_category: string;
          p_tags: string[];
          p_updated_by: string;
        };
        Returns: QaRow;
      };
      complete_qa_embedding: {
        Args: { p_qa_id: string; p_revision: number; p_profile: string; p_embedding: number[] };
        Returns: boolean;
      };
      fail_qa_embedding: {
        Args: { p_qa_id: string; p_revision: number };
        Returns: boolean;
      };
      prepare_qa_embedding_retry: {
        Args: { p_qa_id: string; p_updated_by: string };
        Returns: QaRow | null;
      };
      match_qa: {
        Args: {
          p_query_embedding: number[];
          p_user_rank: number;
          p_profile: string;
          p_match_threshold: number;
          p_match_count: number;
        };
        Returns: Array<{
          id: string;
          question: string;
          answer: string;
          category: string | null;
          tags: string[];
          content_revision: number;
          required_rank: number;
          similarity: number;
        }>;
      };
      append_chat_message: {
        Args: {
          p_user_id: string;
          p_conversation_id: string;
          p_role: string;
          p_content: string;
          p_citations?: Json | null;
        };
        Returns: ChatLogRow;
      };
      list_chat_conversations: {
        Args: { p_user_id: string; p_limit?: number };
        Returns: Array<{
          conversation_id: string;
          title: string;
          message_count: number;
          created_at: string;
          updated_at: string;
        }>;
      };
      delete_chat_conversation: {
        Args: { p_user_id: string; p_conversation_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
