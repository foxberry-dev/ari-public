import { defineConfig, type ServerOptions } from 'vite';
import vue from '@vitejs/plugin-vue';

export function devServer(devHost = process.env.ARI_DEV_HOST): ServerOptions {
  const hosts = devHost ? [...new Set([devHost, devHost.replace("--main--", "--")])] : [];
  const origins = hosts.map(host => `https://${host}`);
  return {
    allowedHosts: hosts,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:38477',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (upstream, request) => {
            if (request.headers.origin && origins.includes(request.headers.origin)) {
              upstream.setHeader('origin', 'http://127.0.0.1:5175');
            }
          });
        },
      },
    },
  };
}

export default defineConfig({
  plugins: [vue()],
  server: devServer(),
});
