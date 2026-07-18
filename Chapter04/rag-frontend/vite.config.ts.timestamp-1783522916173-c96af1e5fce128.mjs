// vite.config.ts
import { defineConfig } from "file:///C:/Users/Owner/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/rag-frontend/node_modules/vite/dist/node/index.js";
import preact from "file:///C:/Users/Owner/OneDrive/RESTful-Web-API-Design-with-Node.js-10-Third-Edition/Chapter04/rag-frontend/node_modules/@preact/preset-vite/dist/esm/index.mjs";
var vite_config_default = defineConfig({
  plugins: [preact()],
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      "/api/pharmacist": { target: "http://localhost:4006", rewrite: (p) => p.replace(/^\/api\/pharmacist/, ""), changeOrigin: true },
      "/api/ehr": { target: "http://localhost:4007", rewrite: (p) => p.replace(/^\/api\/ehr/, ""), changeOrigin: true },
      "/api/diagnosis": { target: "http://localhost:4008", rewrite: (p) => p.replace(/^\/api\/diagnosis/, ""), changeOrigin: true },
      "/api/config": { target: "http://localhost:4009", rewrite: (p) => p.replace(/^\/api/, ""), changeOrigin: true }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxPd25lclxcXFxPbmVEcml2ZVxcXFxSRVNUZnVsLVdlYi1BUEktRGVzaWduLXdpdGgtTm9kZS5qcy0xMC1UaGlyZC1FZGl0aW9uXFxcXENoYXB0ZXIwNFxcXFxyYWctZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXE93bmVyXFxcXE9uZURyaXZlXFxcXFJFU1RmdWwtV2ViLUFQSS1EZXNpZ24td2l0aC1Ob2RlLmpzLTEwLVRoaXJkLUVkaXRpb25cXFxcQ2hhcHRlcjA0XFxcXHJhZy1mcm9udGVuZFxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvT3duZXIvT25lRHJpdmUvUkVTVGZ1bC1XZWItQVBJLURlc2lnbi13aXRoLU5vZGUuanMtMTAtVGhpcmQtRWRpdGlvbi9DaGFwdGVyMDQvcmFnLWZyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCBwcmVhY3QgZnJvbSAnQHByZWFjdC9wcmVzZXQtdml0ZSc7XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIHBsdWdpbnM6IFtwcmVhY3QoKV0sXHJcbiAgc2VydmVyOiB7XHJcbiAgICBwb3J0OiA1MTc4LFxyXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcclxuICAgIHByb3h5OiB7XHJcbiAgICAgICcvYXBpL3BoYXJtYWNpc3QnOiB7IHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NDAwNicsIHJld3JpdGU6IHAgPT4gcC5yZXBsYWNlKC9eXFwvYXBpXFwvcGhhcm1hY2lzdC8sICcnKSwgY2hhbmdlT3JpZ2luOiB0cnVlIH0sXHJcbiAgICAgICcvYXBpL2Vocic6ICAgICAgICAgeyB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjQwMDcnLCByZXdyaXRlOiBwID0+IHAucmVwbGFjZSgvXlxcL2FwaVxcL2Voci8sICcnKSwgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUgfSxcclxuICAgICAgJy9hcGkvZGlhZ25vc2lzJzogICB7IHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NDAwOCcsIHJld3JpdGU6IHAgPT4gcC5yZXBsYWNlKC9eXFwvYXBpXFwvZGlhZ25vc2lzLywgJycpLCAgIGNoYW5nZU9yaWdpbjogdHJ1ZSB9LFxyXG4gICAgICAnL2FwaS9jb25maWcnOiAgICAgIHsgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDo0MDA5JywgcmV3cml0ZTogcCA9PiBwLnJlcGxhY2UoL15cXC9hcGkvLCAnJyksICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlIH0sXHJcbiAgICB9LFxyXG4gIH0sXHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXllLFNBQVMsb0JBQW9CO0FBQ3RnQixPQUFPLFlBQVk7QUFFbkIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE9BQU8sQ0FBQztBQUFBLEVBQ2xCLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLE9BQU87QUFBQSxNQUNMLG1CQUFtQixFQUFFLFFBQVEseUJBQXlCLFNBQVMsT0FBSyxFQUFFLFFBQVEsc0JBQXNCLEVBQUUsR0FBRyxjQUFjLEtBQUs7QUFBQSxNQUM1SCxZQUFvQixFQUFFLFFBQVEseUJBQXlCLFNBQVMsT0FBSyxFQUFFLFFBQVEsZUFBZSxFQUFFLEdBQVcsY0FBYyxLQUFLO0FBQUEsTUFDOUgsa0JBQW9CLEVBQUUsUUFBUSx5QkFBeUIsU0FBUyxPQUFLLEVBQUUsUUFBUSxxQkFBcUIsRUFBRSxHQUFLLGNBQWMsS0FBSztBQUFBLE1BQzlILGVBQW9CLEVBQUUsUUFBUSx5QkFBeUIsU0FBUyxPQUFLLEVBQUUsUUFBUSxVQUFVLEVBQUUsR0FBUSxjQUFjLEtBQUs7QUFBQSxJQUN4SDtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
