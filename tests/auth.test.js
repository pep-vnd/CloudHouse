import test from 'node:test';
import assert from 'node:assert/strict';
import { usernameEmail, validMembership } from '../src/lib/auth.js';

test('El acceso normaliza nombres y rechaza correos o entradas malformadas', () => {
  assert.equal(usernameEmail('  Usuario_Test '), 'usuario_test@users.cloudhouse.invalid');
  for (const input of ['', 'a@other.example', 'dos palabras', '../usuario']) assert.throws(() => usernameEmail(input));
});
test('Un perfil solo es válido para el usuario autenticado correspondiente', () => {
  assert.equal(validMembership(null, 'a'), false);
  assert.equal(validMembership({ user_id: 'b', profile: 'Hijo' }, 'a'), false);
  assert.equal(validMembership({ user_id: 'a', profile: 'Admin' }, 'a'), false);
  assert.equal(validMembership({ user_id: 'a', profile: 'Padre' }, 'a'), true);
});
