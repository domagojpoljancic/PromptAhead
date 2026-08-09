/// <reference types="vite/client" />

/** CRXJS: resolves to the packaged content-script file path at build time. */
declare module "*?script" {
  const path: string;
  export default path;
}
