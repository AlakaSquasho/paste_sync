import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const parsedDevPort = Number.parseInt(env.VITE_DEV_PORT ?? '', 10)
  const devPort = Number.isFinite(parsedDevPort) && parsedDevPort > 0 ? parsedDevPort : 5173
  const parsedServerPort = Number.parseInt(env.PORT ?? '', 10)
  const serverPort = Number.isFinite(parsedServerPort) && parsedServerPort > 0 ? parsedServerPort : 3000

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: devPort,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${serverPort}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `http://127.0.0.1:${serverPort}`,
          ws: true,
          changeOrigin: true,
        }
      }
    }
  }
})
