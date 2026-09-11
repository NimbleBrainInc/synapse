import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../ui/components/Button.js";
import { ConfirmDialog } from "../../ui/components/ConfirmDialog.js";
import { Drawer } from "../../ui/components/Drawer.js";

afterEach(cleanup);

function pressEscape(target: EventTarget = document.body) {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

function tab(target: HTMLElement, shiftKey = false) {
  const ev = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(ev);
  return ev;
}

/** A deferred promise, so a test can hold `onConfirm` in flight. */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog open={false} onOpenChange={() => {}} title="Forget?" onConfirm={() => {}} />,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is a plain <div> alertdialog, named by its title and described by its description", () => {
    const { container } = render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Forget this query?"
        description="It leaves the saved list for everyone in the workspace."
        onConfirm={() => {}}
      />,
    );
    // The app iframe sandbox withholds allow-modals, so a native <dialog> would throw.
    expect(container.querySelector("dialog")).toBeNull();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.tagName).toBe("DIV");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toBe("Forget this query?");
    const desc = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(desc?.textContent).toBe("It leaves the saved list for everyone in the workspace.");
  });

  it("sets no aria-describedby without a description", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Sure?" onConfirm={() => {}} />);
    expect(screen.getByRole("alertdialog").hasAttribute("aria-describedby")).toBe(false);
  });

  it("renders the caller's body and its labels", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Forget?"
        confirmLabel="Forget"
        cancelLabel="Keep"
        onConfirm={() => {}}
      >
        <p>how many users signed up last week?</p>
      </ConfirmDialog>,
    );
    expect(screen.getByText("how many users signed up last week?")).toBeDefined();
    expect(screen.getByText("Forget")).toBeDefined();
    expect(screen.getByText("Keep")).toBeDefined();
  });

  it("opens with focus on Cancel when destructive, so a reflexive Enter declines", () => {
    render(
      <ConfirmDialog
        open
        destructive
        onOpenChange={() => {}}
        title="Forget?"
        confirmLabel="Forget"
        onConfirm={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByText("Cancel"));
  });

  it("opens with focus on Confirm otherwise", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Publish?"
        confirmLabel="Publish"
        onConfirm={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByText("Publish"));
  });

  it("denies on Escape, Cancel and a scrim click — and not on a click inside the panel", () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Sure?" onConfirm={() => {}} />);

    fireEvent.click(screen.getByRole("alertdialog"));
    expect(onOpenChange).not.toHaveBeenCalled();

    expect(pressEscape().defaultPrevented).toBe(true);
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByRole("alertdialog").parentElement as HTMLElement);
    expect(onOpenChange.mock.calls).toEqual([[false], [false], [false]]);
  });

  it("closes when onConfirm resolves", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Sure?" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("holds while onConfirm runs: pending label, both buttons disabled, no dismissal path", async () => {
    const run = deferred();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        destructive
        onOpenChange={onOpenChange}
        title="Forget?"
        confirmLabel="Forget"
        pendingLabel="Forgetting…"
        onConfirm={() => run.promise}
      />,
    );
    fireEvent.click(screen.getByText("Forget"));

    const confirm = await screen.findByText("Forgetting…");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Cancel") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alertdialog").getAttribute("aria-busy")).toBe("true");

    pressEscape();
    fireEvent.click(screen.getByRole("alertdialog").parentElement as HTMLElement);
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => run.resolve());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open with the error shown when onConfirm throws, and lets the user retry or cancel", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error("The store did not answer."));
    render(
      <ConfirmDialog
        open
        destructive
        onOpenChange={onOpenChange}
        title="Forget?"
        confirmLabel="Forget"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("Forget"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The store did not answer.");
    expect(onOpenChange).not.toHaveBeenCalled();
    const retry = screen.getByText("Forget") as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    // Focus goes back to where a destructive dialog opens — Cancel — not to <body>.
    expect(document.activeElement).toBe(screen.getByText("Cancel"));

    fireEvent.click(retry);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("clears a previous error when reopened", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen
          </button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Sure?"
            onConfirm={() => {
              throw new Error("nope");
            }}
          />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("Confirm"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByText("reopen"));
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("returns focus to the control that opened it", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Forget
          </button>
          <ConfirmDialog open={open} onOpenChange={setOpen} title="Sure?" onConfirm={() => {}} />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByText("Forget");
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).not.toBe(opener);
    fireEvent.click(screen.getByText("Cancel"));
    expect(document.activeElement).toBe(opener);
  });

  it("contains Tab between its own buttons", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Sure?" onConfirm={() => {}} />);
    const cancel = screen.getByText("Cancel");
    const confirm = screen.getByText("Confirm");
    confirm.focus();
    expect(tab(confirm).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(tab(cancel, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
  });

  describe("raised inside a Drawer", () => {
    function Nested({ onClose }: { onClose: () => void }) {
      const [confirming, setConfirming] = useState(true);
      return (
        <Drawer open onClose={onClose}>
          <Drawer.Header onClose={onClose}>Saved query</Drawer.Header>
          <Drawer.Body>
            <button type="button">Refresh</button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title="Forget?"
              onConfirm={() => {}}
            />
          </Drawer.Body>
        </Drawer>
      );
    }

    it("takes Escape for itself and leaves the drawer open", () => {
      const onClose = vi.fn();
      render(<Nested onClose={onClose} />);
      act(() => {
        pressEscape();
      });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeDefined();
      // With the confirmation gone, the drawer is innermost again and Escape is its.
      act(() => {
        pressEscape();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps its own initial focus when it mounts in the same commit as the drawer", () => {
      render(<Nested onClose={() => {}} />);
      expect(document.activeElement).toBe(screen.getByText("Confirm"));
    });

    it("keeps Tab inside itself rather than wrapping to the drawer's boundary", () => {
      render(<Nested onClose={() => {}} />);
      const cancel = screen.getByText("Cancel");
      const confirm = screen.getByText("Confirm");
      confirm.focus();
      tab(confirm);
      expect(document.activeElement).toBe(cancel);
    });

    it("does not close the drawer on a click on its own scrim", () => {
      const onClose = vi.fn();
      render(<Nested onClose={onClose} />);
      fireEvent.click(screen.getByRole("alertdialog").parentElement as HTMLElement);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it("injects its stylesheet once, with the coarse-pointer tap target", () => {
    render(
      <>
        <ConfirmDialog open onOpenChange={() => {}} title="One" onConfirm={() => {}} />
        <Button>outside</Button>
      </>,
    );
    const sheets = document.querySelectorAll("#nb-synapse-confirm-dialog");
    expect(sheets).toHaveLength(1);
    const css = sheets[0]?.textContent ?? "";
    expect(css).toMatch(/\.nb-confirm-scrim\s*\{[^}]*position: fixed/);
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    // Full width on a phone only fits if the padding is inside it.
    expect(css).toMatch(/\.nb-confirm\s*\{[^}]*box-sizing: border-box/);
  });
});

describe("Button danger variant", () => {
  // The variant's colour is a `var()` reference, which happy-dom drops from the
  // rendered style, so what is observable here is that it is a real, clickable
  // button on the shared stylesheet. The red itself is a review concern.
  it("renders a button that fires and respects disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="danger" onClick={onClick}>
        Delete
      </Button>,
    );
    const btn = screen.getByText("Delete");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toContain("nb-btn");
    fireEvent.click(btn);
    rerender(
      <Button variant="danger" onClick={onClick} disabled>
        Delete
      </Button>,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
