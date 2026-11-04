import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), '');
if (!env.VITE_BASE_PATH?.startsWith('/') || !env.VITE_BASE_PATH.endsWith('/')) {
  throw new Error('Define VITE_BASE_PATH=/CloudHouse/ en .env.local para GitHub Pages.');
}
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  if (process.env.ALLOW_LOCAL_MODE !== 'true') throw new Error('Faltan las variables públicas de Supabase. Para publicar explícitamente sin sincronización usa ALLOW_LOCAL_MODE=true npm run deploy.');
  console.warn('Publicando en modo local, sin sincronización familiar.');
}
