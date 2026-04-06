# JuanSource Frontend

React + Vite frontend for JuanSource. In production, this app is intended to be hosted on GitHub Pages while backend + database stay on your server.

## Local Development

```bash
npm install
npm run dev
```

Default local API behavior:

- Uses `VITE_API_BASE` when provided.
- Otherwise falls back to `http://localhost:8001` in development.

## Production Build For GitHub Pages

Build with environment variables:

```bash
# PowerShell example
$env:VITE_API_BASE="https://juansource.mooo.com/api"
$env:VITE_BASE_PATH="/JuanSource/"
$env:VITE_TURNSTILE_SITE_KEY="your_turnstile_site_key_here"
npm run build
```

`VITE_BASE_PATH` rules:

- Use `/` for `username.github.io` root site.
- Use `/<repo-name>/` for project pages.

## Publish To GitHub Pages

```bash
npm run deploy
```

## Required Backend CORS

On the server, set `CORS_ALLOW_ORIGINS` to include your GitHub Pages origin, for example:

```text
https://juansource.mooo.com,https://your-username.github.io
```
