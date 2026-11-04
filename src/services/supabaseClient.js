import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const isCloudConfigured = Boolean(url && key);
export const configurationError = Boolean(url) !== Boolean(key)
  ? 'Falta la URL o la clave pública de Supabase. Completa ambas variables y vuelve a desplegar.' : null;
export const supabase = isCloudConfigured ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } },
}) : null;

export async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
