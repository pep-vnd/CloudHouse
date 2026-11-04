export function usernameEmail(value) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(username)) throw new Error('Escribe tu nombre de usuario, sin espacios.');
  return `${username}@users.cloudhouse.invalid`;
}

export function validMembership(member, userId) {
  return Boolean(member && member.user_id === userId && ['Padre', 'Hijo'].includes(member.profile));
}
