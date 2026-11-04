import { useEffect, useState } from 'react';
import { House, LockKeyhole, LogOut, RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { supabase } from '../services/supabaseClient.js';
import { usernameEmail, validMembership } from '../lib/auth.js';
import { cachedHousehold } from '../services/householdService.js';

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  useEffect(() => {
    cachedHousehold();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true;
    setAccount(null);
    if (session === undefined) return;
    if (!session) { setChecking(false); return; }
    setChecking(true);
    supabase.from('household_members').select('user_id,username,profile').eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure) setError('No se ha podido comprobar el acceso. Revisa tu conexión y vuelve a intentarlo.');
        else if (!validMembership(data, session.user.id)) setError('Esta cuenta no tiene acceso a este hogar.');
        else { setAccount(data); setError(''); }
        setChecking(false);
      }).catch(() => { if (active) { setError('No se ha podido comprobar el acceso. Revisa tu conexión.'); setChecking(false); } });
    return () => { active = false; };
  }, [session, attempt]);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { error: failure } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (failure) throw new Error(failure.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : 'No se pudo entrar. Comprueba el usuario, la contraseña y la conexión.');
      setPassword('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    setAccount(null); setBusy(true); setError(''); cachedHousehold();
    try {
      const { error: failure } = await supabase.auth.signOut({ scope: 'local' });
      if (failure) setError('No se pudo cerrar la sesión. Conéctate y vuelve a intentarlo.');
    } finally { setBusy(false); }
  }
  if (account) return children(account, logout);
  return <main className="auth-page"><section className="auth-card" aria-labelledby="auth-title">
    <a className="brand" href={import.meta.env.BASE_URL}><span className="brand-icon"><House size={25} /></span>CloudHouse<span className="brand-dot">.</span></a>
    <span className="auth-lock"><LockKeyhole size={28} strokeWidth={1.5} /></span>
    <p className="eyebrow">NUESTRO HOGAR</p><h1 id="auth-title">Bienvenido a casa.</h1>
    <p className="muted">Tu casa, organizada. Entra para continuar.</p>
    {checking ? <p role="status" className="auth-checking"><RefreshCw className="spin" size={20} />Comprobando tu sesión…</p> : session ? <div className="form-stack"><button className="button primary" disabled={busy} onClick={() => setAttempt(v => v + 1)}>Reintentar conexión</button><button className="button secondary" disabled={busy} onClick={logout}><LogOut size={18} />Cerrar sesión</button></div> : <form className="form-stack" onSubmit={login}>
      <label>Usuario<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={40} value={username} onChange={e => setUsername(e.target.value)} placeholder="Tu nombre de usuario" /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Tu contraseña" /></label>
      <button className="button primary" type="submit" disabled={busy}><LockKeyhole size={18} />{busy ? 'Entrando…' : 'Entrar en casa'}</button>
    </form>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {needRefresh && <button className="button secondary" onClick={() => updateServiceWorker(true)}>Actualizar app</button>}
    <p className="small muted auth-footnote">Acceso reservado a las cuentas de este hogar.</p>
  </section></main>;
}
