import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  isCommissionCompleted,
  isoDay,
  PAYMENT_STATUS_STYLE,
  paymentSummary,
  round2,
} from "./commissionHelpers";
import {
  getAllPayments,
  getCommissions,
  getTemplateStages,
  getTemplates,
  type Commission,
  type CommissionPayment,
  type TemplateStage,
} from "./database";

type Cell = string | number | null;

/**
 * Semicolon and decimal comma: what Spanish Excel opens correctly
 * (with commas as separator everything lands in one column).
 */
const SEPARATOR = ";";

function cell(value: Cell): string {
  if (value === null || value === "") {
    return "";
  }

  if (typeof value === "number") {
    return round2(value).toFixed(2).replace(".", ",");
  }

  // A cell starting with = + - @ would run as a formula when opened in Excel
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(cell).join(SEPARATOR)).join("\r\n") + "\r\n";
}

type Data = {
  commissions: Commission[];
  payments: CommissionPayment[];
  templates: { id: number; name: string }[];
  stages: Record<number, TemplateStage[]>;
};

const paymentsOf = (data: Data, commissionId: number) =>
  data.payments.filter((payment) => payment.commission_id === commissionId);

/** One row per commission. */
export function buildCommissionsCsv(data: Data): string {
  const rows = data.commissions.map((commission) => {
    const payments = paymentsOf(data, commission.id);
    const summary = paymentSummary(commission.price, payments);
    const stageName = data.stages[commission.template_id ?? -1]?.find((stage) => stage.id === commission.current_stage_id)?.name;

    return [
      commission.title,
      commission.client_name,
      commission.platform,
      data.templates.find((template) => template.id === commission.template_id)?.name ?? "",
      stageName ?? "",
      isCommissionCompleted(commission, data.stages)
        ? "Finished"
        : commission.current_stage_id === null
          ? "Queue"
          : "In progress",
      commission.price,
      commission.currency ?? "EUR",
      // What the client paid, tips included
      round2(summary.paid + summary.tips),
      // Received and fees only count on payments where you entered it
      payments.some((payment) => payment.received !== null) ? summary.received : null,
      payments.some((payment) => payment.received !== null) ? summary.fees : null,
      PAYMENT_STATUS_STYLE[summary.status].label,
      isoDay(new Date(commission.created_at)),
      commission.deadline,
    ];
  });

  return toCsv(
    ["Title", "Client", "Platform", "Type", "Stage", "Status", "Price", "Currency", "Client paid", "Received", "Fees", "Payment status", "Accepted", "Deadline"],
    rows,
  );
}

/** One row per payment, in its commission's currency. */
export function buildPaymentsCsv(data: Data): string {
  const rows = [...data.payments]
    .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
    .map((payment) => {
      const commission = data.commissions.find((item) => item.id === payment.commission_id);

      return [
        payment.paid_at,
        commission?.title ?? "",
        commission?.client_name ?? "",
        commission?.currency ?? "EUR",
        payment.amount,
        payment.received,
        payment.received === null ? null : payment.amount - payment.received,
        payment.note,
      ];
    });

  return toCsv(["Date", "Commission", "Client", "Currency", "Client paid", "Received", "Fees", "Note"], rows);
}

/** "2026-10-06" → "2026-Q4" */
export function quarterOf(day: string): string {
  return `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`;
}

/**
 * Payments grouped by quarter and currency (currencies are never added together),
 * by the day they were received.
 */
export function buildQuarterlyCsv(data: Data): string {
  const groups = new Map<string, { quarter: string; currency: string; payments: CommissionPayment[] }>();

  for (const payment of data.payments) {
    const currency = data.commissions.find((item) => item.id === payment.commission_id)?.currency ?? "EUR";
    const quarter = quarterOf(payment.paid_at);
    const key = `${quarter}|${currency}`;

    groups.set(key, groups.get(key) ?? { quarter, currency, payments: [] });
    groups.get(key)!.payments.push(payment);
  }

  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const summary = paymentSummary(null, group.payments);

      return [
        group.quarter,
        group.currency,
        String(group.payments.length),
        round2(summary.paid + summary.tips),
        summary.received,
        summary.fees,
        String(summary.pendingReceived),
      ];
    });

  return toCsv(["Quarter", "Currency", "Payments", "Client paid", "Received", "Fees", "Payments without 'received'"], rows);
}

export type ExportKind = "commissions" | "payments" | "quarterly";

/** Asks where to save and writes the CSV. Returns the path, or null if cancelled. */
export async function exportCsv(kind: ExportKind): Promise<string | null> {
  const [commissions, payments, templates] = await Promise.all([getCommissions(), getAllPayments(), getTemplates()]);
  const stages = Object.fromEntries(
    await Promise.all(templates.map(async (template) => [template.id, await getTemplateStages(template.id)] as const)),
  );
  const data = { commissions, payments, templates, stages };

  const csv =
    kind === "commissions" ? buildCommissionsCsv(data) : kind === "payments" ? buildPaymentsCsv(data) : buildQuarterlyCsv(data);

  const path = await save({
    defaultPath: `zeeboard-${kind}-${isoDay(new Date())}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });

  if (!path) {
    return null;
  }

  // The leading BOM makes Excel read accents and the ñ correctly
  await invoke("write_text_file", { path, contents: `﻿${csv}` });

  return path;
}
