import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { usernameEmail } from '../src/lib/auth.js';
import { createInterface } from 'node:readline';

const env = loadEnv('production', process.cwd(), '');
const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const tables = ['inventory_items', 'household_tasks', 'weekly_menu', 'menu_templates', 'household_members'];
const anon = client();
for (const table of tables) {
  const { data, error } = await anon.from(table).select('*').limit(1);
  assert.ok(error || data.length === 0, `Lectura anónima bloqueada: ${table}`);
}
const probeId = crypto.randomUUID();
const probes = [
  anon.from('household_tasks').insert({ id: probeId, title: 'QA acceso', frequency: 'puntual' }),
  anon.from('household_tasks').update({ title: 'QA acceso' }).eq('id', probeId),
  anon.from('household_tasks').delete().eq('id', probeId),
  ...Object.entries({ adjust_inventory: { p_id: probeId, p_delta: 1 }, add_inventory: { p_item: { name: 'QA acceso' } }, buy_inventory: { p_id: probeId }, add_ingredient: { p_name: 'QA acceso' }, set_task_completion: { p_id: probeId, p_date: '2099-01-01', p_completed: true }, reset_task_period: { p_frequency: 'diaria', p_date: '2099-01-01' } }).map(([rpc, args]) => anon.rpc(rpc, args)),
];
for (const probe of probes) assert.ok((await probe).error, 'Escritura/RPC anónima bloqueada');
console.log('OK: lectura, escritura y RPC anónimas bloqueadas.');
console.log('Credenciales de prueba por stdin (JSON de dos cuentas, sin guardar):');
const input = createInterface({ input: process.stdin, terminal: false });
const credentials = await new Promise(resolve => input.once('line', line => { input.close(); resolve(JSON.parse(line)); }));
const clients = credentials.map(client);
let taskId;
try {
  for (const [i, db] of clients.entries()) {
    const { data, error } = await db.auth.signInWithPassword({ email: usernameEmail(credentials[i].username), password: credentials[i].password });
    assert.ifError(error);
    const member = await db.from('household_members').select('*');
    assert.ifError(member.error); assert.equal(member.data.length, 1);
    assert.equal(member.data[0].user_id, data.user.id);
    assert.equal(member.data[0].profile, credentials[i].profile);
    for (const table of tables.slice(0, 4)) {
      const result = await db.from(table).select('id').limit(1);
      assert.ifError(result.error); assert.ok(result.data.length > 0);
    }
    const forbidden = await db.from('household_members').update({ profile: 'Padre' }).eq('user_id', data.user.id);
    assert.ok(forbidden.error, 'No se puede cambiar el perfil desde el cliente');
  }
  const created = await clients[0].from('household_tasks').insert({ title: `QA acceso ${crypto.randomUUID()}`, frequency: 'puntual', due_date: '2099-01-01' }).select().single();
  assert.ifError(created.error); taskId = created.data.id;
  let resolveEvent;
  const received = new Promise(resolve => { resolveEvent = resolve; });
  const channel = clients[1].channel(`qa-access-${crypto.randomUUID()}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'household_tasks', filter: `id=eq.${taskId}` }, resolveEvent);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime no conectado')), 15000);
    channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); } });
  });
  const updated = await clients[0].rpc('set_task_completion', { p_id: taskId, p_date: '2099-01-01', p_completed: true });
  assert.ifError(updated.error);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No llegó actualización Realtime')), 15000);
    received.then(() => { clearTimeout(timeout); resolve(); });
  });
  const row = await clients[1].from('household_tasks').select('*').eq('id', taskId).single();
  assert.ifError(row.error); assert.ok(row.data.completed_dates.includes('2099-01-01'));
  console.log('OK: ambas cuentas, perfiles, permisos y sincronización Realtime.');
} finally {
  if (taskId) { const removed = await clients[0].from('household_tasks').delete().eq('id', taskId); assert.ifError(removed.error); }
  for (const db of clients) { await db.removeAllChannels(); await db.auth.signOut({ scope: 'local' }); }
}
