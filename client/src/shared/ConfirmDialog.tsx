import type { ReactNode } from 'react';

interface Props {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-7 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white mb-3">{title}</h2>
        {children && <div className="text-zinc-300 mb-6">{children}</div>}
        <div className="flex gap-3 justify-end">
          <button className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 cursor-pointer" onClick={onCancel}>
            Cancel
          </button>
          <button
            autoFocus
            className={`px-5 py-2.5 text-white rounded-xl font-bold cursor-pointer ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
