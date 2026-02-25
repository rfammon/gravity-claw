-- Create automation_status table to track background tasks
CREATE TABLE IF NOT EXISTS public.automation_status (
    id TEXT PRIMARY KEY, -- ex: 'trello-sync', 'llm-tracker-curation'
    last_run_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL, -- 'success', 'failure', 'running'
    summary TEXT, -- Brief summary of what happened
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS automation_status_status_idx ON public.automation_status (status);
