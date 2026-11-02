import matter from "gray-matter";

import { embed } from "./embed";
import { createAdminClient } from "./supabase/admin";

/**
 * Knowledge files are Markdown with a YAML front matter block (gray-matter) and
 * "### " level-3 sections. Front matter keys: title, source_document, source_pages,
 * department, session, status, time_sensitive, ingest.
 */

const MAX_SECTION_BODY = 1500;
const MAX_CHUNK_BODY = 1200;

export type KnowledgeMeta = {
  title: string;
  sourceDocument: string | null;
  sourcePages: string | null;
  department: string | null;
  session: string | null;
  status: string | null;
  timeSensitive: boolean | null;
  /** Absent means true; only an explicit `ingest: false` skips the file. */
  ingest: boolean;
};

export type KnowledgeSection = {
  heading: string;
  body: string;
  /** Value of this section's "Source pages:" line, null if missing. */
  sourcePages: string | null;
};

export type Chunk = {
  heading: string;
  /** Section body, or the part of it for oversized sections. */
  body: string;
  sourcePages: string | null;
  /** What gets embedded and stored as content: heading + "\n" + body. */
  text: string;
};

export type IngestResult = {
  skipped: boolean;
  documentId: string | null;
  chunkCount: number;
};

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function parseKnowledgeFile(raw: string, fileName: string): { meta: KnowledgeMeta; sections: KnowledgeSection[] } {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const title = asString(data.title);
  if (!title) {
    throw new Error(`${fileName}: front matter is missing a title`);
  }

  const meta: KnowledgeMeta = {
    title,
    sourceDocument: asString(data.source_document),
    sourcePages: asString(data.source_pages),
    department: asString(data.department),
    session: asString(data.session),
    status: asString(data.status),
    timeSensitive: asBoolean(data.time_sensitive),
    ingest: data.ingest !== false,
  };

  const sections: KnowledgeSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of parsed.content.split("\n")) {
    if (line.startsWith("### ")) {
      if (current) sections.push(finalizeSection(current));
      current = { heading: line.slice(4).trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
    // Lines before the first "### " heading are ignored (front matter / preamble).
  }
  if (current) sections.push(finalizeSection(current));

  if (sections.length === 0) {
    throw new Error(`${fileName}: no "### " sections found`);
  }
  return { meta, sections };
}

function finalizeSection(section: { heading: string; lines: string[] }): KnowledgeSection {
  const body = section.lines.join("\n").trim();
  const sourceLine = section.lines.find((line) => line.trim().startsWith("Source pages:"));
  const sourcePages = sourceLine ? sourceLine.trim().slice("Source pages:".length).trim() || null : null;
  return { heading: section.heading, body, sourcePages };
}

/**
 * Splits sections longer than MAX_SECTION_BODY at blank-line paragraph/bullet
 * boundaries into parts of at most ~MAX_CHUNK_BODY chars. Each part keeps the
 * heading; the "Keywords:" line stays attached to the part it belongs to.
 */
export function buildChunks(sections: KnowledgeSection[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const bodies =
      section.body.length > MAX_SECTION_BODY ? splitBody(section.body) : [section.body];
    for (const body of bodies) {
      chunks.push({
        heading: section.heading,
        body,
        sourcePages: section.sourcePages,
        text: `${section.heading}\n${body}`,
      });
    }
  }
  return chunks;
}

function splitBody(body: string): string[] {
  // Blocks are paragraph/bullet groups separated by blank lines.
  const blocks = body
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  const parts: string[] = [];
  let current = "";
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= MAX_CHUNK_BODY) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    current = "";
    if (block.length <= MAX_CHUNK_BODY) {
      current = block;
    } else {
      // A single oversized block (no blank lines inside): fall back to line packing.
      for (const line of block.split("\n")) {
        const lineCandidate = current ? `${current}\n${line}` : line;
        if (lineCandidate.length <= MAX_CHUNK_BODY) {
          current = lineCandidate;
        } else {
          if (current) parts.push(current);
          current = line;
        }
      }
    }
  }
  if (current) parts.push(current);
  return parts.length > 0 ? parts : [body];
}

/**
 * Parses a knowledge file and writes it to documents + document_chunks.
 * Idempotent per file: any existing documents row with the same document_name
 * (= front matter title) is deleted first, which cascades to its chunks.
 * On failure the documents row created by this run is removed so no orphan is left.
 */
export async function ingestKnowledgeFile(raw: string, fileName: string): Promise<IngestResult> {
  const { meta, sections } = parseKnowledgeFile(raw, fileName);
  if (!meta.ingest) {
    return { skipped: true, documentId: null, chunkCount: 0 };
  }

  const chunks = buildChunks(sections);
  const admin = createAdminClient();

  const { error: staleError } = await admin
    .from("documents")
    .delete()
    .eq("document_name", meta.title);
  if (staleError) {
    throw new Error(`${fileName}: could not delete a previous copy: ${staleError.message}`);
  }

  const { data: document, error: documentError } = await admin
    .from("documents")
    .insert({ document_name: meta.title, category: meta.department })
    .select("id")
    .single();
  if (documentError || !document) {
    throw new Error(`${fileName}: document insert failed: ${documentError?.message ?? "no row returned"}`);
  }
  const documentId = document.id;

  try {
    const vectors = await embed(chunks.map((chunk) => chunk.text));

    const rows = chunks.map((chunk, index) => {
      const vector = vectors[index];
      if (!vector || vector.length !== 384) {
        // Never send a null embedding.
        throw new Error(`${fileName}: missing embedding for chunk ${index}`);
      }
      return {
        document_id: documentId,
        content: chunk.text,
        // pgvector takes the '[...]' literal; the column is fixed at vector(384).
        embedding: JSON.stringify(vector),
        metadata: {
          document_name: meta.title,
          section_heading: chunk.heading,
          source_pages: chunk.sourcePages,
          source_document: meta.sourceDocument,
          department: meta.department,
          session: meta.session,
          status: meta.status,
          time_sensitive: meta.timeSensitive,
          file_name: fileName,
        },
      };
    });

    // Insert in batches of 50.
    for (let start = 0; start < rows.length; start += 50) {
      const { error: chunksError } = await admin
        .from("document_chunks")
        .insert(rows.slice(start, start + 50));
      if (chunksError) {
        throw new Error(`${fileName}: chunk insert failed: ${chunksError.message}`);
      }
    }
  } catch (error) {
    // Roll back the documents row created by this run; chunks cascade with it.
    await admin.from("documents").delete().eq("id", documentId);
    throw error;
  }

  return { skipped: false, documentId, chunkCount: chunks.length };
}
