-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create the factual_memories table
create table if not exists public.factual_memories (
  id uuid default gen_random_uuid() primary key,
  chat_id text not null,
  content text not null,
  embedding vector(768) not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create a generic index on chat_id 
create index if not exists factual_memories_chat_id_idx on public.factual_memories (chat_id);

-- Create the match_factual_memories RPC function
create or replace function public.match_factual_memories (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_chat_id text
)
returns table (
  id uuid,
  chat_id text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    factual_memories.id,
    factual_memories.chat_id,
    factual_memories.content,
    factual_memories.metadata,
    1 - (factual_memories.embedding <=> query_embedding) as similarity
  from factual_memories
  where factual_memories.chat_id = p_chat_id
    and 1 - (factual_memories.embedding <=> query_embedding) > match_threshold
  order by factual_memories.embedding <=> query_embedding
  limit match_count;
$$;

-- Create the mental_states table
create table if not exists public.mental_states (
  id uuid default gen_random_uuid() primary key,
  chat_id text not null,
  version bigint not null,
  state_data jsonb not null,
  snapshot_reason text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create compound index for getting latest version efficiently
create index if not exists mental_states_chat_id_version_idx on public.mental_states (chat_id, version desc);
