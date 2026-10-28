import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [
    vue({
      script: {
        defineModel: true,
        propsDestructure: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/chat": "http://localhost:3001",
      "/recipes": "http://localhost:3001",
      "/reset": "http://localhost:3001",
    },
  },
});
