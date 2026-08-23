/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare global {
  interface Window {
    $msg?: { success: (m: string) => void; info: (m: string) => void; warning: (m: string) => void; error: (m: string) => void }
  }
}
export {}
