import { createInterface } from 'node:readline';
import { usernameEmail } from '../src/lib/auth.js';

export async function authenticateClients(clients) {
  console.log('Introduce por stdin un JSON con username y password de un miembro (no se guarda).');
  if (process.stdin.isTTY) console.log('Para ocultar la entrada en terminal, ejecuta primero: stty -echo');
  const input = createInterface({ input: process.stdin, terminal: false });
  const credentials = await new Promise(resolve => input.once('line', line => { input.close(); resolve(JSON.parse(line)); }));
  for (const db of clients) {
    const { error } = await db.auth.signInWithPassword({ email: usernameEmail(credentials.username), password: credentials.password });
    if (error) throw new Error('No se pudo autenticar la cuenta de pruebas.');
  }
}
