// In-app confirm dialog. Replaces window.confirm so destructive
// actions speak the same visual language as the rest of the app
// (themed modal + button family). Used through `useConfirm()`:
//
//   const confirm = useConfirm();
//   if (await confirm({ title: 'Delete this comment?', destructive: true })) {
//     deleteMut.mutate();
//   }
//
// Promise-based — callers stay linear. Cancel / backdrop click / ESC
// all resolve `false`; the confirm button resolves `true`. Only one
// dialog is ever live; calling `confirm()` while another is open
// queues behind it (rare in practice but cheap to support).

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal } from './primitives';
import { cls } from '../lib/util';

export interface ConfirmOptions {
  title: ReactNode;
  /** Optional body — supplements the title. Omit for one-line confirms. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the danger color. Default false. */
  destructive?: boolean;
}

interface QueuedPrompt extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<QueuedPrompt | null>(null);
  const queueRef = useRef<QueuedPrompt[]>([]);

  const pumpQueue = useCallback(() => {
    const next = queueRef.current.shift();
    setCurrent(next ?? null);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const entry: QueuedPrompt = { ...opts, resolve };
      // First-come-first-served: if there's no dialog open, show this
      // one immediately; otherwise queue and the resolver runs in order.
      setCurrent((cur) => {
        if (cur) {
          queueRef.current.push(entry);
          return cur;
        }
        return entry;
      });
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  const onCancel = () => {
    current?.resolve(false);
    pumpQueue();
  };
  const onConfirm = () => {
    current?.resolve(true);
    pumpQueue();
  };

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {current ? (
        <Modal
          title={current.title}
          onClose={onCancel}
          footer={
            <>
              <button className="btn btn-ghost" onClick={onCancel}>
                {current.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={cls('btn', current.destructive ? 'btn-danger' : 'btn-primary')}
                onClick={onConfirm}
                autoFocus
              >
                {current.confirmLabel ?? (current.destructive ? 'Delete' : 'Confirm')}
              </button>
            </>
          }
        >
          {current.body ?? null}
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be called inside <ConfirmProvider>');
  }
  return ctx.confirm;
}
