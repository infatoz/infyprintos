import type { ReactNode } from "react";
import { inr, fmtDay, cn } from "@/lib/cn";
import { APP_NAME } from "@/lib/brand";

export type DocKind = "quotation" | "invoice" | "receipt" | "ebill";

export type DocLine = {
  name?: string;
  variantName?: string;
  sku?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  taxRate?: number;
  lineTotal?: number;
};

export type DocTotals = {
  subtotal?: number;
  itemDiscountTotal?: number;
  orderDiscount?: number;
  taxableValue?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  additionalCharges?: number;
  deliveryCharges?: number;
  roundOff?: number;
  grandTotal?: number;
  paidAmount?: number;
  balanceDue?: number;
};

export type DocBusiness = {
  name?: string | null;
  legalName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  address?: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string; country?: string } | null;
  invoiceFooter?: string | null;
  invoiceNotes?: string | null;
};

export type DocParty = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  code?: string | null;
  businessName?: string | null;
};

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  if (n <= 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${belowThousand(rest)}` : ""}`;
}

function amountWords(value?: number) {
  const abs = Math.round(Math.abs(Number(value) || 0) * 100) / 100;
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);
  if (!rupees && !paise) return "Zero Rupees Only";
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const hundred = rupees % 1_000;
  const parts: string[] = [];
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (hundred) parts.push(belowThousand(hundred));
  let out = rupees ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  if (paise) out += ` And ${belowThousand(paise)} Paise`;
  return `${out} Only`;
}

function kindLabel(kind: DocKind) {
  if (kind === "ebill") return "E-Bill";
  if (kind === "invoice") return "Tax invoice";
  if (kind === "receipt") return "Receipt";
  return "Quotation";
}

