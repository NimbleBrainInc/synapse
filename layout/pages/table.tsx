/**
 * The page the layout suite drives: the kit's `Table`, from source, mounted in a container
 * whose width the suite sets. Everything the suite measures is read off the real DOM;
 * this page only renders and exposes a way to re-render.
 */

import { createRoot } from "react-dom/client";
import { Badge } from "../../src/ui/components/Badge.js";
import { type Column, Table } from "../../src/ui/components/Table.js";
import { DEALS, type Deal, formatAmount, formatWinRate } from "./table-fixture.js";

const stageTone = { Won: "success", Open: "accent", Lost: "danger" } as const;

/** One long truncating primary column, a badge, numbers, a timestamp, and an action. */
export const COLUMNS: Column<Deal>[] = [
  { key: "name", header: "Deal", width: 160, render: (d) => d.name },
  {
    key: "stage",
    header: "Stage",
    priority: 2,
    render: (d) => <Badge tone={stageTone[d.stage]}>{d.stage}</Badge>,
  },
  { key: "owner", header: "Owner", priority: 3, render: (d) => d.owner },
  {
    key: "amount",
    header: "Amount",
    priority: 1,
    align: "right",
    render: formatAmount,
  },
  { key: "deals", header: "Open deals", priority: 5, align: "right", render: (d) => d.deals },
  {
    key: "winRate",
    header: "Win rate",
    priority: 4,
    align: "right",
    render: formatWinRate,
  },
  { key: "updated", header: "Last updated", priority: 6, render: (d) => d.updated },
  {
    key: "actions",
    header: "",
    label: "Actions",
    render: () => <button type="button">Open</button>,
  },
];

const host = document.getElementById("host") as HTMLElement;
const root = createRoot(host);

interface MountOptions {
  minWidth?: number;
}

function render(opts: MountOptions = {}) {
  root.render(
    <Table
      data={DEALS}
      columns={COLUMNS}
      rowKey={(d) => d.id}
      minWidth={opts.minWidth}
      aria-label="Deals"
    />,
  );
}

declare global {
  interface Window {
    __layout: { render: (opts?: MountOptions) => void; ready: boolean };
  }
}

window.__layout = { render, ready: false };
render();
// Two frames: the first commit, then whatever the fit settles on before the next paint.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    window.__layout.ready = true;
  }),
);
