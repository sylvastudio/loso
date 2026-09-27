# Loso MCP server

`loso-mcp.mjs` exposes Loso's studio tools (projects, footage survey, layout, snapshot, cut, render, ...) to any MCP client such as Claude Code, Cursor or Codex. It's a zero-dependency Node 20+ stdio server. It relays requests to the running Loso app over HTTP (`GET /api/tools`, `POST /api/tools/call`; see `src/lib/studio/contract.ts`).

**The Loso dev server must be running** (`pnpm dev`, default `http://localhost:3000`). If Loso isn't running, tool calls return an error that says so.

- Tools that need a project take a required `projectId`. Call `list_projects` or `create_project` first.
- In-app-only tools (`ask_user`, `propose_storyboard`) are hidden. Your agent asks you directly instead.
- `cut` and `render` run without an in-app Approve step, so your MCP client handles approval.
- Set `LOSO_URL` to point at a non-default address.

Replace `/absolute/path/to/loso` below with your checkout path.

## Claude Code

```sh
claude mcp add loso -- node /absolute/path/to/loso/mcp/loso-mcp.mjs
# non-default URL:
claude mcp add loso -e LOSO_URL=http://localhost:3001 -- node /absolute/path/to/loso/mcp/loso-mcp.mjs
```

## Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "loso": {
      "command": "node",
      "args": ["/absolute/path/to/loso/mcp/loso-mcp.mjs"],
      "env": { "LOSO_URL": "http://localhost:3000" }
    }
  }
}
```

## Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.loso]
command = "node"
args = ["/absolute/path/to/loso/mcp/loso-mcp.mjs"]
env = { LOSO_URL = "http://localhost:3000" }
```

## Other MCP clients

Most stdio clients accept this shape. See your client's MCP docs for where it goes.

```json
{
  "mcpServers": {
    "loso": {
      "command": "node",
      "args": ["/absolute/path/to/loso/mcp/loso-mcp.mjs"],
      "env": { "LOSO_URL": "http://localhost:3000" }
    }
  }
}
```

## Example prompt

> Using loso, make a 30-second poster short in project `<id>` from ~/Downloads/Excerpt — survey the footage, propose a storyboard, ask me before cutting.

## Debugging

From the repo, run `pnpm mcp` (or `node mcp/loso-mcp.mjs`) and paste one JSON-RPC message per line. Logs go to stderr, and stdout carries only protocol messages.
