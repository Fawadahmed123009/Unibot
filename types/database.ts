// Row types mirroring supabase/schema.sql exactly (no extra columns).
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type User = {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  student_id: string | null;
  role: "student" | "admin";
  created_at: string | null;
};

export type Conversation = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sources: Json | null;
  created_at: string | null;
};

export type Document = {
  id: string;
  document_name: string;
  category: string | null;
  uploaded_at: string | null;
};

export type DocumentChunk = {
  id: number;
  document_id: string | null;
  content: string;
  embedding: string | null; // vector(384), serialized as "[...]"
  metadata: Json | null;
};

export type UnansweredQuestion = {
  id: string;
  user_id: string | null;
  question: string;
  created_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      users: {
        Row: User;
        // password_hash has no default in the DB, so it is always required on insert.
        Insert: Pick<User, "email" | "password_hash"> & Partial<User>;
        Update: Partial<User>;
        Relationships: [];
      };
      conversations: {
        Row: Conversation;
        Insert: Pick<Conversation, "user_id"> & Partial<Conversation>;
        Update: Partial<Conversation>;
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: Pick<Message, "conversation_id" | "role" | "content"> &
          Partial<Message>;
        Update: Partial<Message>;
        Relationships: [];
      };
      documents: {
        Row: Document;
        Insert: Pick<Document, "document_name"> & Partial<Document>;
        Update: Partial<Document>;
        Relationships: [];
      };
      document_chunks: {
        Row: DocumentChunk;
        Insert: Pick<DocumentChunk, "content"> & Partial<DocumentChunk>;
        Update: Partial<DocumentChunk>;
        Relationships: [];
      };
      unanswered_questions: {
        Row: UnansweredQuestion;
        Insert: Pick<UnansweredQuestion, "question"> &
          Partial<UnansweredQuestion>;
        Update: Partial<UnansweredQuestion>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_chunks: {
        Args: { query_embedding: string; match_count: number };
        // pgvector columns come back as "[...]" strings via supabase-js.
        // Returns one row per matched chunk (the SQL function returns a table).
        Returns: { id: number; content: string; metadata: Json | null; similarity: number }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
