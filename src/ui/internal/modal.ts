/**
 * What `HTMLDialogElement.showModal()` gives for free, hand-rolled for the overlays
 * in this kit (`Drawer`, `ConfirmDialog`).
 *
 * The platform mounts every app in a sandboxed iframe that withholds `allow-modals`,
 * so `showModal()` throws there and white-screens the app; a native `<dialog>` is
 * unusable in the one environment these apps run in. Each overlay is a plain
 * positioned `<div>` instead, and this hook supplies the modal behaviour: focus
 * moved into the panel on open and restored on close, background scroll locked,
 * Tab/Shift+Tab contained while focus is inside the panel, and Escape.
 *
 * Overlays nest — a confirmation raised from inside a drawer is the ordinary case —
 * so the open ones form a stack, and only the innermost answers Escape and Tab. Every
 * overlay listens for Escape on `window`, so without the stack one keypress would
 * close all of them; and a nested panel renders inside its parent's DOM, so its Tab
 * keydown bubbles to the parent's trap, which would otherwise compute a boundary
 * that contains both.
 *
 * Scope: this contains Tab while focus is *inside* the panel — the modal case. It is
 * NOT the full native `inert`: it doesn't recover focus that drops to `<body>` when a
 * focused child unmounts (that fires focusout, not focusin), nor fence off portal'd
 * overlays a consumer opens outside the panel. A document-scoped focus backstop would
 * do neither reliably and would yank focus out of legitimate nested overlays — so
 * full containment is a FocusScope-style owner stack, deferred to #43.
 */

import { type RefObject, useEffect, useRef } from "react";

// A control inside a *closed* <details> (other than its own <summary>) is not
// reachable, even though its tabIndex is 0 — the collapse is a UA `display:none`
// on the disclosure content. It's structural (the `open` attribute + DOM
// position), so it's detectable without layout and belongs in the filter below,
// alongside `[hidden]` (also a UA `display:none` rule).
function inClosedDetails(el: HTMLElement): boolean {
  const details = el.closest("details:not([open])");
  if (!details) return false;
  const summary = details.querySelector("summary");
  return !summary || !summary.contains(el);
}

// Tabbable elements inside the panel, in DOM order — the focus-trap boundary.
// A broad candidate query filtered by a positive predicate, in place of a
// `:not(...)` denylist that had to enumerate every non-tabbable case per clause.
// The filter is the set of non-tabbable cases detectable *without layout*:
// `tabIndex >= 0` rejects any negative tabindex, `:disabled` inherits through
// `<fieldset disabled>`, `[hidden]` and closed-<details> collapse are tested on
// the element and its ancestors. CSS-hidden focusables (`display:none` /
// `visibility:hidden` set in a stylesheet) need layout to detect, so they're NOT
// filtered (worst case: one Tab exits).
//
// CANDIDATES is an allowlist of mainstream focusables, not `*`: a bare `<a>` (no
// href) reports tabIndex 0 but isn't focusable, so `*` would admit a phantom
// boundary — `a[href]` is load-bearing. It is deliberately not exhaustive:
// media/embeds (`<audio controls>`, `<iframe>`) and `[contenteditable]` are
// omitted until a consumer needs one, to keep the set honest.
const CANDIDATES = "a[href], button, input, select, textarea, summary, [tabindex]";
function tabbables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(CANDIDATES)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !el.closest("[hidden]") &&
      !inClosedDetails(el) &&
      (el as HTMLInputElement).type !== "hidden",
  );
}

// The open overlays, in the order they opened. Module-level because the questions it
// answers — "am I the one on top?", "am I the last one open?" — span every overlay on
// the page, not one component tree.
interface OpenOverlay {
  panel: HTMLElement | null;
  /** Where focus goes when this overlay closes. */
  restoreTo: HTMLElement | null;
}
const openOverlays: OpenOverlay[] = [];
// The body's overflow from before the first overlay opened. Page-level state is
// owned by the stack, not by each overlay: the page is locked while any overlay is
// open, whichever order they opened and closed in.
let lockedOverflow = "";
// Escapes an overlay has already acted on, so one keypress closes one overlay.
// See the window listener for why this is recorded rather than inferred.
const handledEscapes = new WeakSet<Event>();

