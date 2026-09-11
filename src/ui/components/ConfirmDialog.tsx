/**
 * ConfirmDialog — ask before doing something, and say what "it" is.
 *
 * A destructive action that cannot say what it will take with it is an action nobody
 * consented to, which is why `children` is arbitrary: the caller renders what the
 * action does, and any per-action control it needs, in the body. The dialog returns
 * approve or deny and nothing else. A choice inside the body — a checkbox, a mode —
 * belongs to the caller: it owns the state, renders the control in `children`, and
 * reads it in its own `onConfirm`. A primitive that returned a payload would be a
 * form, and it would grow one field per caller.
 *
 * **The action's outcome is reported here.** `onConfirm` may return a promise. While
 * it runs, both buttons are disabled, Confirm shows `pendingLabel`, and no dismissal
 * path — Escape, the scrim, Cancel — closes the dialog, because closing over a running
 * action would leave its outcome with nowhere to be reported. If it resolves, the
 * dialog asks to close (`onOpenChange(false)`). If it throws, the dialog stays open
 * with the error's message shown above the buttons, so the failure lands where the
 * user can retry or cancel rather than behind a dialog that has already gone.
 *
 * **Where focus lands.** On a `destructive` dialog, focus opens on Cancel, so a
 * reflexive Enter declines rather than deletes. Otherwise it opens on Confirm, the
 * decision the dialog is asking about.
 *
 * A plain positioned `<div>`, not a native `<dialog>` (the app iframe sandbox cannot
 * open one — see `internal/modal.ts`). It renders in place and `position: fixed`
 * lifts it out of layout, so it can be declared beside the control that opens it,
 * including inside a `Drawer`: the modal behaviour is shared with `Drawer` and knows
 * the innermost overlay owns Escape and Tab.
 */

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ensureStyle } from "../internal/inject-style.js";
import { useModal } from "../internal/modal.js";
import { type StyleWithVars, tokens } from "../tokens.js";
import { Button } from "./Button.js";

const STYLE_ID = "nb-synapse-confirm-dialog";
const RULES = `
/* border-box on both, because the kit cannot assume the host resets it: under
   content-box a full-width panel is its padding wider than a phone screen. */
.nb-confirm-scrim {
  box-sizing: border-box;
  position: fixed; inset: 0; z-index: 1010;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.4);
  animation: nb-confirm-fade 160ms ease;
}
.nb-confirm {
  box-sizing: border-box;
  width: 100%; max-width: 28rem; max-height: 100%;
  overflow-y: auto;
  outline: none;
  animation: nb-confirm-in 160ms cubic-bezier(0.2, 0, 0, 1);
}
.nb-confirm__actions {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem;
}
@keyframes nb-confirm-fade { from { opacity: 0; } }
@keyframes nb-confirm-in { from { opacity: 0; transform: translateY(4px); } }
@media (pointer: coarse) {
  .nb-confirm__actions .nb-btn { min-height: 44px; }
}
`;

interface ConfirmDialogProps {
  open: boolean;
  /** Every dismissal path — Escape, the scrim, Cancel — calls this with `false`. */
  onOpenChange: (open: boolean) => void;
  /** Names the dialog (`aria-labelledby`). */
  title: ReactNode;
  /** One line under the title. Becomes the dialog's accessible description. */
  description?: ReactNode;
  /** What the action will do, and any control that shapes it. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirm's label while `onConfirm` is in flight. Defaults to `confirmLabel`. */
  pendingLabel?: string;
  /** Render Confirm as a `danger` button, and open with focus on Cancel. */
  destructive?: boolean;
  /** Resolve to close. Throw to stay open with the error's message shown. */
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pendingLabel,
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  ensureStyle(STYLE_ID, RULES);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A reopen starts clean: an error from the previous open describes a run the
  // user has already dismissed.
  useEffect(() => {
    if (open) {
      setError(null);
      setPending(false);
    }
  }, [open]);

  const dismiss = () => {
    if (!pending) onOpenChange(false);
  };

  const focusTarget = () =>
    panelRef.current?.querySelector<HTMLElement>(
      destructive ? "[data-nb-confirm-cancel]" : "[data-nb-confirm-confirm]",
    );

  useModal(open, panelRef, { onEscape: dismiss, initialFocus: focusTarget });

  // Disabling the focused button while the action ran can drop focus to <body>,
  // outside the panel's Tab trap. A failure hands it back to the same place the
  // dialog opened on, with the error now above it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the failure alone; focusTarget reads a ref.
  useEffect(() => {
    if (error) focusTarget()?.focus();
  }, [error]);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setPending(false);
      onOpenChange(false);
    } catch (err) {
      // An empty message (`new Error(res.statusText)` over HTTP/2, where statusText
      // is always "") must still show that it failed.
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "That didn't go through. Try again.");
      setPending(false);
    }
  };

  if (!open) return null;

  const panelStyle: StyleWithVars = {
    padding: "1.25rem",
    borderRadius: tokens.radiusMd,
    border: `${tokens.borderWidth} solid ${tokens.border}`,
    background: tokens.bg,
    color: tokens.fg,
    boxShadow: tokens.shadowLg,
    fontFamily: tokens.fontSans,
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim click is a bonus mouse affordance; Escape and Cancel are the keyboard dismissal paths.
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a decorative dismissal backdrop; the panel below owns the alertdialog role/semantics.
    <div
      className="nb-confirm-scrim"
      onClick={(e) => {
        // A click whose target is the scrim itself (not the panel) dismisses.
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descriptionId : undefined}
        aria-busy={pending || undefined}
        tabIndex={-1}
        className="nb-confirm"
        style={panelStyle}
      >
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontFamily: tokens.fontSans,
            fontSize: tokens.textBaseSize,
            lineHeight: tokens.textBaseLine,
            fontWeight: tokens.weightSemibold,
            color: tokens.fg,
          }}
        >
          {title}
        </h2>
        {description != null ? (
          <p
            id={descriptionId}
            style={{
              margin: "0.25rem 0 0",
              fontSize: tokens.textSmSize,
              lineHeight: tokens.textSmLine,
              color: tokens.fgMuted,
            }}
          >
            {description}
          </p>
        ) : null}

        {children != null ? (
          <div
            style={{
              marginTop: "1rem",
              fontSize: tokens.textSmSize,
              lineHeight: tokens.textSmLine,
            }}
          >
            {children}
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            style={{
              margin: "0.75rem 0 0",
              fontSize: tokens.textSmSize,
              lineHeight: tokens.textSmLine,
              color: tokens.danger,
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="nb-confirm__actions" style={{ marginTop: "1.25rem" }}>
          <Button
            variant="secondary"
            size="sm"
            data-nb-confirm-cancel=""
            disabled={pending}
            onClick={dismiss}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            size="sm"
            data-nb-confirm-confirm=""
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
