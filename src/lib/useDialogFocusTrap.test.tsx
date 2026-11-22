import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDialogFocusTrap } from './useDialogFocusTrap';

/* A minimal harness exposing exactly the contract the guide
   documents: focus enters, Tab cycles inside, Escape closes,
   focus returns to the opener on unmount. The dialog mounts on
   demand like the real one (opened by focusing the opener). */
function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocusTrap(open ? dialogRef : { current: null }, onClose);
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        opener
      </button>
      {open && (
        <div data-testid="dialog" role="dialog" ref={dialogRef}>
          <button type="button" onClick={() => setOpen(false)}>
            first
          </button>
          <input aria-label="field" />
          <button type="button">last</button>
        </div>
      )}
    </div>
  );
}

afterEach(() => cleanup());

describe('useDialogFocusTrap', () => {
  it('moves focus into the dialog on open and restores it on close', () => {
    render(<Harness onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('opener')); // the user's focus is on the opener
    expect(document.activeElement?.textContent).toBe('first');
    fireEvent.click(screen.getByText('first')); // closes the dialog
    expect(document.activeElement?.textContent).toBe('opener');
  });

  it('Tab wraps from the last focusable back to the first; Shift+Tab the other way', () => {
    render(<Harness onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('opener'));
    const dialog = screen.getByTestId('dialog');
    const buttons = dialog.querySelectorAll('button');
    (buttons[buttons.length - 1] as HTMLButtonElement).focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('first');
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.textContent).toBe('last');
  });

  it('Escape closes the dialog', () => {
    let closed = false;
    render(
      <Harness
        onClose={() => {
          closed = true;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('opener'));
    fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Escape' });
    expect(closed).toBe(true);
  });
});
