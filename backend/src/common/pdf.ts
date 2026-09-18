import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { env } from "../config/env";
import { amountInIndianWords } from "./money";
import { APP_NAME } from "./brand";

const INK = "#111111";
const MUTED = "#555555";
const LINE = "#222222";
const HAIR = "#CCCCCC";
const LEFT = 36;
const RIGHT = 559;
const WIDTH = RIGHT - LEFT;
const BOTTOM = 28;
const PAGE_TOP = 28;

export type PdfKind = "quotation" | "invoice" | "receipt" | "ebill";

export type PdfLine = {
  name?: string | null;
  sku?: string | null;
  variantName?: string | null;
  description?: string | null;
  hsn?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  taxRate?: number | null;
  lineTotal?: number | null;
};

export type PdfTotals = {
  subtotal: number;
  itemDiscountTotal?: number;
  orderDiscount?: number;
  taxableValue?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  taxTotal?: number;
  additionalCharges?: number;
  deliveryCharges?: number;
  roundOff?: number;
  grandTotal: number;
  paidAmount?: number;
  balanceDue?: number;
};

export type PdfBusiness = {
  name?: string | null;
  legalName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    country?: string | null;
  } | null;
};

export type PdfParty = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  code?: string | null;
  businessName?: string | null;
};

export type PdfMeta = {
  date?: Date | string | null;
  dueDate?: Date | string | null;
  validUntil?: Date | string | null;
  orderNumber?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidAt?: Date | string | null;
  placeOfSupply?: string | null;
  taxInclusive?: boolean;
};

function money(value?: number | null) {
  return `Rs ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0))}`;
}

function fmtDay(value?: Date | string | null) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

function joinAddress(address?: PdfBusiness["address"]) {
  if (!address) return "";
  return [address.line1, address.line2, [address.city, address.state].filter(Boolean).join(", "), address.pincode]
    .filter((p) => p && String(p).trim())
    .join(", ");
}

function kindLabel(kind: PdfKind) {
  if (kind === "ebill") return "E-BILL";
  if (kind === "invoice") return "TAX INVOICE";
  if (kind === "receipt") return "RECEIPT";
  return "QUOTATION";
}

export function businessFromOrg(
  org:
    | {
        name?: string | null;
        legalName?: string | null;
        gstin?: string | null;
        pan?: string | null;
        phone?: string | null;
        email?: string | null;
        website?: string | null;
        logoUrl?: string | null;
        address?: PdfBusiness["address"];
      }
    | null
    | undefined
): PdfBusiness {
  if (!org) return { name: APP_NAME };
  return {
    name: org.name,
    legalName: org.legalName,
    gstin: org.gstin,
    pan: org.pan,
    phone: org.phone,
    email: org.email,
    website: org.website,
    logoUrl: org.logoUrl,
    address: org.address
  };
}

export function partyFromSnapshot(snap: PdfParty | null | undefined): PdfParty {
  return {
    name: snap?.name,
    phone: snap?.phone,
    email: snap?.email,
    gstin: snap?.gstin,
    code: snap?.code,
    businessName: snap?.businessName
  };
}

export function linesFromItems(items: Array<Record<string, unknown> | PdfLine> | undefined): PdfLine[] {
  return (items ?? []).map((raw) => {
    const i = raw as PdfLine & { snapshot?: { hsn?: string } };
    return {
      name: i.name,
      sku: i.sku,
      variantName: i.variantName,
      description: i.description,
      hsn: i.hsn || i.snapshot?.hsn,
      quantity: i.quantity,
      unit: i.unit || "Nos",
      unitPrice: i.unitPrice,
      taxRate: i.taxRate,
      lineTotal: i.lineTotal
    };
  });
}

