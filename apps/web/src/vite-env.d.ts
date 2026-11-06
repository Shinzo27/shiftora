/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL. Defaults to "/api/v1" (proxied to the API by Vite in development). */
  readonly VITE_API_URL?: string;
}
