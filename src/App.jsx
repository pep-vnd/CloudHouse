import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ShoppingBasket, CalendarDays, CircleCheck, House, Leaf, ArrowUpRight, WifiOff, X, Download, RefreshCw, Heart, UserRound, Cloud, Info } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import InventoryView from './components/InventoryView.jsx';
import TasksView from './components/TasksView.jsx';
import MenuView from './components/MenuView.jsx';
import ScannerModal from './components/ScannerModal.jsx';
import ProductModal from './components/ProductModal.jsx';
import Modal from './components/Modal.jsx';
import AuthGate from './components/AuthGate.jsx';
import { cachedHousehold, household, loadHousehold, subscribeHousehold } from './services/householdService.js';
import { isCloudConfigured } from './services/supabaseClient.js';
import { lookupBarcode } from './services/barcodeService.js';

const NAV = [{ key: 'inventory', title: 'Inventario', Icon: Archive }, { key: 'shopping', title: 'Compra', Icon: ShoppingBasket }, { key: 'menu', title: 'Menú semanal', mobile: 'Menú', Icon: CalendarDays }, { key: 'tasks', title: 'Tareas del hogar', mobile: 'Tareas', Icon: CircleCheck }];
function savedProfile() { try { const value = localStorage.getItem('cloudhouse.profile'); return ['Padre', 'Hijo'].includes(value) ? value : null; } catch { return null; } }

export default function App() {
  return isCloudConfigured ? <AuthGate>{(account, logout) => <HouseholdApp key={account.user_id} account={account} onLogout={logout} />}</AuthGate> : <HouseholdApp />;
}