function localLogoPath(logoUrl?: string | null) {
  if (!logoUrl) return "";
  const rel = logoUrl.startsWith("/uploads/") ? logoUrl.replace(/^\/uploads\//, "") : "";
  if (!rel) return "";
  const filePath = path.resolve(env.uploadDir, rel);
  return fs.existsSync(filePath) ? filePath : "";
}

function fits(doc: PDFKit.PDFDocument, y: number, need: number) {
  return y + need <= doc.page.height - BOTTOM;
}

function ensureRoom(doc: PDFKit.PDFDocument, y: number, need: number) {
  if (fits(doc, y, need)) return y;
  doc.addPage();
  return PAGE_TOP;
}

export async function writeDocumentPdf(opts: {
  kind?: PdfKind;
  title?: string;
  number: string;
  business: PdfBusiness;
  customer: PdfParty;
  items: PdfLine[];
  totals: PdfTotals;
  notes?: string;
  terms?: string;
  footer?: string;
  meta?: PdfMeta;
  filename: string;
}): Promise<{ filePath: string; url: string }> {
  const kind: PdfKind =
    opts.kind ??
    (opts.title?.toLowerCase().includes("e-bill") || opts.title?.toLowerCase().includes("ebill")
      ? "ebill"
      : opts.title?.toLowerCase().includes("receipt")
        ? "receipt"
        : opts.title?.toLowerCase().includes("invoice")
          ? "invoice"
          : "quotation");
  const dir = path.resolve(env.uploadDir, "docs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, opts.filename);
  const doc = new PDFDocument({
    size: "A4",
    margin: 28,
    bufferPages: true,
    info: { Title: `${kindLabel(kind)} ${opts.number}`, Author: opts.business.name || APP_NAME }
  });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const shop = opts.business.name || APP_NAME;
  let y = PAGE_TOP;
  const logo = localLogoPath(opts.business.logoUrl);
  if (logo) {
    try {
      doc.image(logo, LEFT, y, { fit: [28, 28] });
    } catch {
      /* skip */
    }
  }
  const nameX = logo ? LEFT + 34 : LEFT;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(shop, nameX, y, { width: 300 });
  y = Math.max(doc.y, y + 14);
  if (opts.business.legalName && opts.business.legalName !== shop) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(opts.business.legalName, nameX, y, { width: 300 });
    y = doc.y;
  }
  const addr = joinAddress(opts.business.address);
  if (addr) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(addr, nameX, y, { width: 300 });
    y = doc.y;
  }
  const contact = [opts.business.phone, opts.business.email, opts.business.gstin ? `GSTIN ${opts.business.gstin}` : "", opts.business.pan ? `PAN ${opts.business.pan}` : ""]
    .filter(Boolean)
    .join("  |  ");
  if (contact) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(contact, nameX, y, { width: 300 });
    y = doc.y;
  }

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(kindLabel(kind), 360, PAGE_TOP, { width: 199, align: "right" });
  doc.fillColor(INK).font("Helvetica").fontSize(9).text(opts.number, 360, PAGE_TOP + 16, { width: 199, align: "right" });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Date: ${fmtDay(opts.meta?.date)}`, 360, PAGE_TOP + 30, { width: 199, align: "right" });
  y = Math.max(y, PAGE_TOP + 44);

  y += 8;
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(LINE).stroke();
  y += 8;

  const billName = opts.customer.businessName || opts.customer.name || "Walk-in";
  const billBits = [opts.customer.code, opts.customer.phone, opts.customer.gstin ? `GSTIN ${opts.customer.gstin}` : ""].filter(Boolean).join("  |  ");
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(kind === "receipt" ? "RECEIVED FROM" : "BILL TO", LEFT, y);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(billName, LEFT, y + 11, { width: 280 });
  if (billBits) doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(billBits, LEFT, y + 24, { width: 280 });

  const rightBits = [
    opts.meta?.orderNumber && opts.meta.orderNumber !== opts.number ? `Order: ${opts.meta.orderNumber}` : "",
    kind === "quotation" && opts.meta?.validUntil ? `Valid: ${fmtDay(opts.meta.validUntil)}` : "",
    (kind === "invoice" || kind === "ebill") && opts.meta?.dueDate ? `Due: ${fmtDay(opts.meta.dueDate)}` : "",
    opts.meta?.paymentMethod ? `Tender: ${String(opts.meta.paymentMethod).replaceAll("_", " ")}` : "",
    opts.meta?.paymentReference ? `Ref: ${opts.meta.paymentReference}` : "",
    opts.meta?.placeOfSupply ? `POS: ${opts.meta.placeOfSupply}` : opts.business.address?.state ? `POS: ${opts.business.address.state}` : ""
  ].filter(Boolean);
  doc.fillColor(INK).font("Helvetica").fontSize(8).text(rightBits.join("\n") || " ", 360, y, { width: 199, align: "right", lineGap: 1 });
  y = Math.max(y + 40, doc.y) + 6;

  if (kind === "receipt") {
    doc.rect(LEFT, y, WIDTH, 28).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("AMOUNT RECEIVED", LEFT + 8, y + 8);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(money(opts.totals.grandTotal || opts.totals.paidAmount), LEFT + 200, y + 7, {
      width: WIDTH - 210,
      align: "right"
    });
    y += 36;
  }

  if (opts.items.length) {
    const cols = [
      { key: "no", x: LEFT, w: 22, label: "#" },
      { key: "desc", x: LEFT + 22, w: 248, label: "Particulars" },
      { key: "qty", x: LEFT + 270, w: 46, label: "Qty", align: "right" as const },
      { key: "rate", x: LEFT + 316, w: 90, label: "Rate", align: "right" as const },
      { key: "amt", x: LEFT + 406, w: 117, label: "Amount", align: "right" as const }
    ];
    const drawHead = (at: number) => {
      doc.moveTo(LEFT, at).lineTo(RIGHT, at).lineWidth(0.7).strokeColor(LINE).stroke();
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(8);
      for (const col of cols) {
        doc.text(col.label, col.x + 3, at + 4, { width: col.w - 6, align: col.align ?? "left" });
      }
      doc.moveTo(LEFT, at + 16).lineTo(RIGHT, at + 16).stroke();
      return at + 18;
    };
    y = drawHead(y);
    opts.items.forEach((line, idx) => {
      const title = [line.name, line.variantName].filter(Boolean).join(" / ") || "Item";
      const sub = [line.sku, line.hsn ? `HSN ${line.hsn}` : "", line.taxRate != null ? `GST ${Number(line.taxRate)}%` : ""].filter(Boolean).join("  ·  ");
      doc.font("Helvetica").fontSize(8);
      const descH = doc.heightOfString(title, { width: 240 }) + (sub ? 9 : 0);
      const rowH = Math.max(16, descH + 4);
      const prevY = y;
      y = ensureRoom(doc, y, rowH + 2);
      if (y < prevY) y = drawHead(y);
      doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(String(idx + 1), cols[0].x + 3, y + 2, { width: cols[0].w - 6 });
      doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(title, cols[1].x + 3, y + 2, { width: cols[1].w - 6 });
      if (sub) doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(sub, cols[1].x + 3, y + 12, { width: cols[1].w - 6 });
      doc.fillColor(INK).font("Helvetica").fontSize(8);
      doc.text(`${line.quantity ?? 0}`, cols[2].x + 3, y + 2, { width: cols[2].w - 6, align: "right" });
      doc.text(money(line.unitPrice), cols[3].x + 3, y + 2, { width: cols[3].w - 6, align: "right" });
      doc.font("Helvetica-Bold").text(money(line.lineTotal), cols[4].x + 3, y + 2, { width: cols[4].w - 6, align: "right" });
      y += rowH;
    });
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.7).strokeColor(LINE).stroke();
    y += 8;
  }

  const rows: Array<[string, number | undefined, boolean]> = [
    ["Subtotal", opts.totals.subtotal, false],
    ["Item discount", opts.totals.itemDiscountTotal, false],
    ["Discount", opts.totals.orderDiscount, false],
    ["Taxable", opts.totals.taxableValue, false],
    ["CGST", opts.totals.cgst, false],
    ["SGST", opts.totals.sgst, false],
    ["IGST", opts.totals.igst, false],
    ["Delivery", opts.totals.deliveryCharges, false],
    ["Other charges", opts.totals.additionalCharges, false],
    ["Round off", opts.totals.roundOff, false],
    ["Total", opts.totals.grandTotal, true],
    ["Received", opts.totals.paidAmount, false],
    ["Balance", opts.totals.balanceDue, kind === "invoice" || kind === "ebill"]
  ];
  const visible = rows.filter(([label, value, force]) => force || label === "Total" || (value != null && value !== 0));
  const totalsH = visible.length * 12 + 4;
  y = ensureRoom(doc, y, totalsH + 22);
  const totX = 330;
  let ty = y;
  for (const [label, value, emph] of visible) {
    if (value == null) continue;
    doc.font(emph ? "Helvetica-Bold" : "Helvetica").fontSize(emph ? 10 : 8).fillColor(emph ? INK : MUTED);
    doc.text(label, totX, ty, { width: 90 });
    doc.fillColor(INK).text(money(value), totX + 90, ty, { width: 139, align: "right" });
    ty += 12;
  }
  doc.moveTo(totX, ty - visible.length * 12 - 2).lineTo(RIGHT, ty - visible.length * 12 - 2).lineWidth(0.4).strokeColor(HAIR).stroke();
  y = Math.max(y + 4, ty + 6);

  if (fits(doc, y, 18)) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text("In words", LEFT, y);
    doc.fillColor(INK).font("Helvetica").fontSize(8).text(amountInIndianWords(opts.totals.grandTotal || opts.totals.paidAmount || 0), LEFT, y + 10, {
      width: WIDTH
    });
    y = doc.y + 6;
  }

  const extra = [opts.notes, opts.terms, opts.footer].filter((s) => s && String(s).trim()) as string[];
  for (const block of extra) {
    const clip = block.length > 280 ? `${block.slice(0, 277)}…` : block;
    doc.font("Helvetica").fontSize(8);
    const h = doc.heightOfString(clip, { width: WIDTH }) + 4;
    if (!fits(doc, y, h)) break;
    doc.fillColor(MUTED).text(clip, LEFT, y, { width: WIDTH });
    y = doc.y + 4;
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7);
    const foot = range.count > 1 ? `Page ${i + 1} of ${range.count}  ·  Computer generated bill` : "E. & O.E.  ·  Computer generated bill";
    doc.text(foot, LEFT, doc.page.height - 22, { width: WIDTH, align: "center" });
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  return { filePath, url: `/uploads/docs/${opts.filename}` };
}