export function DocumentSheet({
  kind,
  number,
  business,
  customer,
  items,
  totals,
  notes,
  terms,
  footer,
  date,
  dueDate,
  validUntil,
  orderNumber,
  paymentMethod,
  paymentReference,
  paidAt,
  status,
  actions
}: {
  kind: DocKind;
  number: string;
  business?: DocBusiness | null;
  customer?: DocParty | null;
  items?: DocLine[];
  totals?: DocTotals | null;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
  date?: string | Date | null;
  dueDate?: string | Date | null;
  validUntil?: string | Date | null;
  orderNumber?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidAt?: string | Date | null;
  status?: string;
  actions?: ReactNode;
}) {
  const addr = [
    business?.address?.line1,
    business?.address?.line2,
    [business?.address?.city, business?.address?.state].filter(Boolean).join(", "),
    business?.address?.pincode
  ].filter(Boolean);
  const rows: Array<[string, number | undefined]> = [
    ["Subtotal", totals?.subtotal],
    ["Item discount", totals?.itemDiscountTotal],
    ["Discount", totals?.orderDiscount],
    ["Taxable", totals?.taxableValue],
    ["CGST", totals?.cgst],
    ["SGST", totals?.sgst],
    ["IGST", totals?.igst],
    ["Delivery", totals?.deliveryCharges],
    ["Other charges", totals?.additionalCharges],
    ["Round off", totals?.roundOff],
    ["Total", totals?.grandTotal],
    ["Received", totals?.paidAmount],
    ["Balance", totals?.balanceDue]
  ];
  const shown = rows.filter(([label, value]) => label === "Total" || (value != null && value !== 0));
  const metaBits = [
    validUntil ? `Valid ${fmtDay(validUntil)}` : "",
    dueDate ? `Due ${fmtDay(dueDate)}` : "",
    orderNumber && orderNumber !== number ? `Order ${orderNumber}` : "",
    paymentMethod ? `Tender ${paymentMethod.replaceAll("_", " ")}` : "",
    paymentReference ? `Ref ${paymentReference}` : "",
    paidAt ? `Paid ${fmtDay(paidAt)}` : "",
    business?.address?.state ? `POS ${business.address.state}` : ""
  ].filter(Boolean);

  return (
    <article className="doc-sheet overflow-hidden rounded-lg border border-line bg-surface print:border-0 print:shadow-none">
      {actions ? <div className="flex flex-wrap justify-end gap-2 border-b border-line px-4 py-3 print:hidden">{actions}</div> : null}
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <header className="flex flex-col gap-3 border-b border-ink/80 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-tight">{business?.name || APP_NAME}</p>
            {business?.legalName && business.legalName !== business.name ? <p className="text-[11px] text-muted">{business.legalName}</p> : null}
            {addr.length ? <p className="mt-1 max-w-sm text-[11px] leading-snug text-muted">{addr.join(", ")}</p> : null}
            <p className="mt-1 text-[11px] text-muted">
              {[business?.phone, business?.gstin ? `GSTIN ${business.gstin}` : "", business?.pan ? `PAN ${business.pan}` : ""].filter(Boolean).join("  |  ")}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{kindLabel(kind)}</p>
            <p className="mt-1 font-mono text-[14px] font-semibold">{number}</p>
            <p className="mt-0.5 text-[12px] text-muted">Date {fmtDay(date)}</p>
            {status ? <p className="text-[11px] capitalize text-muted">{status.replaceAll("_", " ")}</p> : null}
          </div>
        </header>

        <div className="mt-3 flex flex-col gap-2 text-[12px] sm:flex-row sm:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted">{kind === "receipt" ? "Received from" : "Bill to"}</p>
            <p className="mt-0.5 font-semibold">{customer?.businessName || customer?.name || "—"}</p>
            <p className="text-muted">
              {[customer?.code, customer?.phone, customer?.gstin ? `GSTIN ${customer.gstin}` : ""].filter(Boolean).join("  |  ") || "—"}
            </p>
          </div>
          {metaBits.length ? <p className="max-w-xs text-muted sm:text-right">{metaBits.join(" · ")}</p> : null}
        </div>

        {kind === "receipt" ? (
          <div className="mt-3 flex items-baseline justify-between border border-ink/70 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-muted">Amount received</span>
            <span className="font-mono text-[18px] font-semibold">{inr(totals?.grandTotal ?? totals?.paidAmount)}</span>
          </div>
        ) : null}

        {items?.length ? (
          <table className="mt-3 w-full text-[13px]">
            <thead>
              <tr className="border-y border-ink/80 text-left text-[10px] font-semibold uppercase tracking-wide">
                <th className="py-1.5 pr-2">#</th>
                <th className="py-1.5 pr-2">Particulars</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">Rate</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line, i) => (
                <tr key={`${line.name}-${i}`} className="border-b border-line">
                  <td className="py-1.5 pr-2 text-muted">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <div>{[line.name, line.variantName].filter(Boolean).join(" / ")}</div>
                    {line.sku || line.taxRate != null ? (
                      <div className="text-[11px] text-muted">
                        {[line.sku, line.taxRate != null ? `GST ${line.taxRate}%` : ""].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {line.quantity}
                    {line.unit ? ` ${line.unit}` : ""}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-[12px]">{inr(line.unitPrice)}</td>
                  <td className="py-1.5 text-right font-mono text-[12px] font-medium">{inr(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-sm text-[11px] leading-relaxed text-muted">
            <span className="block uppercase tracking-wide">In words</span>
            <span className="mt-0.5 block text-ink">{amountWords(totals?.grandTotal ?? totals?.paidAmount)}</span>
          </p>
          <dl className="w-full max-w-[220px] space-y-1 text-[13px] sm:ml-auto">
            {shown.map(([label, value]) => (
              <div key={label} className={cn("flex justify-between gap-6", label === "Total" && "border-t border-ink/80 pt-1.5 font-semibold")}>
                <dt className="text-muted">{label}</dt>
                <dd className="font-mono tabular-nums">{inr(value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        {notes ? <p className="mt-3 text-[11px] text-muted">{notes}</p> : null}
        {terms ? <p className="mt-1 text-[11px] text-muted">{terms}</p> : null}
        {footer || business?.invoiceFooter || business?.invoiceNotes ? (
          <p className="mt-2 text-[11px] text-muted">{footer || business?.invoiceFooter || business?.invoiceNotes}</p>
        ) : null}
        <p className="mt-3 text-center text-[10px] text-muted">E. &amp; O.E. · Computer generated bill</p>
      </div>
    </article>
  );
}
