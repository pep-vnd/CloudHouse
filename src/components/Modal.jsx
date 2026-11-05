import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { lockModalScroll } from '../lib/modalScroll.js';

export default function Modal({ title, children, onClose, busy = false, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element.showModal();
    const unlock = lockModalScroll(document.body);
    return () => {
      element.close();
      unlock();
      if (previous?.isConnected && !document.querySelector('dialog[open]')) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-label={title}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Cerrar ventana" disabled={busy} onClick={onClose}><X size={22} /></button></div>
    {children}
  </dialog>;
}
