CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS semantic_cache (
    id BIGSERIAL PRIMARY KEY,
    claim TEXT NOT NULL,
    claim_embedding VECTOR(768) NOT NULL,
    classification TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_response TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_created_at
    ON semantic_cache (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
    ON semantic_cache USING ivfflat (claim_embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE TABLE IF NOT EXISTS daily_prompt_usage (
    id BIGSERIAL PRIMARY KEY,
    anonymous_id TEXT NOT NULL,
    usage_date DATE NOT NULL,
    prompt_count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_daily_prompt_usage UNIQUE (anonymous_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_prompt_usage_date
    ON daily_prompt_usage (usage_date DESC);