function HouseholdApp({ account, onLogout }) {
  const [profile, setProfile] = useState(() => account?.profile || savedProfile());
  const [profileOpen, setProfileOpen] = useState(!account && !profile);
  const [tab, setTab] = useState('inventory');
  const [data, setData] = useState(cachedHousehold);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const version = useRef(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [realtime, setRealtime] = useState('CONNECTING');
  const [scanner, setScanner] = useState(false);
  const [product, setProduct] = useState(null);
  const [settings, setSettings] = useState(false);
  const [install, setInstall] = useState(null);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try { const next = await loadHousehold(); if (request === version.current) { setData(next); setError(''); } }
    catch (e) { if (request === version.current) setError(`No se han actualizado los datos: ${e.message}`); }
    finally { if (request === version.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeHousehold(refresh, setRealtime);
    const connection = () => setOnline(navigator.onLine);
    const prompt = e => { e.preventDefault(); setInstall(e); };
    const installed = () => setInstall(null);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    window.addEventListener('beforeinstallprompt', prompt); window.addEventListener('appinstalled', installed);
    return () => { unsubscribe(); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); window.removeEventListener('beforeinstallprompt', prompt); window.removeEventListener('appinstalled', installed); };
  }, [refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  async function run(action, message) {
    if (mutation.current) return false;
    mutation.current = true; setBusy(true); setError('');
    try { await action(); await refresh(); if (message) setToast(message); return true; }
    catch (e) { setError(e.message || 'No se pudo guardar. Vuelve a intentarlo.'); return false; }
    finally { mutation.current = false; setBusy(false); }
  }
  async function detected(barcode) {
    return run(async () => {
      const existing = await household.findBarcode(barcode);
      if (existing) { await household.adjust(existing.id, 1); setToast(`Una unidad más de ${existing.name}`); return; }
      let item;
      try { item = await lookupBarcode(barcode); }
      catch { setToast('No pudimos consultar Open Food Facts. Completa el producto manualmente.'); }
      if (!item) setToast('Completa los datos del producto antes de guardarlo.');
      setProduct(item || { barcode });
    });
  }
  const changeTab = value => { setTab(value); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const choose = value => { try { localStorage.setItem('cloudhouse.profile', value); } catch { setToast('El navegador no permite recordar el perfil.'); } setProfile(value); setProfileOpen(false); };
  const count = data.inventory_items.filter(i => i.in_shopping_list).length;
  const stateText = !isCloudConfigured ? 'Solo este dispositivo' : !online ? 'Sin conexión · lectura' : realtime === 'SUBSCRIBED' ? 'Hogar sincronizado' : 'Conectando al hogar';
  const nav = mobile => NAV.map(({ key, title, Icon, mobile: short }) => <button key={key} className={tab === key ? 'nav-item active' : 'nav-item'} aria-current={tab === key ? 'page' : undefined} onClick={() => changeTab(key)}><Icon size={mobile ? 23 : 20} /><span>{mobile ? short || title : title}</span>{key === 'shopping' && count > 0 && <b>{count}</b>}</button>);
  return <div className="app-shell">
    <aside className="sidebar"><a href={import.meta.env.BASE_URL} className="brand"><span className="brand-icon"><House size={23} /></span>CloudHouse<span className="brand-dot">.</span></a><div className="home-label"><span className="status-dot" />NUESTRO HOGAR</div><nav aria-label="Navegación principal">{nav(false)}</nav><div className="sidebar-bottom"><div className="team-card"><Leaf size={24} strokeWidth={1.5} /><h3>La casa, en equipo.</h3><p>Pequeños hábitos.<br />Un hogar más feliz.</p><div className="team-avatars"><span>P</span><span>H</span><small>Papá & Hijo</small></div></div><button className="connection-button" onClick={() => setSettings(true)}><span className={`status-dot ${isCloudConfigured && online && realtime === 'SUBSCRIBED' ? '' : 'amber-dot'}`} />{stateText}<ArrowUpRight size={14} /></button></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><House size={16} /><span>Nuestro hogar</span><span>/</span><strong>{NAV.find(n => n.key === tab).title}</strong></div><a href={import.meta.env.BASE_URL} className="brand mobile-brand"><span className="brand-icon"><House size={21} /></span>CloudHouse.</a><div className="topbar-right"><span className="today-date">{new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</span><button className="profile-button" onClick={() => account ? setSettings(true) : setProfileOpen(true)} aria-label={account ? "Mi cuenta" : "Cambiar perfil"}><span>{profile === 'Padre' ? 'P' : 'H'}</span><span>{profile === 'Padre' ? 'Papá' : 'Hijo'}</span></button></div></header>
      <main><div className="greeting">Hola, {profile === 'Padre' ? 'Papá' : 'Hijo'} <span>☀</span><span className="greeting-note">Qué bien tenerte en casa.</span></div>
        {!isCloudConfigured && <div className="local-banner"><Info size={17} /><span>Modo local: tus datos se guardan en este navegador. La sincronización familiar está pendiente de conectar.</span><button onClick={() => setSettings(true)}>Ver detalles</button></div>}
        {!online && <div className="notice"><WifiOff size={18} />{isCloudConfigured ? 'Sin conexión. Estás viendo los últimos datos guardados.' : 'Sin conexión. Puedes seguir usando el modo local.'}</div>}
        {isCloudConfigured && online && realtime !== 'SUBSCRIBED' && <div className="notice"><RefreshCw size={17} />Reconectando la sincronización. También comprobamos los cambios cada 30 segundos.</div>}
        {needRefresh && <div className="notice">Hay una nueva versión disponible.<button disabled={busy} onClick={() => updateServiceWorker(true)}>Actualizar app</button></div>}
        {loading ? <div className="empty-state"><RefreshCw className="spin" /><p>Preparando tu hogar…</p></div> : <fieldset className="view-fieldset">
          {(tab === 'inventory' || tab === 'shopping') && <InventoryView items={data.inventory_items} shopping={tab === 'shopping'} onTab={changeTab} onAdd={() => setProduct({})} onEdit={setProduct} onScan={() => setScanner(true)} busy={busy} run={run} />}
          {tab === 'tasks' && <TasksView tasks={data.household_tasks} profile={profile || 'Hijo'} busy={busy} run={run} />}
          {tab === 'menu' && <MenuView meals={data.weekly_menu} templates={data.menu_templates} busy={busy} run={run} />}
        </fieldset>}
        <footer className="main-footer"><Heart size={13} />Menos pendientes. Más hogar.<button onClick={() => setSettings(true)}><Cloud size={14} />{stateText}</button></footer>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Navegación móvil">{nav(true)}</nav>
    {toast && <div className="toast" role="status"><CircleCheck size={18} />{toast}</div>}
    {error && createPortal(<div className="error-toast" role="alert"><div><strong>No se ha completado la operación</strong><p>{error}</p></div><button className="icon-button" aria-label="Cerrar error" onClick={() => setError('')}><X size={20} /></button></div>, document.querySelector('dialog[open]') || document.body)}
    {!account && profileOpen && <Modal title="Bienvenido a casa" onClose={() => setProfileOpen(false)}><p className="muted">Elige tu perfil. Lo recordaremos en este dispositivo.</p><div className="profile-options"><button onClick={() => choose('Padre')}><span className="avatar-large dad"><UserRound size={33} /></span><strong>Soy Papá</strong><span>Juntos, todo es más fácil.</span></button><button onClick={() => choose('Hijo')}><span className="avatar-large son"><UserRound size={33} /></span><strong>Soy Hijo</strong><span>Yo también pongo mi parte.</span></button></div><p className="small muted">Puedes cambiar de perfil cuando quieras desde la esquina superior.</p></Modal>}
    {scanner && <ScannerModal onClose={() => setScanner(false)} onDetected={detected} busy={busy} />}
    {product && <ProductModal product={product} shopping={tab === 'shopping'} onClose={() => setProduct(null)} busy={busy} run={run} />}
    {settings && <Modal title="Tu hogar, siempre a mano" onClose={() => setSettings(false)}><div className="form-stack"><div className="settings-status"><Cloud size={24} /><div><strong>{stateText}</strong><p>{isCloudConfigured ? 'Los cambios se comparten entre Papá e Hijo a través de Supabase.' : 'Este dispositivo funciona de forma independiente. Para compartir el hogar, conecta Supabase y vuelve a publicar la app.'}</p></div></div><h3>Instalar CloudHouse</h3><p className="muted">En iPhone: abre en Safari, pulsa Compartir y «Añadir a la pantalla de inicio». En Android: abre el menú de Chrome y pulsa «Instalar aplicación».</p>{install && <button className="button primary" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}><Download size={18} />Instalar aplicación</button>}<p className="small muted">{account ? `Sesión de ${account.username} · ${account.profile}. Solo las cuentas autorizadas pueden acceder al hogar.` : "El modo local guarda los datos solo en este navegador."}</p>{account ? <button className="button secondary" onClick={onLogout}>Cerrar sesión</button> : <button className="button secondary" onClick={() => { setSettings(false); setProfileOpen(true); }}>Cambiar perfil</button>}<a className="small" href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Productos: Open Food Facts · ODbL · Fotos CC BY-SA</a></div></Modal>}
  </div>;
}
