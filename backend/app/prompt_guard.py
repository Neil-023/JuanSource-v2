import base64
import hashlib
import hmac
import ipaddress
import os
import secrets
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx
import psycopg
from fastapi import HTTPException, Request, Response, status


def _database_url() -> str:
    return os.getenv("DATABASE_URL", "").strip()


def _daily_prompt_limit() -> int:
    try:
        return max(1, int(os.getenv("DAILY_PROMPT_LIMIT", "3")))
    except ValueError:
        return 3


def _rate_limit_timezone() -> ZoneInfo:
    timezone_name = os.getenv("RATE_LIMIT_TIMEZONE", "Asia/Manila").strip() or "Asia/Manila"
    try:
        return ZoneInfo(timezone_name)
    except Exception:
        return ZoneInfo("Asia/Manila")


def _usage_date() -> date:
    return datetime.now(_rate_limit_timezone()).date()


def _cookie_name() -> str:
    return os.getenv("ANON_COOKIE_NAME", "juansource_anon").strip() or "juansource_anon"


def _cookie_secret() -> str:
    secret = os.getenv("ANON_COOKIE_SECRET", "").strip()
    if not secret:
        # Safe enough for local dev, but should be overridden in production.
        secret = "juansource-local-dev-cookie-secret"
    return secret


def _cookie_secure() -> bool:
    raw = os.getenv("ANON_COOKIE_SECURE", "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _cookie_ttl_seconds() -> int:
    try:
        return max(86400, int(os.getenv("ANON_COOKIE_TTL_SECONDS", str(180 * 86400))))
    except ValueError:
        return 180 * 86400


def _turnstile_secret() -> str:
    return os.getenv("TURNSTILE_SECRET_KEY", "").strip()


def _is_public_ip(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_global
    except ValueError:
        return False


def _sign_value(value: str) -> str:
    digest = hmac.new(_cookie_secret().encode("utf-8"), value.encode("utf-8"), hashlib.sha256).digest()
    signature = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
    return f"{value}.{signature}"


def _unsign_value(signed_value: str) -> str | None:
    if not signed_value or "." not in signed_value:
        return None
    value, signature = signed_value.rsplit(".", 1)
    expected = _sign_value(value).rsplit(".", 1)[1]
    if not hmac.compare_digest(signature, expected):
        return None
    return value


def _new_anonymous_id() -> str:
    return f"user_{secrets.token_hex(8)}"


def _resolve_or_set_anonymous_id(request: Request, response: Response) -> str:
    cookie_value = request.cookies.get(_cookie_name())
    anonymous_id = _unsign_value(cookie_value) if cookie_value else None
    if anonymous_id:
        return anonymous_id

    anonymous_id = _new_anonymous_id()
    response.set_cookie(
        key=_cookie_name(),
        value=_sign_value(anonymous_id),
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        max_age=_cookie_ttl_seconds(),
        path="/",
    )
    return anonymous_id


def ensure_anonymous_cookie(request: Request, response: Response) -> str:
    return _resolve_or_set_anonymous_id(request, response)


def initialize_prompt_guard_schema() -> None:
    db_url = _database_url()
    if not db_url:
        print("Prompt guard disabled: DATABASE_URL is not set.")
        return

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_prompt_usage (
                    id BIGSERIAL PRIMARY KEY,
                    anonymous_id TEXT NOT NULL,
                    usage_date DATE NOT NULL,
                    prompt_count INT NOT NULL DEFAULT 1,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_daily_prompt_usage UNIQUE (anonymous_id, usage_date)
                );
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_daily_prompt_usage_date
                    ON daily_prompt_usage (usage_date DESC);
                """
            )
        conn.commit()


def _consume_daily_prompt(anonymous_id: str) -> tuple[int, int]:
    db_url = _database_url()
    if not db_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Rate limiter is not configured: DATABASE_URL is missing.",
        )

    limit = _daily_prompt_limit()
    day = _usage_date()
    query = """
        INSERT INTO daily_prompt_usage (anonymous_id, usage_date, prompt_count, updated_at)
        VALUES (%s, %s, 1, NOW())
        ON CONFLICT (anonymous_id, usage_date)
        DO UPDATE SET
            prompt_count = daily_prompt_usage.prompt_count + 1,
            updated_at = NOW()
        WHERE daily_prompt_usage.prompt_count < %s
        RETURNING prompt_count;
    """

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(query, (anonymous_id, day, limit))
            row = cur.fetchone()
        conn.commit()

    if not row:
        timezone_name = os.getenv("RATE_LIMIT_TIMEZONE", "Asia/Manila")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Daily prompt limit reached ({limit}/day). "
                f"Please try again after midnight ({timezone_name})."
            ),
        )

    return int(row[0]), limit


async def _verify_turnstile(request: Request, token: str) -> None:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Turnstile verification token is required.",
        )

    secret = _turnstile_secret()
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="TURNSTILE_SECRET_KEY is not configured on the backend.",
        )

    remote_ip = request.client.host if request.client else None
    verification_data = {
        "secret": secret,
        "response": token,
    }
    if remote_ip and _is_public_ip(remote_ip):
        verification_data["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data=verification_data,
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Turnstile verification failed upstream: {exc}",
        )

    if not payload.get("success"):
        error_codes = payload.get("error-codes") or []
        if not isinstance(error_codes, list):
            error_codes = [str(error_codes)]
        codes_text = ", ".join(str(code) for code in error_codes if code) or "unknown"
        hostname = payload.get("hostname") or "unknown"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Turnstile verification failed ({codes_text}). "
                f"Hostname: {hostname}."
            ),
        )


async def enforce_prompt_guard(request: Request, response: Response) -> None:
    try:
        body = await request.json()
    except Exception:
        body = {}

    token = ""
    if isinstance(body, dict):
        token = (body.get("turnstile_token") or body.get("turnstileToken") or "").strip()

    await _verify_turnstile(request, token)
    anonymous_id = ensure_anonymous_cookie(request, response)
    used, limit = _consume_daily_prompt(anonymous_id)

    response.headers["X-Prompt-Limit"] = str(limit)
    response.headers["X-Prompt-Used"] = str(used)
    response.headers["X-Prompt-Remaining"] = str(max(0, limit - used))
