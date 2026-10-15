// Confirm-before-discard guard for modal/drawer close paths. Callers
// pass `isDirty` (typically derived by comparing current local state to
// the initial server copy or placeholder defaults) plus the raw
// `onClose` they want to gate. The returned `tryClose` is what to wire
// into backdrop, Escape, and Cancel — save-success paths should keep
// calling the raw `onClose` directly so they bypass the prompt.
//
// `pending` opts out of the prompt while a save is in flight (the
// mutation's onSuccess will close cleanly).
//
// Reuses the existing <ConfirmProvider> already mounted at the app
// root — no extra wiring needed at the call site.

import { useCallback } from 'react';
import { useConfirm } from '../components/ConfirmDialog';

export interface DirtyCloseOptions {
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

const DEFAULTS = {
  title: 'Discard unsaved changes?',
  body: 'You have edits that haven’t been saved. Closing will lose them.',
  confirmLabel: 'Discard',
  cancelLabel: 'Keep editing',
} as const;

export function useDirtyCloseGuard(
  isDirty: boolean,
  onClose: () => void,
  pending = false,
  options: DirtyCloseOptions = {},
): () => Promise<void> {
  const confirm = useConfirm();
  return useCallback(async () => {
    if (!isDirty || pending) {
      onClose();
      return;
    }
    const ok = await confirm({
      title: options.title ?? DEFAULTS.title,
      body: options.body ?? DEFAULTS.body,
      confirmLabel: options.confirmLabel ?? DEFAULTS.confirmLabel,
      cancelLabel: options.cancelLabel ?? DEFAULTS.cancelLabel,
      destructive: true,
    });
    if (ok) onClose();
  }, [isDirty, pending, onClose, confirm, options.title, options.body, options.confirmLabel, options.cancelLabel]);
}
