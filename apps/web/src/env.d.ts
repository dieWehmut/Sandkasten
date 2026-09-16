/// <reference types="vite/client" />

interface SandkastenConfig {
  apiBaseUrl?: string;
}

declare global {
  var SANDKASTEN_CONFIG: SandkastenConfig | undefined;
}

export {};
