import { useState } from 'react';
import { ChevronLeft, ChevronRight, Sun, Moon, Plus, ShoppingBasket, Check, Utensils, Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { DAYS, monday, shiftDate, dateKey } from '../lib/domain.js';
import { household } from '../services/householdService.js';

export default function MenuView({ meals, busy, run }) {
  const [week, setWeek] = useState(monday());
  const [meal, setMeal] = useState(null);
  const [added, setAdded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const current = meals.filter(m => m.week_start === week);
  const formatted = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  function edit(day, type) {
    setMeal(current.find(m => m.day_of_week === day && m.meal_type === type) || { week_start: week, day_of_week: day, meal_type: type, dish_name: '', notes: '', missing_ingredients: '' });
    setAdded(false); setDeleting(false);
  }
  async function save(e) {
    e.preventDefault();
    const { id, ...value } = meal;
    value.dish_name = value.dish_name.trim();
    if (!value.dish_name) return;
    if (await run(() => household.saveMeal(value), 'Menú guardado')) setMeal(null);
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow">LA SEMANA SABE MEJOR CON UN PLAN</div><h1>¿Qué comemos hoy?</h1><p>Siete días, muchas ideas y una compra más fácil.</p></div><div className="menu-count"><Utensils size={18} /><strong>{current.length}/14</strong> platos planeados</div></div>
    <div className="week-toolbar"><button className="icon-button" aria-label="Semana anterior" onClick={() => setWeek(shiftDate(week, -7))}><ChevronLeft size={22} /></button><h2>{formatted(week)} — {formatted(shiftDate(week, 6))} <span>{week.slice(0, 4)}</span></h2><button className="icon-button" aria-label="Semana siguiente" onClick={() => setWeek(shiftDate(week, 7))}><ChevronRight size={22} /></button><button className="pill" onClick={() => setWeek(monday())}>Esta semana</button></div>
    <div className="menu-calendar">{DAYS.map((day, i) => <section key={day} className={`day-card ${shiftDate(week, i) === dateKey() ? 'today' : ''}`}><header><h3>{day}</h3><span>{shiftDate(week, i) === dateKey() ? 'HOY' : formatted(shiftDate(week, i))}</span></header><div className="day-meals">{['comida', 'cena'].map(type => { const item = current.find(m => m.day_of_week === day && m.meal_type === type); const Icon = type === 'comida' ? Sun : Moon; return <button key={type} className={`meal-slot ${item ? 'filled' : ''}`} onClick={() => edit(day, type)} aria-label={`${item ? 'Editar' : 'Añadir'} ${type} del ${day}`}><span className="meal-label"><Icon size={16} />{type === 'comida' ? 'COMIDA' : 'CENA'}</span>{item ? <><strong>{item.dish_name}</strong>{item.notes && <p>{item.notes}</p>}{item.missing_ingredients && <span className="missing-label"><ShoppingBasket size={13} />{item.missing_ingredients}</span>}</> : <span className="meal-placeholder"><Plus size={19} />Añadir plato</span>}</button>; })}</div></section>)}</div>
    <p className="menu-note"><span>✦</span> Planificar un poco hoy es disfrutar más de la semana.</p>
    {meal && <Modal title={`${meal.day_of_week} · ${meal.meal_type === 'comida' ? 'Comida' : 'Cena'}`} onClose={() => setMeal(null)} busy={busy}><form className="form-stack" onSubmit={save}>
      <label>¿Qué vamos a preparar?<input autoFocus required maxLength={200} placeholder="Por ejemplo, pasta con verduras" value={meal.dish_name} onChange={e => setMeal({ ...meal, dish_name: e.target.value })} /></label>
      <label>Notas (opcional)<textarea rows={3} maxLength={2000} placeholder="La receta, una idea o algo que recordar…" value={meal.notes} onChange={e => setMeal({ ...meal, notes: e.target.value })} /></label>
      <label>¿Falta algún ingrediente?<input maxLength={1000} placeholder="Tomates, pasta sin gluten, queso" value={meal.missing_ingredients} onChange={e => { setMeal({ ...meal, missing_ingredients: e.target.value }); setAdded(false); }} /></label>
      <p className="muted small">Separa los ingredientes con comas. Se añadirán como productos pendientes de compra.</p>
      <button type="button" className="button secondary full" disabled={busy || !meal.missing_ingredients.trim() || added} onClick={async () => {
        const names = [...new Set(meal.missing_ingredients.split(',').map(s => s.trim()).filter(Boolean))];
        const ok = await run(async () => { for (const name of names) await household.addIngredient(name); }, 'Ingredientes añadidos a la compra');
        if (ok) setAdded(true);
      }}>{added ? <Check size={17} /> : <ShoppingBasket size={17} />}{added ? 'Añadidos a la compra' : 'Añadir ingredientes a la compra'}</button>
      <button className="button primary full" disabled={busy}>Guardar plato</button>
      {meal.id && <button type="button" className="button danger" disabled={busy} onClick={async () => {
        if (!deleting) return setDeleting(true);
        if (await run(() => household.remove('weekly_menu', meal.id), 'Plato eliminado')) setMeal(null);
      }}><Trash2 size={16} />{deleting ? 'Confirmar eliminación' : 'Eliminar plato'}</button>}
    </form></Modal>}
  </>;
}
