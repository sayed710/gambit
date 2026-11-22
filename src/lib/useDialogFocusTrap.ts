import { useEffect, type RefObject } from 'react';

/* ============================================================
   useDialogFocusTrap — the a11y contract the guide documents:
   a dialog takes focus when it opens, keeps Tab cycling inside
   itself, closes on Escape, and returns focus where it came
   from. Pure DOM behavior, testable without the app.
   ============================================================ */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useDialogFocusTrap(dialogRef: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // NOTE: deliberately no layout-based visibility filter (offsetParent is
    // always null in jsdom) — hidden focusables would break the cycle count;
    // the app's dialogs contain none.
    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'));

    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [dialogRef, onClose]);
}
