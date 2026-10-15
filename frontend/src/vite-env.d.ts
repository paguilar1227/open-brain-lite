/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPEN_BRAIN_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
