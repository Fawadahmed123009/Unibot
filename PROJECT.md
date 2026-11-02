# UET Department Assistant — Project Memory

AI chatbot for the Computer Engineering Department, UET Lahore. Students ask about admissions, fees,
courses, attendance, exam rules and faculty. The bot answers **only** from verified department
documents (RAG). Scope is deliberately small: everything must work end to end.

## Stack (fixed — do not change)

| Concern        | Choice                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| Framework      | Next.js 14+ (App Router), TypeScript, Tailwind CSS                       |
| Backend        | Next.js API routes in the same app (no separate Python server)           |
| Data           | Supabase Postgres, pgvector, RLS                                         |
| Auth           | Own auth: email + bcrypt password, httpOnly JWT session cookie (`jose`) |
| Supabase SDK   | `@supabase/supabase-js` **pinned 2.109.0** (service-role client, server only). v2 eagerly builds a Realtime client needing a global WebSocket, so `lib/supabase/admin.ts` polyfills it from `ws` for Node 20 |
| LLM            | Groq API (chat completions via fetch, streamed in `lib/groq.ts`)         |
| Embeddings     | In-process **transformers.js** `Xenova/all-MiniLM-L6-v2` (384 dims, mean-pooled + L2-normalized) — free, no daemon, no API key. `lib/embed.ts` calls the `feature-extraction` pipeline; weights auto-download to a local cache on first use. Replaces the Supabase `embed` Edge Function (gte-small). On serverless the weights re-download per cold start (slow), so a persistent host is better for production embeddings. |
| Front matter   | `gray-matter` (knowledge file parsing in `lib/ingest.ts`)                |
| Dev scripts    | `tsx` (run `scripts/*.ts`), `dotenv` (load `.env.local`)                  |
| Deployment     | Vercel                                                                   |

## Environment variables (exactly these names)

| Variable                        | Where used                       |
| ------------------------------- | -------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | server (service-role client)     |
| `SUPABASE_SERVICE_ROLE_KEY`     | **server only** (API routes, server utilities) |
| `JWT_SECRET`                    | **server only** (sign/verify session cookie; >= 32 random chars) |
| `GROQ_API_KEY`                  | server only (`lib/groq.ts`, scripts) |

`.env.example` lists these four. No other env var names are allowed. (Embeddings need no env var — transformers.js runs in-process.)

## Auth model

- `supabase/users` table holds `password_hash` (bcrypt). Supabase Auth is **not** used;
  there is no `profiles` table and no anon key.
- Login/register API routes verify the password and set an httpOnly `session` cookie
  containing an HS256 JWT (`sub` = user id, `email`, `role`, 7-day expiry) signed with
  `JWT_SECRET`. `lib/auth.ts` is the only place the JWT is touched and must stay
  Edge-safe (jose only — no bcrypt, no DB), because `middleware.ts` imports it.
- `middleware.ts` only verifies the cookie for redirects (`/chat`, `/admin` require a
  session; `/login` with a session goes to `/chat`). It is not an authorization boundary:
  pages and API routes call `getSession()` themselves, and anything role-sensitive
  (admin) re-checks `users.role` in the DB, because the JWT role can be stale.
- API routes read/write through the service-role client (`lib/supabase/admin.ts`);
  RLS is enabled with **no policies**, so nothing is readable without it, and routes
  filter by `session.userId` for user-scoped access.
- Logout = clear the cookie (JWTs are stateless, no server-side revocation yet).

## Folder structure

