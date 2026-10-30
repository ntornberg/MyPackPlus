/// <reference types="chrome" />
/// <reference types="vite/client" />

declare module "*.css?inline" {
  const css: string;
  export default css;
}

export {}; // Makes this a module so it doesn't pollute global scope

declare global {
  interface Window {
    receiver_ready?: boolean;
    __myPackHookLoaded?: boolean;
  }
}
