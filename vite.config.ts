import { defineConfig } from 'vite';

// /jev is proxied straight to TypeSafe with the API key added server-side, so the key never
// reaches the browser. Set TYPESAFE_API_KEY in the environment before `npm run dev`.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/jev': {
        target: 'https://api.typesafe.ai',
        changeOrigin: true,
        rewrite: () => '/v1/systemone',
        headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY ?? ''}` },
      },
    },
  },
});
