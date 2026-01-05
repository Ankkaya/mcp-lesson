# Copilot Instructions

## Project Map

- Root `package.json` drives a collection of LangChain/MCP scripts under [src](src) (all `.mjs` ES modules even though the package is CommonJS).
- [src/my-mcp-server.mjs](src/my-mcp-server.mjs) spins up an MCP server exposing the `query_user` tool against an in-memory user table plus a `docs://guide` resource.
- [src/langchain-mcp-test.mjs](src/langchain-mcp-test.mjs) uses `MultiServerMCPClient` to bind LLM tools/resources at runtime, so changes to the server are tested here via `node src/langchain-mcp-test.mjs`.
- [src/all-tools.mjs](src/all-tools.mjs) defines reusable LangChain `tool()` adapters for reading/writing files and shelling out commands; [src/mini-cursor.mjs](src/mini-cursor.mjs) wires them into an agent with the strict "no cd inside execute_command when workingDirectory is set" policy.
- [src/loader-and-splitter.mjs](src/loader-and-splitter.mjs) showcases fetching web docs via `CheerioWebBaseLoader`, chunking text with `RecursiveCharacterTextSplitter`, and requires outbound HTTP access.
- The standalone front-end lives in [react-todo-app](react-todo-app), a pnpm/Vite React 19 + TypeScript project implementing the animated todo UI in [react-todo-app/src/App.tsx](react-todo-app/src/App.tsx) and [react-todo-app/src/App.css](react-todo-app/src/App.css).

## Environment & Secrets

- Provide a `.env` (not committed) before running Node agents: `MODEL_NAME`, `API_KEY`, and `BASE_URL` power LangChain `ChatOpenAI`; `OPENAI_BASE_URL` is required when using the Cheerio loader script.
- Scripts assume modern Node (>=18) with ESM support; use `node --env-file=.env src/<file>.mjs` if you prefer not to rely on `dotenv/config` auto-loading.
- For the Vite app, install dependencies with `pnpm install` inside `react-todo-app` (pnpm is already referenced in agent prompts, so stay consistent).

## Key Workflows

- **MCP server**: run `node src/my-mcp-server.mjs`; tooling clients such as Cursor connect over stdio, so avoid extra console noise.
- **Agent + tools**: execute `node src/langchain-mcp-test.mjs` to see tool/resource discovery and invocation; the script streams resource contents into a `SystemMessage` before chatting.
- **Local automation**: `node src/mini-cursor.mjs` drives a self-hosted "Cursor-like" agent that can read/write files and run shell commands; respect the guardrails emitted in the system prompt when expanding tooling.
- **Web loader**: `node src/loader-and-splitter.mjs` crawls the configured article, splits paragraphs at Chinese punctuation, and logs structured `documents`. Change `chunkSize`, `chunkOverlap`, or `selector` here when tailoring RAG pipelines.
- **React/Vite**: in `react-todo-app`, use `pnpm run dev` for HMR, `pnpm run build` to emit production assets, and `pnpm run lint` for ESLint 9 + TS 5.9.

## Implementation Patterns

- LangChain tools always return friendly text and log their work with `console.log` so that calling agents can echo progress; keep this ergonomics when adding new tools.
- `execute_command` in [src/all-tools.mjs](src/all-tools.mjs) parses the first token as the binary and passes the rest as args, so prefer simple commands (`pnpm run dev`) rather than shell-conditioned strings; set `workingDirectory` instead of chaining `cd`.
- The React todo app stores tasks in `localStorage` via `useEffect`, so any new fields must remain JSON-serializable (Date objects are saved as ISO strings and only used for ordering/client display).
- Styles favor translucent cards, gradients, and CSS keyframe animations; match that aesthetic when adding UI to maintain the "glassmorphism" feel already defined in [react-todo-app/src/App.css](react-todo-app/src/App.css).
- When extending MCP resources, update both the server (tool schema, response text) and the consuming client in [src/langchain-mcp-test.mjs](src/langchain-mcp-test.mjs) so new resources are added to the aggregated `SystemMessage` context.

## Gotchas & Tips

- Because `spawn` in `execute_command` inherits stdio, any long-running commands will block the agent loop; wrap them in `npm-run-all` style watchers only when necessary and prefer short-lived commands for automation sequences.
- The MCP server is synchronous and serves data from an in-memory object; persistence resets every run, so avoid assuming cross-session state when testing tools.
- `react-todo-app/src/index.css` still contains the default Vite styles; keep overrides isolated to `App.css` to avoid fighting those base rules.
- Be explicit about path casing on Windows (the agents run under `Z:\demo\mcp\tool-2` in scripts); mismatched paths will break `MultiServerMCPClient` process spawning.

Let me know if any of these sections feel incomplete or if another workflow should be documented.
