// vite.config.ts
import { defineConfig } from "file:///Users/psonkusare/Documents/Cursor%20projects%202026%20april/Agentic-Commerce/node_modules/vite/dist/node/index.js";
import react from "file:///Users/psonkusare/Documents/Cursor%20projects%202026%20april/Agentic-Commerce/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig(({ command }) => ({
  base: command === "build" ? "/pages/psonkusare/Agentic-Commerce/" : "/",
  plugins: [react()],
  server: {
    /* Pin host + port so HMR has one stable socket to talk to. */
    host: "localhost",
    port: 5173,
    /* Fail fast on `npm run dev` if 5173 is already taken instead of
     * silently picking 5174/5175/etc. — that's how stale Vite
     * instances were piling up and getting OOM-killed by the OS. */
    strictPort: true,
    hmr: {
      /* The full-page error overlay swallowed transient CSS errors
       * and made it look like the server was dead. Keep errors in
       * the terminal where they're recoverable. */
      overlay: false
    },
    watch: {
      /* Ignore anything Vite shouldn't be re-scanning on every save.
       * `public/**` is intentionally broad — public assets are
       * served as-is and don't need HMR; the 171 MB
       * Dji_product_images directory in particular can spike memory
       * if the watcher ever falls back to a deep scan. */
      ignored: [
        "**/.git/**",
        "**/.cache/**",
        "**/.vite/**",
        "**/coverage/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/public/**"
      ]
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvcHNvbmt1c2FyZS9Eb2N1bWVudHMvQ3Vyc29yIHByb2plY3RzIDIwMjYgYXByaWwvQWdlbnRpYy1Db21tZXJjZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL3Bzb25rdXNhcmUvRG9jdW1lbnRzL0N1cnNvciBwcm9qZWN0cyAyMDI2IGFwcmlsL0FnZW50aWMtQ29tbWVyY2Uvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL3Bzb25rdXNhcmUvRG9jdW1lbnRzL0N1cnNvciUyMHByb2plY3RzJTIwMjAyNiUyMGFwcmlsL0FnZW50aWMtQ29tbWVyY2Uvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgY29tbWFuZCB9KSA9PiAoe1xuICBiYXNlOiBjb21tYW5kID09PSBcImJ1aWxkXCIgPyBcIi9wYWdlcy9wc29ua3VzYXJlL0FnZW50aWMtQ29tbWVyY2UvXCIgOiBcIi9cIixcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICBzZXJ2ZXI6IHtcbiAgICAvKiBQaW4gaG9zdCArIHBvcnQgc28gSE1SIGhhcyBvbmUgc3RhYmxlIHNvY2tldCB0byB0YWxrIHRvLiAqL1xuICAgIGhvc3Q6IFwibG9jYWxob3N0XCIsXG4gICAgcG9ydDogNTE3MyxcbiAgICAvKiBGYWlsIGZhc3Qgb24gYG5wbSBydW4gZGV2YCBpZiA1MTczIGlzIGFscmVhZHkgdGFrZW4gaW5zdGVhZCBvZlxuICAgICAqIHNpbGVudGx5IHBpY2tpbmcgNTE3NC81MTc1L2V0Yy4gXHUyMDE0IHRoYXQncyBob3cgc3RhbGUgVml0ZVxuICAgICAqIGluc3RhbmNlcyB3ZXJlIHBpbGluZyB1cCBhbmQgZ2V0dGluZyBPT00ta2lsbGVkIGJ5IHRoZSBPUy4gKi9cbiAgICBzdHJpY3RQb3J0OiB0cnVlLFxuICAgIGhtcjoge1xuICAgICAgLyogVGhlIGZ1bGwtcGFnZSBlcnJvciBvdmVybGF5IHN3YWxsb3dlZCB0cmFuc2llbnQgQ1NTIGVycm9yc1xuICAgICAgICogYW5kIG1hZGUgaXQgbG9vayBsaWtlIHRoZSBzZXJ2ZXIgd2FzIGRlYWQuIEtlZXAgZXJyb3JzIGluXG4gICAgICAgKiB0aGUgdGVybWluYWwgd2hlcmUgdGhleSdyZSByZWNvdmVyYWJsZS4gKi9cbiAgICAgIG92ZXJsYXk6IGZhbHNlLFxuICAgIH0sXG4gICAgd2F0Y2g6IHtcbiAgICAgIC8qIElnbm9yZSBhbnl0aGluZyBWaXRlIHNob3VsZG4ndCBiZSByZS1zY2FubmluZyBvbiBldmVyeSBzYXZlLlxuICAgICAgICogYHB1YmxpYy8qKmAgaXMgaW50ZW50aW9uYWxseSBicm9hZCBcdTIwMTQgcHVibGljIGFzc2V0cyBhcmVcbiAgICAgICAqIHNlcnZlZCBhcy1pcyBhbmQgZG9uJ3QgbmVlZCBITVI7IHRoZSAxNzEgTUJcbiAgICAgICAqIERqaV9wcm9kdWN0X2ltYWdlcyBkaXJlY3RvcnkgaW4gcGFydGljdWxhciBjYW4gc3Bpa2UgbWVtb3J5XG4gICAgICAgKiBpZiB0aGUgd2F0Y2hlciBldmVyIGZhbGxzIGJhY2sgdG8gYSBkZWVwIHNjYW4uICovXG4gICAgICBpZ25vcmVkOiBbXG4gICAgICAgIFwiKiovLmdpdC8qKlwiLFxuICAgICAgICBcIioqLy5jYWNoZS8qKlwiLFxuICAgICAgICBcIioqLy52aXRlLyoqXCIsXG4gICAgICAgIFwiKiovY292ZXJhZ2UvKipcIixcbiAgICAgICAgXCIqKi9kaXN0LyoqXCIsXG4gICAgICAgIFwiKiovbm9kZV9tb2R1bGVzLyoqXCIsXG4gICAgICAgIFwiKiovcHVibGljLyoqXCIsXG4gICAgICBdLFxuICAgIH0sXG4gIH0sXG59KSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTZZLFNBQVMsb0JBQW9CO0FBQzFhLE9BQU8sV0FBVztBQUVsQixJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLFFBQVEsT0FBTztBQUFBLEVBQzVDLE1BQU0sWUFBWSxVQUFVLHdDQUF3QztBQUFBLEVBQ3BFLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixRQUFRO0FBQUE7QUFBQSxJQUVOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUlOLFlBQVk7QUFBQSxJQUNaLEtBQUs7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUlILFNBQVM7QUFBQSxJQUNYO0FBQUEsSUFDQSxPQUFPO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BTUwsU0FBUztBQUFBLFFBQ1A7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixFQUFFOyIsCiAgIm5hbWVzIjogW10KfQo=
