import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  worker: { format: "es" },
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
  ],
  clearScreen: false,
  server: { watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022" },
});
