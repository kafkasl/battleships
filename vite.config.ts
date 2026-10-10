import { defineConfig } from 'vite';

// Both model APIs are proxied with their keys added server-side, so no key reaches the browser.
// Set TYPESAFE_API_KEY and ANTHROPIC_API_KEY in the environment before `npm run dev`.
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
      '/claude': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: () => '/v1/messages',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      },
    },
  },
});
