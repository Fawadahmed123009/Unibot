# UET Department Assistant (unibot)

A chatbot for the Computer Engineering Department, UET Lahore. Students create an
account, ask questions about admissions, fees, courses, exams and faculty, and the
bot answers **only** from verified department documents that an admin has uploaded.

It uses RAG (Retrieval-Augmented Generation): every document is split into chunks and
turned into numbers ("embeddings"). When a student asks something, the closest matching
chunks are found and handed to a language model (Groq), which writes the answer with
source citations. If nothing relevant is found, the bot refuses instead of guessing.

You do not need to understand any of that to run it. Just follow the steps below in
order, and don't skip "Create the database tables".

---

## Table of contents

- [What you need installed](#what-you-need-installed)
- [Get the code and install the libraries](#get-the-code-and-install-the-libraries)
- [Create a free Supabase project](#create-a-free-supabase-project)
- [Create the database tables](#create-the-database-tables)
- [Get your four secret keys](#get-your-four-secret-keys)
- [Create the .env.local file](#create-the-envlocal-file)
- [Load the knowledge documents](#load-the-knowledge-documents)
- [Start the app](#start-the-app)
- [Create your first admin account](#create-your-first-admin-account)
- [Try it out](#try-it-out)
- [How the folders fit together](#how-the-folders-fit-together)
- [If something goes wrong](#if-something-goes-wrong)
- [Running the helper scripts](#running-the-helper-scripts)
- [Stopping / starting over](#stopping--starting-over)

---

## What you need installed

| Tool | Version | Check with | Get it from |
| ---- | ------- | ---------- | ----------- |
| Node.js | 20 or newer | `node -v` | https://nodejs.org (pick the **LTS** button) |
| npm | comes with Node | `npm -v` | (installed automatically) |
| A browser | any modern one | — | Chrome / Firefox / Edge |
| A free Supabase account | — | — | https://supabase.com (sign up, no card needed) |
| A free Groq API key | — | — | https://console.groq.com (sign up, then "API Keys") |

If `node -v` prints something like `v20.11.0` you are good. If it says
"command not found", Node.js is not installed yet.

---

## Get the code and install the libraries

Open a terminal in the project folder (the one that contains `package.json`):

```bash
cd unibot
npm install --legacy-peer-deps
```

**Why `--legacy-peer-deps`?** One library (`@xenova/transformers`, the embedding model)
declares an older dependency than the rest of the app. Without this flag npm stops with
an `ERESOLVE` error. This flag is safe here — it is the documented way this project is
installed.

Wait until it finishes (it downloads a few hundred packages and may take 1–3 minutes).

---

## Create a free Supabase project

This app stores users, chats and document chunks in a Postgres database with vector
search. Supabase hosts that for you for free.

1. Sign in at https://supabase.com → **New project**.
2. Name it `unibot`, set a database password you will remember, pick the region closest
   to you, and click **Create**. Provisioning takes about a minute.
3. In the left sidebar click the **plug icon ("Connect")** — you will need the
   **Project URL** and the **service_role key** later on.

> Supabase is used purely as a database here. Its own login system is **not** used —
> this app has its own email + password auth.

---

## Create the database tables

The schema (tables, the search function, security settings) lives in one file:
`supabase/schema.sql`.

1. In Supabase, open **SQL Editor** in the left sidebar → **New query**.
2. Open `supabase/schema.sql` in your code editor, **select everything** (`Ctrl/Cmd + A`),
   copy it, and paste it into the Supabase query box.
3. Click **Run** (or `Ctrl/Cmd + Enter`).

Do it **once, exactly as-is**. It creates 6 tables (`users`, `conversations`,
`messages`, `documents`, `document_chunks`, `unanswered_questions`) and the
`match_chunks` search function. It also turns on row-level security with no policies,
which deliberately blocks any access that does not come with the service-role key —
that is a feature, not a problem.

If you run it twice you will get `already exists` errors. That is harmless (the tables
were already there), but you only need one clean run.

---

## Get your four secret keys

| Secret | Where to find it |
| ------ | ---------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → **Connect** → Project URL (looks like `https://abcd1234.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → **Project Settings → API** → `service_role` secret. Shown masked — click **Copy** / reveal it. Long string starting with `eyJ…` |
| `GROQ_API_KEY` | https://console.groq.com → **API Keys** → *Create API Key* |
| `JWT_SECRET` | **You make this one yourself** — see below |

To generate a random `JWT_SECRET`, run this in the terminal (any output of 32+ random
characters works):

```bash
openssl rand -base64 32
```

> ⚠️ The `service_role` key can read and write everything in your database. Keep it in
> `.env.local` only. Never paste it into the browser code, a screenshot, or commit it to
> Git. If it leaks, roll it in Supabase and update `.env.local`.

---

## Create the .env.local file

`.env.local` holds your secrets. It is git-ignored, so it never gets committed.

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in the four values (no quotes, no spaces around `=`):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ…your-key…
JWT_SECRET=the-string-from-openssl
GROQ_API_KEY=gsk_…your-key…
```

All four must be non-empty. Embeddings need **no** key and **no** extra service — the
model runs inside this app.

---

## Load the knowledge documents

The bot can only answer from documents that exist in the database, so this step is
required — otherwise every question comes back as a refusal.

The `knowledge/` folder already contains the department Markdown files. Load them:

```bash
npx tsx scripts/ingest.ts
```

Expected output is one line per file plus a totals line, in this shape:

```
01_admissions_application_process.md: <n> chunks (document <uuid>)
02_admissions_merit_and_categories.md: <n> chunks (document <uuid>)
03_department_profile_and_programs.md: <n> chunks (document <uuid>)
04_ce29_department_knowledge.md: <n> chunks (document <uuid>)
05_information_systems_NOT_CE.md: skipped (ingest: false)

Totals: 4 ingested (123 chunks), 1 skipped, 0 failed, 5 files found
```

The totals line is the one to check: **4 ingested, 1 skipped, 0 failed** (123 chunks
for the current documents). If you get `4 failed` instead, one of the earlier
sections (the Supabase key or the schema) is not set up correctly yet.

Notes:

- The first run also downloads the embedding model to a local cache, so it can take an
  extra minute or two. Later runs are much faster.
- `05_information_systems_NOT_CE.md` is **intentionally skipped** — its file has
  `ingest: false` in its header to keep Information Systems content out of this
  CE-only bot.
- Re-running the script is safe: it updates existing documents instead of duplicating
  chunks.

To confirm the search actually works:

```bash
npx tsx scripts/search.ts "merit calculation"
```

You should see a few results with similarity numbers above `0.45`.

---

## Start the app

```bash
npm run dev
```

Wait for the terminal to show `Ready`, then open:

- **http://localhost:3001**

That is this project's usual dev URL. `npm run dev` asks for port 3000, but on this
machine 3000 is normally already taken by another Next.js process, so the server falls
back to **3001**. Always believe the terminal: read the `Local: http://localhost:…`
line it prints and use that port.

To pin it explicitly instead of relying on the fallback:

```bash
npm run dev -- -p 3001
```

The root URL redirects you to `/login` automatically. If 3001 happens to be busy too,
Next.js tells you and uses the next free port — just open the URL it prints.

Keep this terminal open while using the app. Press `Ctrl + C` in it to stop.

---

## Create your first admin account

Anyone can register (password must be **at least 8 characters**), but registration always
creates a **student**. The admin area (`/admin`, document upload) needs an account with
the `admin` role, so make one by hand:

1. Go to **http://localhost:3001/login** and register your email + password.
2. In Supabase → **Table Editor** → `users`, find your row, click it, change `role`
   from `student` to `admin`, and **Save**.
3. **Sign out and sign back in.**

Then the **Admin** link appears in the chat header, and `/admin` shows the document
upload panel.

Why sign out and back in? `/admin` checks the role in the database every time you open
it, so access itself works straight away. But the **Admin** link in the header is
drawn from your login session, and that session is a 7-day cookie that still says
`student`. The re-check is also why a student who types `/admin` manually gets an
"Access denied" screen rather than the upload panel.

---

## Try it out

1. Sign in at **http://localhost:3001/login** → you land on `/chat`.
2. Ask something on-topic, for example:
   - `How is the merit list calculated for admissions?`
   - `What is the application process for BE admissions?`
3. Watch the answer stream in, with `[1]`-style citation markers and the source
   document / session listed under it.
4. Ask a follow-up ("and what about the categories?") — earlier messages are used as
   context, and your conversation appears in the sidebar.
5. Ask something off-topic, for example `Who will win the cricket match?` — the bot
   must reply exactly:

   > I don't have verified information on this.

   That refusal is the point of the project: no made-up answers. Questions that get
   refused are logged in the `unanswered_questions` table so you know what to document
   next.
6. As the admin, open **http://localhost:3001/admin** and upload a `.md` or `.txt` file
   to add knowledge, then ask about it and confirm the bot can now answer. Delete the
   document and ask again — the answer should go back to the refusal.

---

## How the folders fit together

```
app/                    # pages + API routes (Next.js App Router)
  login/  chat/  admin/ # the three screens
  api/auth/             # register, login, logout, who-am-I
  api/chat/             # the RAG answer endpoint (streams NDJSON)
  api/conversations/    # chat history list / load / delete
  api/admin/            # ingest + document list/delete
components/             # the client-side UI pieces
lib/
  auth.ts               # JWT sign/verify + session guards
  config.ts             # the tunable numbers (threshold, top-k, model names)
  embed.ts              # turns text into 384-dimension vectors
  rag.ts                # retrieve → build prompt → extract citations
  groq.ts               # talks to the Groq API
  ingest.ts             # Markdown → chunks → embeddings → database
knowledge/              # the source-of-truth department documents
scripts/                # command-line helpers (ingest, search, ask)
supabase/schema.sql     # database structure — run once in the SQL editor
.env.local              # your secrets (git-ignored, created in "Create the .env.local file")
middleware.ts           # redirects: /chat and /admin need a session
```

Two things worth knowing as a beginner:

- **`lib/config.ts` is where you tune behaviour.** `SIMILARITY_THRESHOLD = 0.45` is how
  close a chunk must be to be used as context. Lower it and off-topic questions may get
  answers; raise it and loosely-worded questions get refused. `TOP_K = 5` is how many
  chunks are retrieved.
- **The embedding dimension is always 384.** If you ever change the embedding model, you
  must re-run `npx tsx scripts/ingest.ts` — old vectors from a different model are
  meaningless next to new ones.

---

## If something goes wrong

| Symptom | Cause and fix |
| ------- | ----------- |
| `Missing JWT_SECRET` / auth routes return 500 | `.env.local` missing or blank values. Re-do "Get your four secret keys" and "Create the .env.local file", then restart `npm run dev` (env changes need a restart). |
| `ERESOLVE` error during `npm install` | You left out `--legacy-peer-deps`. |
| Every answer is the refusal sentence | "Load the knowledge documents" wasn't run, or the tables are empty. Run `npx tsx scripts/ingest.ts`, then `npx tsx scripts/search.ts "merit"` to check similarities are above 0.45. |
| `relation "document_chunks" does not exist` (or similar) | "Create the database tables" wasn't run. Execute `supabase/schema.sql` in the SQL editor. |
| `Invalid API key` from Groq | Wrong or expired `GROQ_API_KEY`. Create a fresh one at console.groq.com. |
| `401 Unauthorized` on `/chat` or `/api/*` | Your session cookie expired (7 days) or you changed roles. Sign out, sign back in. |
| `/admin` says Access denied | Your `users.role` is still `student` in the database (see "Create your first admin account"). If the row already says `admin` but the **Admin** link is missing in the chat header, sign out and back in — the header reads the old session cookie. |
| First `ingest`/`search` run is very slow | It is downloading the embedding model into a local cache. One-time. |
| `WebSocket is not defined` in scripts or API logs | Node 20 lacks a global WebSocket that Supabase v2 expects. The app polyfills it in `lib/supabase/admin.ts`; if you see this, confirm `ws` is installed (`npm ls ws`) and that you are on Node 20+. |
| Port 3001 already in use | Another dev server is running. List them with `ss -ltnp \| grep next-server` (or `lsof -i:3001`) and stop the one you don't need, or let Next.js move to the next free port and use the URL it prints. Check the real port before testing with `curl`: hitting a *different* project's server on 3000 gives misleading status codes and redirect targets. |
| Edits to `.env.local` seem ignored | The dev server caches env at start. Stop it (`Ctrl + C`) and run `npm run dev` again. |

---

## Running the helper scripts

All three read `.env.local` themselves, so no extra setup is needed. They do **not**
require the dev server to be running.

```bash
# Re-load everything in knowledge/ (safe to re-run)
npx tsx scripts/ingest.ts

# See which chunks a question matches, with similarity scores — best for tuning
npx tsx scripts/search.ts "attendance requirement"

# Full pipeline from the command line (retrieve + real Groq answer), no login needed
npx tsx scripts/ask.ts "What is the dropout rule?"
```

`ask.ts` is the quickest way to check whether the bot works without opening a browser.

To check your own TypeScript changes compile:

```bash
npx tsc --noEmit
```

---

## Stopping / starting over

- **Stop the app:** `Ctrl + C` in the dev-server terminal.
- **Empty all knowledge** (for example, after changing the embedding model): delete every
  row in `documents` via Supabase's Table Editor (chunks follow automatically because of
  `on delete cascade`), then run `npx tsx scripts/ingest.ts` again.
- **Full reset:** in the Supabase SQL editor, drop and recreate —
  `drop schema public cascade; create schema public;` — then re-run the "Create the
  database tables" and "Load the knowledge documents" sections.
  This also deletes all user accounts and chats.

---

## Production note (optional, skip while learning)

This project is set up to deploy to Vercel. Two things to know before you do:

- Add the same four variables in Vercel's Project → Settings → Environment Variables, and
  restart/redeploy after adding them.
- Embeddings run in-process, so on serverless each cold start re-downloads the model
  (slow). A persistent host is a better fit for production embeddings.
- Rate limiting is in-memory per process, which is per-instance on serverless. Fine for a
  department-scale app; not a distributed guarantee.
