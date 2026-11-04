import test from 'node:test';
import assert from 'node:assert/strict';
import { taskOccursOn, taskCompletedOn, menuForWeek, periodHasCompletions, scheduleLabel } from '../src/lib/familySchedule.js';

test('una rutina solo aparece en los días programados y desde su fecha inicial', () => {
  const task = { frequency: 'semanal', scheduled_days: [2, 5], due_date: '2026-11-04' };
  assert.equal(taskOccursOn(task, '2026-11-04'), true);
  assert.equal(taskOccursOn(task, '2026-11-07'), true);
  assert.equal(taskOccursOn(task, '2026-11-05'), false);
  assert.equal(taskOccursOn(task, '2026-10-31'), false);
  assert.equal(scheduleLabel(task), 'Mié · Sáb');
});
test('las tareas puntuales aparecen en su fecha y las antiguas sin horario siguen siendo utilizables', () => {
  const task = { frequency: 'puntual', due_date: '2026-11-05' };
  assert.equal(taskOccursOn(task, '2026-11-05'), true);
  assert.equal(taskOccursOn(task, '2026-11-06'), false);
  assert.equal(taskOccursOn({ frequency: 'diaria' }, '2026-11-06'), true);
});
test('completar una fecha no completa otra ni la misma jornada de otra semana', () => {
  const task = { frequency: 'diaria', is_completed: true, completed_dates: ['2026-11-02'] };
  assert.equal(taskCompletedOn(task, '2026-11-02'), true);
  assert.equal(taskCompletedOn(task, '2026-11-03'), false);
  assert.equal(taskCompletedOn(task, '2026-11-09'), false);
  assert.equal(periodHasCompletions([task], 'diaria', '2026-11-03'), false);
  assert.equal(periodHasCompletions([{ ...task, frequency: 'semanal' }], 'semanal', '2026-11-04'), true);
  assert.equal(periodHasCompletions([{ ...task, frequency: 'semanal' }], 'semanal', '2026-11-09'), false);
});
test('plantillas compartidas y cambios de menú se combinan sin mezclar semanas o IDs', () => {
  const template = { id: 'template-only-id', day_of_week: 'Viernes', meal_type: 'comida', dish_name: 'Plato habitual' };
  const override = { id: 'weekly-id', ...template, week_start: '2026-11-02', dish_name: 'Plato de esta semana' };
  assert.equal(menuForWeek([], '2026-11-09', [template])[0].dish_name, template.dish_name);
  assert.equal(menuForWeek([], '2026-11-09', [template])[0].id, undefined);
  assert.equal(menuForWeek([override], '2026-11-02', [template])[0].dish_name, override.dish_name);
  assert.equal(menuForWeek([override], '2026-11-09', [template])[0].dish_name, template.dish_name);
  assert.equal(menuForWeek([{ ...override, is_skipped: true }], '2026-11-02', [template]).length, 0);
});
test('un hogar sin plantillas conserva sus platos propios; quitar un plato no lo hace reaparecer', () => {
  const meal = { day_of_week: 'Lunes', meal_type: 'cena', dish_name: 'Plato propio', week_start: '2026-11-02' };
  assert.deepEqual(menuForWeek([meal], '2026-11-02', []), [meal]);
  assert.equal(menuForWeek([{ ...meal, is_skipped: true }], '2026-11-02', []).length, 0);
});
