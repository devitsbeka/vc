import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current directory
    const env = loadEnv(mode, process.cwd(), '');
    
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      define: {
        // Expose env vars to the app (only VITE_ prefixed ones are auto-exposed)
        'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
        'import.meta.env.VITE_AWS_BEDROCK_API_KEY': JSON.stringify(env.VITE_AWS_BEDROCK_API_KEY),
        'import.meta.env.VITE_AWS_BEDROCK_REGION': JSON.stringify(env.VITE_AWS_BEDROCK_REGION || 'us-east-1'),
      }
    };
});
