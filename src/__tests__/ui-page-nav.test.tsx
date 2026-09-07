/**
 * The page/navigation primitives, and the two layout traps they were built to close.
 *
 * The traps are the reason this file exists rather than the components. `Text truncate` and
 * `Table` both rendered without error, produced the markup a reader of the source would
 * expect, and were wrong in a way only a browser's box model shows: a "truncating" span that
 * made text unwrappable, and an auto-layout table that let one long cell carry every later
 * column off the pane. Nothing in a type, a lint, or a snapshot sees either. What sees them
 * is an assertion about the DECLARATIONS that end up on the element, so that is what these
 * assert — not that the component rendered, but that the rules which make truncation real
 * are present.
 *
 * **What this environment cannot see, and it is most of the kit.** happy-dom drops every
 * declaration whose value contains `var(...)` — shorthand and longhand alike, so
 * `background: var(--color-background-secondary, #fafafa)` leaves the element with no
 * background at all in the rendered style attribute. Every token in this kit is a `var()`
 * reference, so NO token-driven style is observable here. The assertions below hold only
 * because the declarations that carry the layout fixes are CSS literals (`block`, `hidden`,
 * `fixed`, `auto`) rather than tokens. Anything token-valued is asserted structurally or not
 * at all, and a test that appears to check a colour here would be checking nothing.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "../ui/components/Breadcrumb.js";
import { PageHeader } from "../ui/components/PageHeader.js";
import { Table } from "../ui/components/Table.js";
import { Tabs } from "../ui/components/Tabs.js";
import { AppFrame } from "../ui/layouts/AppFrame.js";
import { Text } from "../ui/typography.js";

describe("Text truncate actually truncates", () => {
  it("makes a block box, because overflow does not apply to an inline one", () => {
    // The original bug in one assertion. `overflow`/`text-overflow` are inert on a
    // non-replaced inline box, so on the default <span> the only surviving declaration was
    // `white-space: nowrap` — and the prop did the opposite of its name.
    render(<Text truncate>a very long string that has to be clipped somewhere</Text>);
    const el = screen.getByText(/very long string/);
    expect(el.style.display).toBe("block");
    expect(el.style.overflow).toBe("hidden");
    expect(el.style.textOverflow).toBe("ellipsis");
    expect(el.style.whiteSpace).toBe("nowrap");
  });

  it("can shrink as a flex item", () => {
    // Without `min-width: 0` a flex item's automatic minimum size is its content, so a
    // truncating Text inside Inline/Stack refuses to go below its full width and pushes the
    // container instead — the same overflow, one layer out.
    render(<Text truncate>shrink me</Text>);
    expect(screen.getByText("shrink me").style.minWidth).toBe("0");
  });

  it("leaves an untruncated Text inline", () => {
    // The fix must not turn every Text into a block; `truncate` is opt-in and so is the box
    // change that serves it.
    render(<Text>plain</Text>);
    expect(screen.getByText("plain").style.display).toBe("");
  });
});

describe("Table gives a truncating cell something to clip against", () => {
  const rows = [{ id: "1", name: "x" }];

  it("switches to fixed layout as soon as a column declares a width", () => {
    const { container } = render(
      <Table
        data={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", header: "Name", width: "40%", render: (r) => r.name },
          { key: "other", header: "Other", render: () => "—" },
        ]}
      />,
    );
    // Auto layout sizes columns to content, which is what let one long cell widen the table
    // past its container. A declared width is the caller stating proportions, and only fixed
    // layout honours it.
    expect(container.querySelector("table")?.style.tableLayout).toBe("fixed");
  });

  it("stays on auto layout when no column has an opinion", () => {
    const { container } = render(
      <Table
        data={rows}
        rowKey={(r) => r.id}
        columns={[{ key: "name", header: "Name", render: (r) => r.name }]}
      />,
    );
    expect(container.querySelector("table")?.style.tableLayout).toBe("");
  });

  it("scrolls itself rather than its page, but only when asked", () => {
    // Opt-in because an overflow container captures the stickiness the header resolves
    // against the page scroller — a real cost, paid only by a table that needs it.
    const columns = [{ key: "name", header: "Name", render: (r: (typeof rows)[0]) => r.name }];
    const plain = render(<Table data={rows} rowKey={(r) => r.id} columns={columns} />);
    expect(plain.container.firstElementChild?.tagName).toBe("TABLE");

    const scrolling = render(
      <Table data={rows} rowKey={(r) => r.id} columns={columns} scrollable />,
    );
    const wrapper = scrolling.container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.style.overflowX).toBe("auto");
    // Without a max-width the wrapper grows to its content and the scroller never engages.
    expect(wrapper.style.maxWidth).toBe("100%");
  });
});

describe("Breadcrumb", () => {
  it("makes every step above the current one a control, and the current one not", () => {
    const up = vi.fn();
    render(<Breadcrumb crumbs={[{ label: "Campaigns", onClick: up }, { label: "Acme Q3" }]} />);
    screen.getByRole("button", { name: "Campaigns" }).click();
    expect(up).toHaveBeenCalledOnce();
    // The current step is text. A control that looks clickable and does nothing is worse
    // than no control.
    expect(screen.queryByRole("button", { name: "Acme Q3" })).toBeNull();
    expect(screen.getByText("Acme Q3").getAttribute("aria-current")).toBe("page");
  });

  it("names itself, so a screen reader can skip or enter the trail", () => {
    render(<Breadcrumb crumbs={[{ label: "Only" }]} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  });
});

describe("PageHeader", () => {
  it("clamps a description rather than letting it become the page", () => {
    // The clamp is a stylesheet rule, so this asserts the rule was injected AND that the
    // description opted into it. Asserting the element's own style would see nothing: the
    // vendor-prefixed pair is dropped by this DOM (see the module note), which is part of
    // why the declaration lives in a rule rather than inline.
    render(<PageHeader title="Acme Q3" description={"long ".repeat(80)} />);
    const sheet = document.getElementById("nb-synapse-page-header")?.textContent ?? "";
    expect(sheet).toContain("-webkit-line-clamp");
    expect(sheet).toContain("display: -webkit-box");

    const desc = screen.getByText(/long long/);
    expect(desc.className).toContain("nb-page-header__desc");
    // The line count travels as a custom property, so a caller's number actually reaches
    // the rule instead of the rule's own default silently standing in for it.
    expect(desc.getAttribute("style")).toContain("--nb-ph-desc-lines: 2");
  });

  it("honours a caller that wants the clamp off", () => {
    render(<PageHeader title="t" description="short" descriptionLines={0} />);
    const desc = screen.getByText("short");
    expect(desc.className).not.toContain("nb-page-header__desc");
    expect(desc.getAttribute("style") ?? "").not.toContain("--nb-ph-desc-lines");
  });

  it("passes a caller's line count through to the rule", () => {
    render(<PageHeader title="t" description="a longer description" descriptionLines={4} />);
    expect(screen.getByText("a longer description").getAttribute("style")).toContain(
      "--nb-ph-desc-lines: 4",
    );
  });

  it("renders no actions box when there are no actions", () => {
    // An empty box still occupies its row and pulls the title off centre, which reads as a
    // control that failed to load rather than as a page with nothing to do.
    const { container } = render(<PageHeader title="Acme Q3" />);
    const titleRow = container.querySelector("header > div") as HTMLElement;
    expect(titleRow.children).toHaveLength(1);
  });

  it("omits the trail entirely on a top-level page", () => {
    render(<PageHeader title="Campaigns" crumbs={[]} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("Tabs are a tablist, not a row of buttons", () => {
  const tabs = [
    { label: "Recipients", value: "recipients" as const },
    { label: "Activity", value: "activity" as const },
  ];

  it("declares the relationship between the tabs", () => {
    render(<Tabs tabs={tabs} value="recipients" onChange={() => {}} label="Campaign" />);
    expect(screen.getByRole("tablist", { name: "Campaign" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Recipients" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("keeps one tab stop for the bar and moves within it by arrow", () => {
    // Roving tabindex. Without it a reader tabs through every facet to leave the bar.
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="recipients" onChange={onChange} />);
    const selected = screen.getByRole("tab", { name: "Recipients" });
    expect(selected.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Activity" }).tabIndex).toBe(-1);

    selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("activity");
  });

  it("wraps at the end, so no tab is two directions away", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="activity" onChange={onChange} />);
    screen
      .getByRole("tab", { name: "Activity" })
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("recipients");
  });
});

describe("AppFrame.Nav is chrome, which is what entitles it to an edge-to-edge rule", () => {
  it("is its own landmark, so chrome and page content are separable at all", () => {
    // The failure this replaces: an app putting nav in `Header` and adding a borderBottom
    // gets a full-bleed hairline between two things that are both the page. A tinted bar of
    // its own makes the same line mean chrome above, page below.
    //
    // The tint and the rule are token-valued and therefore invisible here (see the module
    // note), so what is asserted is the part that carries the meaning structurally: Nav is a
    // distinct `<nav>` landmark rather than more content inside the page header, and it
    // places brand and destinations at opposite ends. The visual half is a review concern.
    const { container } = render(
      <AppFrame>
        <AppFrame.Nav brand={<span>Precision Outbound</span>}>
          <span>Campaigns</span>
        </AppFrame.Nav>
        <AppFrame.Header>
          <span>page header</span>
        </AppFrame.Header>
      </AppFrame>,
    );
    const nav = container.querySelector("nav");
    const header = container.querySelector("header");
    expect(nav).toBeTruthy();
    expect(header).toBeTruthy();
    expect(nav?.contains(header as Node)).toBe(false);
    expect(screen.getByText("Precision Outbound")).toBeTruthy();
    expect(screen.getByText("Campaigns")).toBeTruthy();
  });

  it("holds the brand slot open so the destinations stay at the end when there is no brand", () => {
    // `justify-content: space-between` with one child pushes it to the START, so an app with
    // no brand would find its nav jumping to the left edge. The empty spacer is what keeps
    // one bar's geometry stable across apps that differ only in whether they have a mark.
    const { container } = render(
      <AppFrame>
        <AppFrame.Nav>
          <span>Campaigns</span>
        </AppFrame.Nav>
      </AppFrame>,
    );
    const row = container.querySelector("nav > div") as HTMLElement;
    expect(row.children).toHaveLength(2);
  });
});