```
app/
  page.tsx                  # / -> redirects to /chat
  login/page.tsx            # Login / Create account toggle (email + password)
  chat/page.tsx             # server guard (getSession) -> renders ChatApp
  admin/page.tsx            # server guard (getSession + DB role re-check) -> renders AdminPanel
  api/auth/
    login/route.ts          # bcrypt verify -> set session cookie (rate-limited)
    register/route.ts       # create user (role always 'student') -> set cookie
    me/route.ts             # return session email/role
    logout/route.ts         # clear session cookie
  api/chat/route.ts         # POST { conversationId?, message } -> application/x-ndjson stream (start/delta/done/error)
  api/conversations/
    route.ts                # GET list (own conversations, newest first) + DELETE { conversationId } (id AND user_id filter)
    [id]/route.ts           # GET one owned conversation + its messages (oldest first) for history
  api/admin/documents/route.ts  # GET list all documents (requireAdmin + DB role re-check)
  layout.tsx                # html shell + metadata
  globals.css               # Tailwind layers + shared .card/.input/.btn-* classes
components/
  admin-panel.tsx           # client admin UI: upload .md/.txt via /api/admin/ingest, list + delete documents
  chat-app.tsx              # client chat UI: conversation sidebar (new/select/delete) + ndjson streaming + source citations
  sign-out-button.tsx       # client button, POSTs to /api/auth/logout
lib/
  auth.ts                   # JWT sign/verify, cookie helpers, getSession/requireUser/requireAdmin
  rate-limit.ts             # in-memory fixed-window limiter (per IP; optional limit/window args, auth defaults unchanged)
  config.ts                 # RAG tunables: SIMILARITY_THRESHOLD (0.45, tuned for all-MiniLM), TOP_K, HISTORY_MESSAGES, MAX_MESSAGE_CHARS, GROQ models (gpt-oss), REFUSAL
  groq.ts                   # streamGroq(): fetch-based SSE streaming from Groq, one fallback-model retry on 429/5xx before first token
  rag.ts                    # pure: retrieve / buildContext / buildMessages / extractCitations / isRefusal + SYSTEM_PROMPT (no next/headers; scripts use it)
  embed.ts                  # embed(texts) -> number[][] via in-process transformers.js all-MiniLM-L6-v2 (singleton pipeline, batches of 10, 2 retries, 384-dim check; NOT server-only: scripts use it)
  ingest.ts                 # parseKnowledgeFile (gray-matter + "### " sections) / buildChunks / ingestKnowledgeFile (idempotent upsert, chunk batches of 50, rollback)
  supabase/admin.ts         # service-role client, server only; polyfills globalThis.WebSocket from `ws` (Node 20 has none) before createClient
scripts/
  ingest.ts                 # npx tsx scripts/ingest.ts — ingest every knowledge/*.md, per-file results + totals
  search.ts                 # npx tsx scripts/search.ts "question" — embed + match_chunks(5), prints similarity/heading/snippet
  ask.ts                    # npx tsx scripts/ask.ts "question" — retrieve + streamGroq end to end (no auth/DB writes); for threshold tuning and test questions
  test-auth-plan.sh
  test-admin-role.sh
knowledge/                  # department Markdown docs with YAML front matter (title, source_document, source_pages, department, session, status, time_sensitive, ingest)
types/database.ts           # row types matching supabase/schema.sql
middleware.ts               # jose-only: session cookie check + auth redirects
supabase/schema.sql         # full schema, run manually in the SQL editor
.env.example
```

## Rules

1. **Service role key is server-only.** `lib/supabase/admin.ts` is imported exclusively from API
   routes and server utilities, never from client components or anything shipped to the browser.
2. **Never return `password_hash`** from any query that feeds a response; select only needed columns.
3. **Embedding dimension is always 384** (`vector(384)`, all-MiniLM-L6-v2). Never change it, never
   introduce another vector column size.
4. **No guessing.** If retrieved context is insufficient, the chatbot replies exactly:
   "I don't have verified information on this." Refusals are always this exact English sentence
   regardless of the question's language; non-refusal answers mirror the student's language
   (English / Roman Urdu / Urdu), and retrieval translates the query to English before embedding
   (all-MiniLM is English-centric). `isRefusal()` keys off this verbatim sentence.
5. Keep code small, fully typed, commented only where non-obvious. No extra features, tables,
   columns or env vars beyond what is specified.

## Current status

- Done: `PROJECT.md`, `supabase/schema.sql`, app scaffold (Next 14.2, TS, Tailwind, ESLint),
  password auth (`lib/auth.ts`, `lib/rate-limit.ts`, `/api/auth/*`), jose-only middleware,
  `/login` (login/register toggle), `/chat` and `/admin` placeholders, service-role client,
  `types/database.ts` matching the schema.
- Task 4 (ingest pipeline): `lib/embed.ts`, `lib/ingest.ts`, `scripts/ingest.ts`,
  `scripts/search.ts` done and type-checked; `/api/admin/ingest` was rewritten to a multipart
  upload of one `.md`/`.txt` file calling `ingestKnowledgeFile` (DELETE `{ documentId }`
  unchanged, `maxDuration = 60`).
