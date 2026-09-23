/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /**
   * Full MCP endpoint URL. Only needed in local development, where the API is a
   * separate process; in a deploy the server serves this app and /mcp on its
   * own origin is correct.
   */
  readonly VITE_MCP_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
