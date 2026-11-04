import { useState } from 'react';
import { Check, Plus, RotateCcw, Sparkles, Trash2, CalendarDays } from 'lucide-react';
import Modal from './Modal.jsx';
import { household } from '../services/householdService.js';
import { dateKey, isDueToday } from '../lib/domain.js';

export default function TasksView({ tasks, profile, busy, run }) {
  const [filter, setFilter] = useState('Todas');
  const [form, setForm] = useState(null);
  const [reset, setReset] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const today = dateKey();
  const selected = tasks.filter(t => filter === 'Todas' || t.assigned_to === filter || t.assigned_to === 'Ambos');
  const due = selected.filter(t => isDueToday(t, today));
  const completed = due.filter(t => t.is_completed).length;
  const progress = due.length ? Math.round(completed / due.length * 100) : 0;
  async function save(e) {
    e.preventDefault();
    const value = { ...form, title: form.title.trim(), due_date: form.due_date || null };
    if (!value.title) return;
    if (await run(() => household.addTask(value), 'Nueva tarea añadida')) setForm(null);
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow">CUIDAR LA CASA ES COSA DE DOS</div><h1>Un pequeño esfuerzo.<br className="desktop-break" /> Un gran equipo.</h1><p>Repartimos las tareas. Compartimos la tranquilidad.</p></div><button className="button primary" onClick={() => setForm({ title: '', assigned_to: profile, frequency: 'diaria', due_date: '' })}><Plus size={19} />Nueva tarea</button></div>
    <div className="progress-card"><div className="progress-copy"><span className="eyebrow">ASÍ VA EL DÍA</span><h2>{due.length && completed === due.length ? '¡Buen trabajo, equipo!' : 'Cada tarea cuenta.'}</h2><p>{completed} de {due.length} tareas de hoy completadas</p></div><div className="progress-number">{progress}<span>%</span></div><div className="progress-track" role="progressbar" aria-label="Tareas de hoy completadas" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div></div>
    <div className="tasks-toolbar"><div className="pills">{[['Todas', 'Todas'], ['Hijo', 'Mis tareas (Hijo)'], ['Padre', 'Tareas de Papá']].map(([key, text]) => <button key={key} className={`pill ${filter === key ? 'active' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{text}</button>)}</div><span className="muted small">Las tareas de «Ambos» aparecen en los dos perfiles.</span></div>
    <div className="task-list">{selected.length ? [...selected].sort((a, b) => Number(a.is_completed) - Number(b.is_completed) || (a.due_date || today).localeCompare(b.due_date || today)).map(task => <article key={task.id} className={`task-card ${task.is_completed ? 'completed' : ''}`}>
      <button className="task-checkbox" role="checkbox" aria-checked={task.is_completed} aria-label={`Completar ${task.title}`} disabled={busy} onClick={() => run(() => household.update('household_tasks', task.id, { is_completed: !task.is_completed }))}>{task.is_completed && <Check size={24} />}</button>
      <div className="task-info"><h3>{task.title}</h3><div><span className={`assignee ${task.assigned_to === 'Hijo' ? 'son' : ''}`}>{task.assigned_to === 'Padre' ? 'Papá' : task.assigned_to}</span><span>{task.frequency === 'diaria' ? 'Cada día' : task.frequency === 'semanal' ? 'Cada semana' : 'Una vez'}</span>{task.due_date && <span className={task.due_date < today && !task.is_completed ? 'overdue' : ''}><CalendarDays size={13} />{new Date(`${task.due_date}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>}</div></div>
      <button className="icon-button muted" disabled={busy} aria-label={`Eliminar ${task.title}`} onClick={() => setDeleting(task)}><Trash2 size={17} /></button>
    </article>) : <div className="empty-state"><Sparkles size={36} /><h3>Una casa que cuidamos juntos</h3><p>Añade la primera tarea y elige quién se encarga.</p></div>}</div>
    <div className="reset-panel"><div><h3>Empezamos de nuevo</h3><p>Reinicia las tareas recurrentes de ambos sin volver a escribirlas.</p></div><div className="reset-buttons"><button className="button secondary" disabled={busy || !tasks.some(t => t.frequency === 'diaria' && t.is_completed)} onClick={() => setReset('diaria')}><RotateCcw size={16} />Reiniciar día</button><button className="button secondary" disabled={busy || !tasks.some(t => t.frequency === 'semanal' && t.is_completed)} onClick={() => setReset('semanal')}><RotateCcw size={16} />Reiniciar semana</button></div></div>
    {form && <Modal title="Una nueva tarea" onClose={() => setForm(null)} busy={busy}><form className="form-stack" onSubmit={save}><label>¿Qué hay que hacer?<input autoFocus value={form.title} required maxLength={200} placeholder="Por ejemplo, vaciar el lavavajillas" onChange={e => setForm({ ...form, title: e.target.value })} /></label><div className="form-row"><label>¿Quién se encarga?<select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}><option value="Padre">Papá</option><option>Hijo</option><option>Ambos</option></select></label><label>Frecuencia<select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}><option value="diaria">Cada día</option><option value="semanal">Cada semana</option><option value="puntual">Una vez</option></select></label></div><label>Fecha prevista (opcional)<input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label><button className="button primary full" disabled={busy}>Guardar tarea</button></form></Modal>}
    {reset && <Modal title={reset === 'diaria' ? '¿Reiniciar el día?' : '¿Reiniciar la semana?'} onClose={() => setReset(null)} busy={busy}><p>Se desmarcarán todas las tareas {reset === 'diaria' ? 'diarias' : 'semanales'} de Papá y del Hijo.</p><button className="button primary full" disabled={busy} onClick={async () => { if (await run(() => household.resetTasks(reset), 'Listos para empezar de nuevo')) setReset(null); }}>Reiniciar tareas</button></Modal>}
    {deleting && <Modal title="¿Eliminar esta tarea?" onClose={() => setDeleting(null)} busy={busy}><p>{deleting.title}</p><button className="button danger full" disabled={busy} onClick={async () => { if (await run(() => household.remove('household_tasks', deleting.id), 'Tarea eliminada')) setDeleting(null); }}>Confirmar eliminación</button></Modal>}
  </>;
}