// Innermost means: no open overlay sits inside this one's panel, and none that is
// not its ancestor opened after it. DOM nesting decides first because open order
// cannot: when a drawer and the confirmation inside it mount in the same commit,
// React runs the child's effect before the parent's, so the drawer registers
// second. Open order decides between overlays that do not nest.
function isInnermost(self: OpenOverlay): boolean {
  const selfAt = openOverlays.indexOf(self);
  return openOverlays.every((other, at) => {
    if (other === self || !other.panel || !self.panel) return true;
    if (self.panel.contains(other.panel)) return false;
    if (other.panel.contains(self.panel)) return true;
    return at < selfAt;
  });
}

interface ModalOptions {
  /** Called on Escape while this overlay is the innermost one open. */
  onEscape: () => void;
  /**
   * Where focus lands on open. Defaults to the panel itself. Read once, when the
   * overlay opens, so it may return an element rendered in the same commit.
   */
  initialFocus?: () => HTMLElement | null | undefined;
}

export function useModal(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  { onEscape, initialFocus }: ModalOptions,
): void {
  // Read through refs so a new callback identity each render neither re-subscribes
  // nor moves this overlay's place in the stack.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const entry: OpenOverlay = { panel, restoreTo: previouslyFocused };
    // An overlay nested in this one that is already open opened in the same commit —
    // React runs the child's effect first — so it recorded this overlay's opener as
    // its own, and this one would record the nested overlay's control. Swap: this
    // overlay returns focus to the opener, the nested one returns it to this panel.
    //
    // The swap is with the overlay directly below this one, which is the *outermost*
    // of the ones nested inside it: the effects ran deepest-first, so each has already
    // swapped with the one below it, and only the outermost still holds this overlay's
    // opener. That same deepest-first order puts it last in the stack, so it is the
    // last match, not the first.
    const nested = openOverlays.filter((o) => panel && o.panel && panel.contains(o.panel)).at(-1);
    if (nested) {
      entry.restoreTo = nested.restoreTo;
      nested.restoreTo = panel;
    }
    const { body } = document;
    if (openOverlays.length === 0) lockedOverflow = body.style.overflow;
    openOverlays.push(entry);
    const innermost = () => isInnermost(entry);

    // Focus already inside the panel is left where it is: it is the nested overlay's
    // initial focus, from the same commit.
    if (!(panel && previouslyFocused && panel.contains(previouslyFocused))) {
      (initialFocusRef.current?.() ?? panel)?.focus();
    }
    body.style.overflow = "hidden";

    // Escape on `window` rather than the panel, so it works wherever focus sits —
    // including on <body> after a focused control inside the panel unmounted.
    //
    // One Escape closes one overlay. In a browser the nested overlay's listener
    // can close it and let React commit before this listener runs for the same
    // keypress, which would leave this overlay innermost and close it too — so
    // the overlay that acts records the event and the rest stand down.
    //
    // Recorded on the event rather than read off `defaultPrevented`, which
    // answers a different question: "did anyone cancel this?" rather than "did
    // an overlay act on it?". The SDK's own key forwarder cancels every Escape
    // it forwards, on `document`, which a bubbling keydown reaches before
    // `window` — so an overlay reading `defaultPrevented` finds it already true
    // for an Escape nothing has handled, and no overlay ever closes. Only the
    // overlays can answer the question the guard is asking.
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || handledEscapes.has(e) || !innermost()) return;
      handledEscapes.add(e);
      e.preventDefault();
      escapeRef.current();
    };
    window.addEventListener("keydown", onWindowKeyDown);

    const onPanelKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel || !innermost()) return;
      const focusables = tabbables(panel);
      if (focusables.length === 0) {
        // Nothing tabbable inside — preventDefault keeps focus on the panel it's
        // already on (the open step focused it), so Tab can't leave.
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener("keydown", onPanelKeyDown);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      panel?.removeEventListener("keydown", onPanelKeyDown);
      const at = openOverlays.indexOf(entry);
      if (at !== -1) openOverlays.splice(at, 1);
      if (openOverlays.length === 0) body.style.overflow = lockedOverflow;
      entry.restoreTo?.focus?.();
    };
  }, [open, panelRef]);
}
