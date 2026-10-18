import type { ReactNode } from 'react';

export function Dialog({ title, onClose, children, size = 'default' }: { title: string; onClose: () => void; children: ReactNode; size?: 'default' | 'wide' | 'studio' }) {
  return (
    <div className="command-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`command-dialog command-dialog--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><small>КОМАНДОВАНИЕ</small><h3>{title}</h3></div><button type="button" className="command-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>✕</button></header>
        {children}
      </div>
    </div>
  );
}
