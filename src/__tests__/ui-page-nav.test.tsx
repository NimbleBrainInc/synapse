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
import { PageLayout } from "../ui/layouts/PageLayout.js";
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

  it("does not wrap a table that declared no floor", () => {
    // No floor means no scroller, and the sticky header survives. The pair is one decision.
    const { container } = render(
      <Table
        data={rows}
        rowKey={(r) => r.id}
        columns={[{ key: "name", header: "Name", render: (r) => r.name }]}
      />,
    );
    expect(container.firstElementChild?.tagName).toBe("TABLE");
  });

  it("wraps a table that declared a floor, so the page never scrolls sideways", () => {
    // A floor with nothing to scroll inside widens the table past its container and pushes
    // the PAGE sideways — the exact failure the floor is set to prevent. One prop, one
    // behaviour: there is no way to ask for a floor and not get the scroller.
    const { container } = render(
      <Table
        data={rows}
        rowKey={(r) => r.id}
        columns={[{ key: "name", header: "Name", render: (r) => r.name }]}
        minWidth={720}
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.style.overflowX).toBe("auto");
    // Without a max-width the wrapper grows to its content and the scroller never engages.
    expect(wrapper.style.maxWidth).toBe("100%");
    expect(container.querySelector("table")?.style.minWidth).toBe("720px");
    // A scroll container with neither focus nor a focusable descendant cannot be scrolled by
    // keyboard at all, and a read-only table has no focusable descendants — so every column
    // past the right edge would be pointer-only.
    expect(wrapper.tabIndex).toBe(0);
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

  it("moves DOM focus, not just selection", () => {
    // The assertion the old test was missing, and the whole of the bug it missed: selection
    // advanced while focus stayed put, so the focus ring sat on an unselected tab and AT —
    // which announces focus, not aria-selected — said nothing. onChange firing is not
    // evidence that focus moved; only activeElement is.
    render(<Tabs tabs={tabs} value="recipients" onChange={() => {}} />);
    const selected = screen.getByRole("tab", { name: "Recipients" });
    selected.focus();
    expect(document.activeElement).toBe(selected);

    selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Activity" }));
  });

  it("jumps to the first and last tab on Home and End", () => {
    // Three tabs, and the middle one held, so both keys have somewhere to go. With two, End
    // from the last tab targets the tab already selected and the assertion cannot fail.
    const three = [...tabs, { label: "Settings", value: "settings" as const }];
    const onChange = vi.fn();
    render(<Tabs tabs={three} value="activity" onChange={onChange} />);
    const bar = screen.getByRole("tablist");
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith("recipients");
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith("settings");
  });

  it("announces no change when Home or End lands on the tab already held", () => {
    // Arrows cannot do this, because they wrap and always move. Home and End are absolute,
    // so pressed at the ends they used to emit a change event for a value that did not
    // change — which a caller whose onChange refetches or pushes a route has to defend
    // against. Focus still moves, because the key was still pressed.
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="recipients" onChange={onChange} />);
    const first = screen.getByRole("tab", { name: "Recipients" });
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it("runs a caller's key handler AND keeps arrow navigation", () => {
    // Both halves, because there are two ways to get this wrong and they look identical from
    // the caller's side: spreading `rest` after the internal handler replaced navigation
    // outright, and pulling `onKeyDown` out of `rest` without composing it dropped the
    // caller's handler instead. `onKeyDown` is in this component's public prop type, so
    // either one is a prop accepted and silently ignored.
    const onChange = vi.fn();
    const callerKeyDown = vi.fn();
    render(<Tabs tabs={tabs} value="recipients" onChange={onChange} onKeyDown={callerKeyDown} />);
    screen
      .getByRole("tab", { name: "Recipients" })
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(callerKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("activity");
  });

  it("lets a caller opt out of navigation on purpose, with preventDefault", () => {
    // The escape hatch the old ordering gave by accident, now deliberate and visible at the
    // call site rather than a side effect of prop order.
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        value="recipients"
        onChange={onChange}
        onKeyDown={(e) => e.preventDefault()}
      />,
    );
    screen
      .getByRole("tab", { name: "Recipients" })
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits no global id, so two bars sharing a value cannot collide", () => {
    render(<Tabs tabs={tabs} value="recipients" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Recipients" }).id).toBe("");
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

describe("the header carries no destination slot, by design", () => {
  it("renders the trail alone above the title", () => {
    // Destinations are facets of the app and belong in a Tabs bar under this header, not in
    // a slot beside the trail. A slot there stacked two right-aligned clusters — destinations
    // directly above actions — and made orientation the quieter of the two.
    const { container } = render(
      <PageHeader
        crumbs={[{ label: "Campaigns", onClick: () => {} }, { label: "Blue Ridge" }]}
        title="Blue Ridge"
        actions={<button type="button">Export</button>}
      />,
    );
    const rows = container.querySelectorAll(":scope > header > *");
    // Trail, then the title row. Nothing between them competing for the same corner.
    expect(rows[0].getAttribute("aria-label")).toBe("Breadcrumb");
    expect(rows[1].textContent).toContain("Blue Ridge");
    expect(rows[1].textContent).toContain("Export");
  });

  it("puts the title first when there is nothing above it", () => {
    const { container } = render(<PageHeader title="Precision Outbound" />);
    const first = container.querySelector("header > *") as HTMLElement;
    expect(first.getAttribute("aria-label")).not.toBe("Breadcrumb");
    expect(first.textContent).toContain("Precision Outbound");
  });
});

describe("PageLayout owns the order, which is the whole reason it is a component", () => {
  const parts = {
    title: "Precision Outbound",
    tabs: <div data-testid="tabs">tabs</div>,
    toolbar: <div data-testid="toolbar">toolbar</div>,
    children: <div data-testid="content">content</div>,
  };

  it("puts header, tabs, toolbar and content in that order regardless of prop order", () => {
    // The invariant. An app that assembles these by hand can put the tab bar under the
    // toolbar, or the trail under the title, and nothing stops it — which is exactly what a
    // shipped app did. Passing them as props makes the wrong order unavailable.
    const { container } = render(
      <PageLayout crumbs={[{ label: "Up", onClick: () => {} }, { label: "Here" }]} {...parts} />,
    );
    const order = [...(container.firstElementChild as HTMLElement).children].map((el) =>
      el.tagName === "HEADER"
        ? "header"
        : ((el.querySelector("[data-testid]") ?? el).getAttribute("data-testid") ??
          el.getAttribute("data-testid")),
    );
    expect(order).toEqual(["header", "tabs", "toolbar", "content"]);
  });

  it("keeps the trail above the title inside the header it delegates to", () => {
    render(
      <PageLayout crumbs={[{ label: "Up", onClick: () => {} }, { label: "Here" }]} {...parts} />,
    );
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    const heading = screen.getByText("Precision Outbound");
    // DOCUMENT_POSITION_FOLLOWING: the heading comes after the trail.
    expect(trail.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders nothing for the slots an app does not fill", () => {
    // A top-level screen with no trail, no tabs and no toolbar is still a valid page, and
    // must not leave empty rows shifting the content down.
    const { container } = render(<PageLayout title="Precision Outbound" />);
    const kids = [...(container.firstElementChild as HTMLElement).children];
    expect(kids).toHaveLength(1);
    expect(kids[0].tagName).toBe("HEADER");
  });
});

describe("the scroll wrapper is reachable, and named only when there is a name", () => {
  const rows = [{ id: "1", name: "x" }];
  const columns = [{ key: "name", header: "Name", render: (r: (typeof rows)[0]) => r.name }];

  it("takes the caller's own label rather than a second way of saying it", () => {
    const { container } = render(
      <Table
        data={rows}
        rowKey={(r) => r.id}
        columns={columns}
        minWidth={720}
        aria-label="Records"
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("role")).toBe("region");
    expect(wrapper.getAttribute("aria-label")).toBe("Records");
  });

  it("stays roleless when unnamed, because a region without a name is its own violation", () => {
    const { container } = render(
      <Table data={rows} rowKey={(r) => r.id} columns={columns} minWidth={720} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("role")).toBeNull();
    // Still focusable — reachability does not depend on having been named.
    expect(wrapper.tabIndex).toBe(0);
  });
});

describe("PageLayout scopes its own header, so a page in a page is not two banners", () => {
  it("nests without producing a second banner landmark", () => {
    // `<header>` is the `banner` landmark unless it descends from sectioning content. A page
    // rendered inside a pane of another page — which a list-detail layout does routinely —
    // therefore produced two elements both claiming to head the document. Invisible on
    // screen; visible in the landmark list a screen-reader user navigates by.
    const { container } = render(
      <PageLayout title="Outer">
        <PageLayout title="Inner" />
      </PageLayout>,
    );

    const headers = [...container.querySelectorAll("header")];
    expect(headers).toHaveLength(2);
    // Neither is a banner, because each has a sectioning ancestor. Asserted structurally:
    // happy-dom computes no implicit ARIA role, so the mapping rule is checked directly —
    // `closest` finds the nearest sectioning element, and it must not be the document.
    for (const h of headers) {
      expect(h.closest("section, article, aside, nav, main")).not.toBeNull();
    }
  });

  it("is a section even at the top level, because the host owns the real banner", () => {
    // Not a compromise for the nested case: an embedded app is a section of the host's page,
    // never the document, so its header should not claim `banner` at any depth.
    const { container } = render(<PageLayout title="Only" />);
    expect((container.firstElementChild as HTMLElement).tagName).toBe("SECTION");
  });
});
