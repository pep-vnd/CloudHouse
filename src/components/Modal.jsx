import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, busy = false, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-label={title}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Cerrar ventana" disabled={busy} onClick={onClose}><X size={22} /></button></div>
    {children}
  </dialog>;
}
