// packages/ui is source-imported by apps/web (Vite). Declare the Vite-provided
// import.meta.env shape so hooks that guard on DEV typecheck in isolation.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
