import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "../../ui/components/EmptyState.js";
import { Prose } from "../../ui/components/Prose.js";
import { SearchField } from "../../ui/components/SearchField.js";
import { Spinner } from "../../ui/components/Spinner.js";

afterEach(cleanup);

describe("Prose", () => {
  it("renders an html string via the `html` prop", () => {
    const { container } = render(<Prose html="<p>hello <strong>world</strong></p>" />);
    expect(container.querySelector("strong")?.textContent).toBe("world");
  });

  it("renders children when no `html` is given", () => {
    render(
      <Prose>
        <p>child node</p>
      </Prose>,
    );
    expect(screen.getByText("child node")).toBeDefined();
  });
});

describe("SearchField", () => {
  it("applies the variant class (underline / boxed)", () => {
    const { container, rerender } = render(<SearchField variant="underline" />);
    expect(container.querySelector(".nb-search--underline")).not.toBeNull();
    rerender(<SearchField variant="boxed" />);
    expect(container.querySelector(".nb-search--boxed")).not.toBeNull();
  });
});

describe("Spinner + EmptyState", () => {
  it("Spinner exposes a status role", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("EmptyState shows title and description", () => {
    render(<EmptyState title="Nothing yet" description="empty here" />);
    expect(screen.getByText("Nothing yet")).toBeDefined();
    expect(screen.getByText("empty here")).toBeDefined();
  });
});