- Task 5 (RAG pipeline + chat API): `lib/config.ts`, `lib/groq.ts`, `lib/rag.ts`,
  `app/api/chat/route.ts` (ndjson streaming, per-user rate limit 20/min, conversation
  ownership checks, unanswered_questions logging, dev topSimilarity logs) and
  `scripts/ask.ts` done; `lib/rate-limit.ts` gained optional limit/window args with auth
  defaults unchanged.
- Chat UI + conversations (this task): `app/api/conversations/route.ts` (list/delete),
  `app/api/conversations/[id]/route.ts` (messages), `components/chat-app.tsx` (client UI: sidebar,
  new/select/delete, reads the `/api/chat` ndjson stream live, renders citations) and
  `app/chat/page.tsx` (now renders ChatApp). Type-checked; not yet exercised in a browser.
- Admin upload UI (this task): `app/api/admin/documents/route.ts` (list, requireAdmin + DB
  role re-check), `components/admin-panel.tsx` (upload .md/.txt via `POST /api/admin/ingest`
  multipart field `file`; list + delete via `DELETE /api/admin/ingest` `{ documentId }`) and
  `app/admin/page.tsx` (now renders AdminPanel after the server-side role check). Type-checked;
  not yet exercised in a browser.
- Embeddings now run fully **in-process** with transformers.js (`Xenova/all-MiniLM-L6-v2`,
  384 dims), replacing the Supabase `embed` Edge Function (gte-small) and the short-lived
  Ollama option. Same dimension, so `vector(384)` and `match_chunks` are unchanged.
  Added dep `@xenova/transformers` (install with `--legacy-peer-deps`).
- Knowledge **re-ingested** with the new model: `05_...NOT_CE.md` still skipped (`ingest: false`)
  to keep the CE-only scope isolated. Corpus now **6 ingested docs / 141 chunks** (was 4 docs /
  123 chunks; docs `06_ce_programs_contacts_eligibility.md` +6 and
  `07_uet_fees_hostel_and_regulations.md` +12 added for coverage - see the KB bullet below).
- `SIMILARITY_THRESHOLD` re-tuned 0.80 -> **0.45** for the all-MiniLM scale (verified via
  `scripts/search.ts`: irrelevant queries ~0.10-0.20, clearly-relevant ~0.67-0.69).
- Groq retired `llama-3.3-70b-versatile` / `llama-3.1-8b-instant` (both 404 on this key);
  `lib/config.ts` now uses `openai/gpt-oss-20b` (primary) / `openai/gpt-oss-120b` (fallback).
- **Multilingual (this task)**: students may ask in English, Roman Urdu or Urdu script.
  `lib/rag.ts:toEnglishForRetrieval` (via new non-streaming `completeGroq` in `lib/groq.ts`)
  translates each query to English before `retrieve()` embeds it, so the English-centric
  all-MiniLM still matches well; `app/api/chat/route.ts` keeps the ORIGINAL message for the
  answer, storage and `unanswered_questions`. `SYSTEM_PROMPT` rule 11 now answers in the
  question's language with `[n]` markers preserved, except the verbatim English refusal (rule 4).
  Best-effort: on any translation failure the raw text is embedded (English path unaffected).
  Costs one extra fast Groq call per answer-path message (~200-400ms). No new env vars/deps/tables.
  GOTCHA: `completeGroq` translation MUST use a large `max_tokens` (512). gpt-oss is a reasoning
  model that spends the budget on hidden reasoning first, so the original plan's 64 truncated the
  visible answer (an English query came back as "What is the" -> retrieval collapsed to ~0.22).
  Verified: English passes through unchanged (no regression), Urdu script translates + answers in
  Urdu, off-topic still gets the verbatim English refusal. LIMITATION: Roman-Urdu *answer* language
  is best-effort on gpt-oss-20b (it sometimes answers Latin-script Roman Urdu in English); Urdu-
  script and English are reliable, and grounding/citations/refusal hold in all cases.
- **Node 20 fix**: pinned `@supabase/supabase-js` to 2.109.0 and `lib/supabase/admin.ts`
  polyfills `globalThis.WebSocket` from `ws` (v2 builds a Realtime client needing WebSocket,
  which Node 20 lacks; native from Node 22). Added deps: `ws`, `@types/ws`.
