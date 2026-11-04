import { dateKey, DAYS, monday, shiftDate } from './domain.js';

export const PERIODS = { manana: 'Por la mañana', mediodia: 'Comidas y mediodía', tarde: 'Por la tarde', noche: 'Cenas y noche', flexible: 'Sin hora fija' };
export const dayIndex = date => (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
export function taskOccursOn(task, date = dateKey()) {
  if (task.frequency === 'puntual') return !task.due_date || task.due_date === date;
  return (!task.due_date || task.due_date <= date) && (task.scheduled_days || [0, 1, 2, 3, 4, 5, 6]).includes(dayIndex(date));
}
export function taskCompletedOn(task, date) {
  if (Array.isArray(task.completed_dates)) return task.completed_dates.includes(date);
  return Boolean(task.is_completed);
}
export function periodHasCompletions(tasks, frequency, date) {
  const first = frequency === 'semanal' ? monday(new Date(`${date}T12:00:00`)) : date;
  const last = frequency === 'semanal' ? shiftDate(first, 6) : date;
  return tasks.some(t => t.frequency === frequency && (t.completed_dates || []).some(d => d >= first && d <= last));
}
export function scheduleLabel(task) {
  const days = task.scheduled_days || [0, 1, 2, 3, 4, 5, 6];
  return days.length === 7 ? 'Todos los días' : days.map(i => DAYS[i].slice(0, 3)).join(' · ');
}
export function menuForWeek(meals, week, templates = []) {
  const slots = new Map(templates.map(({ id, ...base }) => [`${base.day_of_week}:${base.meal_type}`, { ...base, week_start: week }]));
  for (const stored of meals.filter(m => m.week_start === week)) slots.set(`${stored.day_of_week}:${stored.meal_type}`, stored);
  return [...slots.values()].filter(meal => !meal.is_skipped);
}
