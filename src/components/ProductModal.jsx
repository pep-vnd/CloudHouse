import { useState } from 'react';
import { Trash2, WheatOff } from 'lucide-react';
import Modal from './Modal.jsx';
import { CATEGORIES, LOCATIONS } from '../lib/domain.js';
import { household } from '../services/householdService.js';

export default function ProductModal({ product, shopping, busy, run, onClose }) {
  const [value, setValue] = useState({ name: '', barcode: null, image_url: '', category: 'otros', location: 'despensa', is_gluten_free: false, quantity: shopping ? 0 : 1, min_quantity: 1, in_shopping_list: shopping, ...product });
  const [deleting, setDeleting] = useState(false);
  const change = e => setValue(v => ({ ...v, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault();
    const { id, updated_at, ...item } = value;
    item.name = item.name.trim(); item.quantity = Number(item.quantity); item.min_quantity = Number(item.min_quantity);
    if (!item.name) return;
    if (id) { delete item.quantity; delete item.in_shopping_list; }
    const ok = await run(() => id ? household.update('inventory_items', id, item) : household.addItem(item), id ? 'Producto actualizado' : 'Producto añadido');
    if (ok) onClose();
  };
  return <Modal title={value.id ? 'Editar producto' : 'Un lugar para cada cosa'} onClose={onClose} busy={busy}>
    <form onSubmit={save} className="form-stack">
      {value.barcode && <p className="muted small">Código {value.barcode} · Revisa los datos antes de guardar.</p>}
      <label>Nombre del producto<input autoFocus name="name" value={value.name} onChange={change} required maxLength={200} placeholder="Por ejemplo, leche de avena" /></label>
      <div><span className="field-label">¿Dónde lo guardamos?</span><div className="choice-grid">{Object.entries(LOCATIONS).map(([key, label]) => <button key={key} type="button" className={value.location === key ? 'choice active' : 'choice'} aria-pressed={value.location === key} onClick={() => setValue(v => ({ ...v, location: key }))}>{label}</button>)}</div></div>
      <label>Categoría<select name="category" value={value.category} onChange={change}>{Object.entries(CATEGORIES).map(([k, text]) => <option key={k} value={k}>{text}</option>)}</select></label>
      <div className="form-row">{!value.id && <label>Unidades<input type="number" name="quantity" min="0" max="100000" required value={value.quantity} onChange={change} /></label>}<label>Stock mínimo<input name="min_quantity" type="number" min="1" max="100000" required value={value.min_quantity} onChange={change} /></label></div>
      <label className="check-label"><input name="is_gluten_free" type="checkbox" checked={value.is_gluten_free} onChange={change} /><WheatOff size={19} /> Sin gluten</label>
      <p className="small muted">Comprueba el envase: solo una etiqueta explícita «sin gluten» marca esta opción automáticamente.</p>
      <button className="button primary full" disabled={busy}>{busy ? 'Guardando…' : value.id ? 'Guardar cambios' : shopping ? 'Añadir a la compra' : 'Guardar producto'}</button>
      {value.id && <button type="button" className="button danger" disabled={busy} onClick={async () => {
        if (!deleting) return setDeleting(true);
        if (await run(() => household.remove('inventory_items', value.id), 'Producto eliminado')) onClose();
      }}><Trash2 size={17} />{deleting ? 'Confirmar eliminación' : 'Eliminar producto'}</button>}
    </form>
  </Modal>;
}