- **End-to-end browser verification (dev server on :3001)**: full student flow (register ->
  chat streaming + citations -> follow-up context -> history reload -> delete -> sign out ->
  guarded `/chat` & `/admin` redirects) and admin flow (login -> upload .md -> retrieval proves
  the new doc -> delete -> retrieval proves removal -> student blocked from `/admin`) all pass,
  zero console errors, zero non-2xx app calls. Fixes made from that pass: admin success banner
  was being wiped by `loadDocuments()` (now `loadDocuments(false)` keeps it); assistant answers
  render Markdown `**bold**` / `- bullets` instead of literal asterisks (`AnswerText` in
  `chat-app.tsx`); citation no longer repeats the session when the heading already contains it
  and says "status: pending confirmation" instead of "unverified"; a "Loading conversation…"
  state clears stale messages on switch; chat header shows the signed-in email and an Admin link
  (role from session, still re-checked in DB); `/admin` for a non-admin is now an explicit
  "Access denied" screen instead of a silent redirect; a malformed register body returns
  "Invalid request body" rather than "Invalid email address".
- **Open (not a bug)**: generic phrasing like "What courses are offered in the department?"
  embeds to ~0.42, just under `SIMILARITY_THRESHOLD` 0.45, so it refuses even though relevant
  chunks exist (well-phrased queries hit 0.52-0.61). Lowering the threshold would admit weaker
  matches for off-topic queries too — a data-driven tuning decision, left at 0.45.
- **RTL / Urdu rendering (this task)**: `AnswerText` and the user bubble in `chat-app.tsx` set
  each block's `dir` via `dirFor()` = `"rtl"` when the text contains any Urdu/Arabic-script glyph
  (`\u0600-\u06FF` etc.), else `"auto"`. This is deliberate over plain `dir="auto"`, which resolves
  direction from the FIRST strong char and so left-aligned Urdu answers that open with a Latin
  token ("A1 ...", "75% ..."). `ps-5` keeps bullet padding on the correct side. Verified in-browser:
  Urdu-containing blocks compute `direction: rtl` regardless of leading token; English stays LTR.
- **Empty-completion guard (this task)**: `app/api/chat/route.ts` now yields an `error` event and
  persists nothing when Groq returns 200 with zero content tokens, instead of storing a blank
  assistant row that showed as an empty bubble with no feedback.
- **KB quality assessment (this task)**: measured retrieval over a realistic query battery. The
  4 ingested CE docs are already high quality (verified facts, embedded `Keywords:` lines, source
  pages, "pending confirmation" caveats). Off-topic noise caps at ~0.31 while relevant queries hit
  0.45-0.74, confirming 0.45 is the right threshold. Out-of-scope-but-university-adjacent queries
  ("electrical engineering timetable" 0.51, "IT department faculty" 0.59) already score IN the
  relevant band, so lowering the cutoff would leak other departments into CE answers - scope
  isolation is enforced by the LLM grounding rule, not the threshold. The real gap was COVERAGE,
  not quality: no fee amounts, timetable, grading policy, exam rules or contact numbers existed in
  the corpus, so those questions correctly refused.
- **KB coverage filled (this task)**: added two ingested docs from **department-provided verified
  data** (user-supplied, not invented). `knowledge/06_ce_programs_contacts_eligibility.md` (6
  sections: degree programs, chairperson, admissions office contact+timings, registrar/controller
  of exams, program location/merit, minimum eligibility 60%+ECAT) and
  `knowledge/07_uet_fees_hostel_and_regulations.md` (12 sections: fee categories, per-semester fee
  breakup table, total program fee 8/10-sem, hostel charges, credit-hour limits, timetable
  availability, 75% attendance + WF, grading rules, result timeline, exam rules, exam/summer fees,
  Fall 2026 application fee + ECAT dates). Both follow the front-matter/`### section`/`Keywords:`
  convention; time-sensitive facts carry `status` + `> Source note` caveats (e.g. the Fall 2026
  dates are marked "not current"). Re-ingested (+18 chunks, corpus now 141). Verified every
  previously-refusing topic now retrieves 0.50-0.70 and answers end to end in English and Roman
  Urdu with citations to the new docs. Threshold kept at 0.45.
