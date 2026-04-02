import json
import os
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

try:
    from langchain_google_genai import GoogleGenerativeAIEmbeddings
except Exception:
    GoogleGenerativeAIEmbeddings = None

_embedder: Optional[Any] = None


def _is_enabled() -> bool:
    raw = os.getenv("SEMANTIC_CACHE_ENABLED", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _database_url() -> str:
    return os.getenv("DATABASE_URL", "").strip()


def _cache_ttl_seconds() -> int:
    try:
        return max(1, int(os.getenv("SEMANTIC_CACHE_TTL_SECONDS", "86400")))
    except ValueError:
        return 86400


def _min_similarity() -> float:
    try:
        value = float(os.getenv("SEMANTIC_CACHE_MIN_SIMILARITY", "0.87"))
    except ValueError:
        value = 0.87
    return min(1.0, max(0.0, value))


def _embedding_model() -> str:
    return os.getenv("SEMANTIC_CACHE_EMBEDDING_MODEL", "models/text-embedding-004").strip()


def _max_claim_length() -> int:
    try:
        return max(32, int(os.getenv("SEMANTIC_CACHE_MAX_CLAIM_CHARS", "2000")))
    except ValueError:
        return 2000


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def _ensure_embedder() -> Any:
    global _embedder
    if _embedder is not None:
        return _embedder

    if GoogleGenerativeAIEmbeddings is None:
        raise RuntimeError(
            "langchain-google-genai is required for semantic caching embeddings."
        )

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is required for semantic caching embeddings.")

    _embedder = GoogleGenerativeAIEmbeddings(
        model=_embedding_model(),
        google_api_key=api_key,
    )
    return _embedder


def get_claim_embedding(claim: str) -> list[float]:
    text = (claim or "").strip()
    if not text:
        raise RuntimeError("Claim cannot be empty when generating embeddings.")

    max_len = _max_claim_length()
    if len(text) > max_len:
        text = text[:max_len]

    embedder = _ensure_embedder()
    vector = embedder.embed_query(text)
    if not vector:
        raise RuntimeError("Failed to generate claim embedding.")
    return [float(value) for value in vector]


def initialize_semantic_cache_schema() -> None:
    if not _is_enabled():
        print("Semantic cache disabled by SEMANTIC_CACHE_ENABLED.")
        return

    db_url = _database_url()
    if not db_url:
        print("Semantic cache disabled: DATABASE_URL is not set.")
        return

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute(
                """
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
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_semantic_cache_created_at
                    ON semantic_cache (created_at DESC);
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
                    ON semantic_cache USING ivfflat (claim_embedding vector_cosine_ops)
                    WITH (lists = 100);
                """
            )
        conn.commit()


def lookup_semantic_cache(claim_embedding: list[float]) -> Optional[dict[str, Any]]:
    if not _is_enabled():
        return None

    db_url = _database_url()
    if not db_url:
        return None

    ttl_seconds = _cache_ttl_seconds()
    min_similarity = _min_similarity()
    embedding_literal = _vector_literal(claim_embedding)

    query = """
        SELECT
            claim,
            classification,
            reasoning,
            evidence,
            raw_response,
            created_at,
            claim_embedding <=> %s::vector AS distance
        FROM semantic_cache
        WHERE created_at >= NOW() - (%s * INTERVAL '1 second')
        ORDER BY claim_embedding <=> %s::vector
        LIMIT 1;
    """

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(query, (embedding_literal, ttl_seconds, embedding_literal))
            row = cur.fetchone()

    if not row:
        return None

    distance = float(row.get("distance") or 1.0)
    similarity = 1.0 - distance
    if similarity < min_similarity:
        return None

    evidence = row.get("evidence")
    if isinstance(evidence, str):
        try:
            evidence = json.loads(evidence)
        except json.JSONDecodeError:
            evidence = []
    if not isinstance(evidence, list):
        evidence = []

    return {
        "classification": row.get("classification") or "unknown",
        "reasoning": row.get("reasoning") or "",
        "evidence": evidence,
        "raw": row.get("raw_response") or "",
        "similarity": round(similarity, 4),
        "cached_claim": row.get("claim") or "",
    }


def store_semantic_cache(claim: str, claim_embedding: list[float], result: dict[str, Any]) -> None:
    if not _is_enabled():
        return

    db_url = _database_url()
    if not db_url:
        return

    embedding_literal = _vector_literal(claim_embedding)
    evidence = result.get("evidence")
    if not isinstance(evidence, list):
        evidence = []

    payload = (
        claim.strip(),
        embedding_literal,
        str(result.get("classification") or "unknown"),
        str(result.get("reasoning") or ""),
        json.dumps(evidence),
        str(result.get("raw") or ""),
    )

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO semantic_cache (
                    claim,
                    claim_embedding,
                    classification,
                    reasoning,
                    evidence,
                    raw_response
                )
                VALUES (%s, %s::vector, %s, %s, %s::jsonb, %s);
                """,
                payload,
            )
        conn.commit()
