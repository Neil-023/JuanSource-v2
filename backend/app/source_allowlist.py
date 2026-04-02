from urllib.parse import urlparse

# (domain, required_path_prefix). None means allow any path in that domain.
_ALLOWED_SOURCE_RULES = [
    ("verafiles.org", "/articles"),
    ("gmanetwork.com", "/news"),
    ("news.abs-cbn.com", None),
    ("newsinfo.inquirer.net", None),
    ("philstar.com", "/headlines"),
    ("philstar.com", "/nation"),
    ("bworldonline.com", None),
]

ALLOWED_SOURCE_DOMAINS = sorted({domain for domain, _ in _ALLOWED_SOURCE_RULES})


def _normalise_host(host: str) -> str:
    host = (host or "").strip().lower()
    if host.startswith("www."):
        return host[4:]
    return host


def _normalise_path(path: str) -> str:
    if not path:
        return "/"
    if not path.startswith("/"):
        path = f"/{path}"
    return path.rstrip("/") or "/"


def is_allowed_source_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = _normalise_host(parsed.hostname or "")
    path = _normalise_path(parsed.path)

    for allowed_domain, required_prefix in _ALLOWED_SOURCE_RULES:
        if host != allowed_domain:
            continue
        if required_prefix is None:
            return True
        prefix = _normalise_path(required_prefix)
        if path == prefix or path.startswith(f"{prefix}/"):
            return True
    return False


def filter_allowed_source_results(results):
    filtered = []
    for item in results or []:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("link") or ""
        if is_allowed_source_url(url):
            filtered.append(item)
    return filtered
