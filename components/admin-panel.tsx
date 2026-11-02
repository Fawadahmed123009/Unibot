"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import SignOutButton from "@/components/sign-out-button";

type Doc = {
  id: string;
  document_name: string;
  category: string | null;
  uploaded_at: string | null;
};

type IngestResult = { ok: boolean; skipped?: boolean; chunkCount?: number; error?: string };

export default function AdminPanel() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // clearMessage defaults to true so a manual refresh never shows a stale
  // banner, but success paths pass false - otherwise the reload right after
  // set message would immediately wipe the "Ingested / Deleted" confirmation.
  const loadDocuments = useCallback(async (clearMessage = true) => {
    if (clearMessage) setMessage(null);
    const res = await fetch("/api/admin/documents", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setMessage({ kind: "error", text: data?.error ?? "Could not load documents." });
      return;
    }
    const data = await res.json();
    setDocuments(data.documents ?? []);
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file); // field name "file" matches /api/admin/ingest
      const res = await fetch("/api/admin/ingest", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as IngestResult;
      if (!res.ok || data.error) {
        setMessage({ kind: "error", text: data.error ?? "Upload failed." });
      } else if (data.skipped) {
        setMessage({ kind: "ok", text: "File marked ingest:false — skipped (not added)." });
      } else {
        setMessage({ kind: "ok", text: `Ingested ${data.chunkCount ?? 0} chunk(s).` });
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        await loadDocuments(false);
      }
    } catch {
      setMessage({ kind: "error", text: "Network error during upload." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: Doc) {
    if (!confirm(`Delete "${doc.document_name}" and all its chunks?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ingest", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMessage({ kind: "error", text: data?.error ?? "Delete failed." });
      } else {
        setMessage({ kind: "ok", text: `Deleted "${doc.document_name}".` });
        await loadDocuments(false);
      }
    } catch {
      setMessage({ kind: "error", text: "Network error during delete." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Admin — Knowledge Documents</h1>
          <p className="text-sm text-slate-500">
            Upload a .md / .txt file to add it to the knowledge base. Re-uploading updates it;
            deleting removes it and its chunks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/chat" className="btn-ghost shrink-0">
            Back to chat
          </a>
          <SignOutButton />
        </div>
      </header>

      {/* Upload */}
      <section className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="file" className="mb-1 block text-sm font-medium text-slate-700">
              Knowledge file
            </label>
            <input
              id="file"
              ref={inputRef}
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="input file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm"
            />
          </div>
          <button
            type="button"
            onClick={upload}
            className="btn-primary shrink-0 sm:w-auto"
            disabled={busy || !file}
            title={file ? undefined : "Choose a .md or .txt file first"}
          >
            {busy ? "Ingesting…" : "Upload & ingest"}
          </button>
        </div>

        {message && (
          <p className={`mt-3 text-sm ${message.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </section>

      {/* Document list */}
      <section className="mt-6 flex-1">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Documents ({documents.length})
        </h2>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800" title={doc.document_name}>
                  {doc.document_name}
                </p>
                <p className="text-xs text-slate-500">
                  {doc.category ?? "uncategorized"}
                  {doc.uploaded_at ? ` · ${new Date(doc.uploaded_at).toLocaleString()}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(doc)}
                disabled={busy}
                className="btn-ghost shrink-0 border-red-200 text-red-600 hover:border-red-400 hover:text-red-700"
              >
                Delete
              </button>
            </li>
          ))}
          {documents.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">No documents yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}
