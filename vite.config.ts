import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets keep the static build portable across root domains, subdirectories, and local preview servers.
  base:'./',
  build:{
    outDir:'dist',
    sourcemap:false,
    target:'es2022',
  },
});
