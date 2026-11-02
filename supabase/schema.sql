create extension if not exists vector;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text,
  student_id text,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text default 'New chat',
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  document_name text not null,
  category text,
  uploaded_at timestamptz default now()
);

create table document_chunks (
  id bigserial primary key,
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  embedding vector(384),
  metadata jsonb
);

create table unanswered_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  question text not null,
  created_at timestamptz default now()
);

-- similarity search
create function match_chunks(query_embedding vector(384), match_count int)
returns table (id bigint, content text, metadata jsonb, similarity float)
language sql stable as $$
  select id, content, metadata, 1 - (embedding <=> query_embedding) as similarity
  from document_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- RLS: enabled with no policies, so the anon key can read nothing.
-- The app talks to Postgres only through the service-role client, which
-- bypasses RLS; authorization is enforced in the API routes.
alter table users enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table unanswered_questions enable row level security;
