import { useEffect, useState } from 'react';
import { Check, Plus, RotateCcw, Sparkles, Trash2, Clock } from 'lucide-react';
import Modal from './Modal.jsx';
import { household } from '../services/householdService.js';
import { DAYS, dateKey, monday, shiftDate } from '../lib/domain.js';
import { dayIndex, PERIODS, taskOccursOn, taskCompletedOn, periodHasCompletions, scheduleLabel } from '../lib/familySchedule.js';

export default function TasksView({ tasks, profile, busy, run }) {
  const [filter, setFilter] = useState('Todas');
  const [form, setForm] = useState(null);
  const [reset, setReset] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [today, setToday] = useState(dateKey);
  const [chosenDay, setChosenDay] = useState(null);
  useEffect(() => {
    const timer = setInterval(() => setToday(dateKey()), 30000);
    return () => clearInterval(timer);
  }, []);
  const week = monday(new Date(`${today}T12:00:00`));
  const selectedDate = chosenDay === null ? today : shiftDate(week, chosenDay);
  const selectedIndex = dayIndex(selectedDate);
  const selected = tasks.filter(t => (filter === 'Todas' || t.assigned_to === filter || t.assigned_to === 'Ambos') && taskOccursOn(t, selectedDate));
  const completed = selected.filter(t => taskCompletedOn(t, selectedDate)).length;
  const progress = selected.length ? Math.round(completed / selected.length * 100) : 0;
  const isToday = selectedDate === today;
  async function save(e) {
    e.preventDefault();
    const value = { ...form, title: form.title.trim(), due_date: form.due_date || null, scheduled_time: form.scheduled_time || null };
    if (!value.title || !value.scheduled_days.length) return;
    if (await run(() => household.addTask(value), 'Nueva tarea añadida')) setForm(null);
  }
  function addTask() {
    setForm({ title: '', assigned_to: profile, frequency: 'diaria', due_date: '', scheduled_days: [0, 1, 2, 3, 4, 5, 6], time_of_day: 'flexible', scheduled_time: '', notes: '', completed_dates: [] });
  }
  return <>
    <div className="page-heading">
      <div><div className="eyebrow">CUIDAR LA CASA ES COSA DE DOS</div><h1>Nuestra semana,<br />en equipo.</h1><p>Cada día tiene su ritmo. Cada uno, su parte.</p></div>
      <button className="button primary" onClick={addTask}><Plus size={19} />Nueva tarea</button>
    </div>
    <div className="family-context"><strong>Vuestra rutina, día a día.</strong><p>Elige un día para ver sus horarios, responsables y notas. Cada tarea vuelve a estar pendiente en su siguiente fecha.</p></div>
    <div className="schedule-days" aria-label="Día de las tareas">
      {DAYS.map((day, i) => <button key={day} className={selectedIndex === i ? 'active' : ''} aria-pressed={selectedIndex === i} aria-label={`Ver tareas del ${day}`} onClick={() => setChosenDay(i === dayIndex(today) ? null : i)}><span>{day.slice(0, 3)}</span><strong>{Number(shiftDate(week, i).slice(-2))}</strong>{i === dayIndex(today) && <small>HOY</small>}</button>)}
    </div>
    <div className="progress-card">
      <div className="progress-copy"><span className="eyebrow">{isToday ? 'ASÍ VA EL DÍA' : `ASÍ VA EL ${DAYS[selectedIndex].toUpperCase()}`}</span><h2>{selected.length && completed === selected.length ? '¡Buen trabajo, equipo!' : 'Cada tarea cuenta.'}</h2><p>{completed} de {selected.length} tareas {isToday ? 'de hoy' : `del ${DAYS[selectedIndex].toLowerCase()}`} completadas</p></div>
      <div className="progress-number">{progress}<span>%</span></div>
      <div className="progress-track" role="progressbar" aria-label="Tareas del día seleccionado completadas" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div>
    </div>
    <div className="tasks-toolbar"><div className="pills">{[['Todas', 'Todas'], ['Hijo', 'Mis tareas (Hijo)'], ['Padre', 'Tareas de Papá']].map(([key, text]) => <button key={key} className={`pill ${filter === key ? 'active' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{text}</button>)}</div><span className="muted small">Las tareas de «Ambos» aparecen en los dos perfiles. El completado se guarda por fecha.</span></div>
    {Object.entries(PERIODS).map(([period, label]) => {
      const group = selected.filter(t => (t.time_of_day || 'flexible') === period).sort((a, b) => (a.scheduled_time || '99').localeCompare(b.scheduled_time || '99') || a.id.localeCompare(b.id));
      return group.length > 0 && <section className="routine-group" key={period} aria-label={label}><h2>{label}<span>{group.length}</span></h2><div className="task-list">{group.map(task => {
        const done = taskCompletedOn(task, selectedDate);
        return <article key={task.id} className={`task-card ${done ? 'completed' : ''}`}>
          <button className="task-checkbox" role="checkbox" aria-checked={done} aria-label={`Completar ${task.title}`} disabled={busy} onClick={() => run(() => household.completeTask(task.id, selectedDate, !done))}>{done && <Check size={24} />}</button>
          <div className="task-info"><h3>{task.title}</h3><div><span className={`assignee ${task.assigned_to === 'Hijo' ? 'son' : ''}`}>{task.assigned_to === 'Padre' ? 'Papá' : task.assigned_to}</span>{task.scheduled_time && <span><Clock size={13} />{task.scheduled_time.slice(0, 5)}</span>}<span>{task.frequency === 'puntual' ? 'Una vez' : scheduleLabel(task)}</span></div>{task.notes && <p className="task-notes">{task.notes}</p>}</div>
          <button className="icon-button muted" disabled={busy} aria-label={`Eliminar ${task.title}`} onClick={() => setDeleting(task)}><Trash2 size={17} /></button>
        </article>;
      })}</div></section>;
    })}
    {!selected.length && <div className="empty-state"><Sparkles size={36} /><h3>Sin tareas para este día</h3><p>Prueba otro día o perfil, o añade una nueva tarea.</p></div>}
    <div className="reset-panel"><div><h3>Empezamos de nuevo</h3><p>Las rutinas empiezan pendientes en cada nueva fecha. También puedes desmarcarlas manualmente.</p></div><div className="reset-buttons">
      <button className="button secondary" disabled={busy || !periodHasCompletions(tasks, 'diaria', selectedDate)} onClick={() => setReset('diaria')}><RotateCcw size={16} />Reiniciar día</button>
      <button className="button secondary" disabled={busy || !periodHasCompletions(tasks, 'semanal', selectedDate)} onClick={() => setReset('semanal')}><RotateCcw size={16} />Reiniciar semana</button>
    </div></div>
    {form && <Modal title="Una nueva tarea" onClose={() => setForm(null)} busy={busy}><form className="form-stack" onSubmit={save}>
      <label>¿Qué hay que hacer?<input autoFocus value={form.title} required maxLength={200} placeholder="Por ejemplo, vaciar el lavavajillas" onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <div className="form-row"><label>¿Quién se encarga?<select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}><option value="Padre">Papá</option><option>Hijo</option><option>Ambos</option></select></label><label>Frecuencia<select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value, scheduled_days: e.target.value === 'semanal' ? [selectedIndex] : [0, 1, 2, 3, 4, 5, 6] })}><option value="diaria">Rutina diaria</option><option value="semanal">Cada semana</option><option value="puntual">Una vez</option></select></label></div>
      {form.frequency !== 'puntual' && <div><span className="field-label">Días de la semana</span><div className="pills schedule-form-days">{DAYS.map((day, i) => <button key={day} type="button" aria-label={day} aria-pressed={form.scheduled_days.includes(i)} className={`pill ${form.scheduled_days.includes(i) ? 'active' : ''}`} onClick={() => setForm({ ...form, scheduled_days: form.scheduled_days.includes(i) ? form.scheduled_days.filter(d => d !== i) : [...form.scheduled_days, i].sort() })}>{day.slice(0, 3)}</button>)}</div>{!form.scheduled_days.length && <p className="inline-error">Selecciona al menos un día.</p>}</div>}
      <div className="form-row"><label>Momento del día<select value={form.time_of_day} onChange={e => setForm({ ...form, time_of_day: e.target.value })}>{Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Hora (opcional)<input type="time" value={form.scheduled_time} onChange={e => setForm({ ...form, scheduled_time: e.target.value })} /></label></div>
      <label>{form.frequency === 'puntual' ? 'Fecha prevista' : 'Empezar a partir de (opcional)'}<input type="date" required={form.frequency === 'puntual'} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label>
      <label>Notas (opcional)<textarea rows={2} maxLength={2000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
      <button className="button primary full" disabled={busy || !form.scheduled_days.length}>Guardar tarea</button>
    </form></Modal>}
    {reset && <Modal title={reset === 'diaria' ? '¿Reiniciar este día?' : '¿Reiniciar esta semana?'} onClose={() => setReset(null)} busy={busy}><p>Se desmarcarán las tareas {reset === 'diaria' ? `diarias del ${selectedDate}` : `semanales del ${week} al ${shiftDate(week, 6)}`} de ambos perfiles. Los demás días y semanas conservarán su historial.</p><button className="button primary full" disabled={busy} onClick={async () => { if (await run(() => household.resetTasks(reset, selectedDate), 'Tareas reiniciadas')) setReset(null); }}>Reiniciar tareas</button></Modal>}
    {deleting && <Modal title="¿Eliminar esta tarea?" onClose={() => setDeleting(null)} busy={busy}><p>{deleting.title}. Se retirará de todos los días de la rutina.</p><button className="button danger full" disabled={busy} onClick={async () => { if (await run(() => household.remove('household_tasks', deleting.id), 'Tarea eliminada')) setDeleting(null); }}>Confirmar eliminación</button></Modal>}
  </>;
}
