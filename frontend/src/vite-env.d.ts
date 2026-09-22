/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Full MCP endpoint URL. Wins over VITE_MCP_SERVER_HOST when both are set. */
  readonly VITE_MCP_SERVER_URL?: string
  /** Hostname only — the shape a host's service reference supplies. */
  readonly VITE_MCP_SERVER_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
