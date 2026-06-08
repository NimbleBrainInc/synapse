import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "../../ui/components/Badge.js";
import { Button, TextLink } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { StatusDot } from "../../ui/components/StatusDot.js";
import { Stack } from "../../ui/primitives.js";

afterEach(cleanup);

describe("Stack", () => {
  it("lays children out as a vertical flex with the given gap", () => {
    const { container } = render(
      <Stack gap={12}>
        <span>a</span>
        <span>b</span>
      </Stack>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.display).toBe("flex");
    expect(el.style.flexDirection).toBe("column");
    expect(el.style.gap).toBe("12px");
    expect(el.textContent).toBe("ab");
  });
});

describe("Button", () => {
  it("fires onClick and respects disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText("Go"));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByText("Go"));
    expect(onClick).toHaveBeenCalledTimes(1); // disabled → no second call
  });

  it("injects the shared button stylesheet exactly once", () => {
    render(
      <>
        <Button>one</Button>
        <Button variant="secondary">two</Button>
        <TextLink>three</TextLink>
      </>,
    );
    expect(document.querySelectorAll("#nb-synapse-button")).toHaveLength(1);
  });
});

describe("StatusDot", () => {
  it("animates only the working state and injects keyframes once", () => {
    const { rerender, container } = render(<StatusDot status="working" />);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "nb-statusdot--working",
    );

    rerender(<StatusDot status="completed" />);
    expect((container.firstElementChild as HTMLElement).className).not.toContain(
      "nb-statusdot--working",
    );

    render(<StatusDot status="working" />);
    expect(document.querySelectorAll("#nb-synapse-statusdot")).toHaveLength(1);
  });
});

describe("Badge + Card", () => {
  it("renders a badge label and card content", () => {
    render(
      <Card>
        <Badge tone="warm">HIGH</Badge>
      </Card>,
    );
    expect(screen.getByText("HIGH")).toBeDefined();
  });
});
