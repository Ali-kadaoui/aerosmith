import { defineConfig } from 'vite';

const proxy = { '/api': process.env.MEOS_API_URL || 'http://127.0.0.1:8000' };
const allowedHosts = (process.env.MEOS_ALLOWED_HOSTS || '').split(',').filter(Boolean);
export default defineConfig({ server: { proxy, allowedHosts }, preview: { proxy } });
