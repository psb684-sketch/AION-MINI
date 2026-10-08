import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// FFmpeg.wasm은 Vite의 사전 번들링(optimizeDeps)을 거치면 내부 워커 경로가 깨지므로 반드시 제외해야 함
export default defineConfig({
  // 상대 경로로 빌드 → GitHub Pages(https://아이디.github.io/AION-MINI/) 하위 경로에서도 그대로 동작
  base: './',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
