/**
 * The rows the layout suite renders, and the text each column shows for them. Shared by the
 * page (which renders it) and the runner (which looks for a hidden column's value in its row).
 */

export interface Deal {
  id: string;
  name: string;
  stage: "Won" | "Open" | "Lost";
  owner: string;
  amount: number;
  deals: number;
  winRate: number;
  updated: string;
}

const NAMES = [
  "Northwind Logistics — fleet telematics renewal and expansion into three new regions",
  "Contoso Retail — point-of-sale migration",
  "Fabrikam Manufacturing — predictive maintenance pilot for the second assembly line",
  "Tailspin Toys — seasonal demand forecasting",
  "Wide World Importers — customs document automation",
  "Adventure Works — dealer portal",
];
const STAGES: Deal["stage"][] = ["Won", "Open", "Lost"];
const OWNERS = ["Jordan Ratner", "Priya Nair", "Sam Okoye", "Alex Kim"];

export const DEALS: Deal[] = NAMES.map((name, i) => ({
  id: `d${i}`,
  name,
  stage: STAGES[i % STAGES.length] as Deal["stage"],
  owner: OWNERS[i % OWNERS.length] as string,
  amount: 12_500 * (i + 3) + 999,
  deals: 4 + i * 7,
  winRate: 0.21 + i * 0.09,
  updated: `2026-10-${String(10 + i).padStart(2, "0")} 14:3${i}`,
}));

export const formatAmount = (d: Deal) => `$${d.amount.toLocaleString("en-US")}`;
export const formatWinRate = (d: Deal) => `${Math.round(d.winRate * 100)}%`;

/** The text each droppable column renders, per row. */
export const DEAL_VALUES = DEALS.map((d) => ({
  stage: d.stage,
  owner: d.owner,
  amount: formatAmount(d),
  deals: String(d.deals),
  winRate: formatWinRate(d),
  updated: d.updated,
  actions: "Open",
}));
