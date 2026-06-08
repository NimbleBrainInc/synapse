import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar } from "../../ui/components/Avatar.js";
import { ListRow } from "../../ui/components/ListRow.js";
import { Pagination } from "../../ui/components/Pagination.js";
import { SegmentedControl } from "../../ui/components/SegmentedControl.js";

afterEach(cleanup);

describe("SegmentedControl", () => {
  it("marks the active option pressed and reports the clicked value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="board"
        onChange={onChange}
        options={[
          { label: "Board", value: "board" },
          { label: "Table", value: "table" },
        ]}
      />,
    );
    expect(screen.getByText("Board").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Table").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByText("Table"));
    expect(onChange).toHaveBeenCalledWith("table");
  });
});

describe("Pagination", () => {
  it("disables Prev at the first page and advances on Next", () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageCount={3} onChange={onChange} />);
    fireEvent.click(screen.getByText("← Prev"));
    expect(onChange).not.toHaveBeenCalled(); // disabled at start
    fireEvent.click(screen.getByText("Next →"));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});

describe("Avatar", () => {
  it("derives up to two initials, falling back when no src", () => {
    const { rerender } = render(<Avatar name="Jordan Ratner" />);
    expect(screen.getByText("JR")).toBeDefined();
    rerender(<Avatar name="mat" />);
    expect(screen.getByText("M")).toBeDefined();
  });

  it("renders an image when src is provided", () => {
    render(<Avatar name="Jordan Ratner" src="https://example.com/a.png" />);
    const img = screen.getByAltText("Jordan Ratner") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
  });

  it("falls back to initials when the image fails to load", () => {
    render(<Avatar name="Jordan Ratner" src="https://example.com/broken.png" />);
    fireEvent.error(screen.getByAltText("Jordan Ratner"));
    expect(screen.getByText("JR")).toBeDefined();
    expect(screen.queryByAltText("Jordan Ratner")).toBeNull();
  });
});

describe("ListRow", () => {
  it("renders title + meta and toggles the interactive class", () => {
    const { container, rerender } = render(<ListRow title="Red Night Consulting" meta="21h ago" />);
    expect(screen.getByText("Red Night Consulting")).toBeDefined();
    expect(screen.getByText("21h ago")).toBeDefined();
    expect((container.firstElementChild as HTMLElement).className).not.toContain(
      "nb-listrow--interactive",
    );
    rerender(<ListRow title="Red Night Consulting" interactive />);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "nb-listrow--interactive",
    );
  });

  it("is keyboard-operable when interactive (Enter fires the click)", () => {
    const onClick = vi.fn();
    render(<ListRow title="Open me" interactive onClick={onClick} />);
    const row = screen.getByRole("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
