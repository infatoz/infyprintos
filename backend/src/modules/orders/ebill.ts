import { writeDocumentPdf, businessFromOrg, linesFromItems, partyFromSnapshot, type PdfKind } from "../../common/pdf";
import { nextNumber } from "../../common/numbering";
import { Organization } from "../../models/Organization";
import { Invoice } from "../../models/Finance";
import type { AuthUser } from "../../middleware/auth";

type OrderLike = {
  _id: unknown;
  number: string;
  status: string;
  notes?: string;
  dueDate?: Date;
  createdAt?: Date;
  paymentMethod?: string;
  taxInclusive?: boolean;
  customerId?: unknown;
  customerSnapshot?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  totals?: Record<string, number>;
};

export async function renderOrderBillPdf(order: OrderLike, organizationId: string, kind: PdfKind, filename: string) {
  const org = await Organization.findById(organizationId);
  const invoice = await Invoice.findOne({ orderId: order._id, deletedAt: null });
  return writeDocumentPdf({
    kind,
    number: invoice?.number || order.number,
    business: businessFromOrg(org),
    customer: partyFromSnapshot(order.customerSnapshot),
    items: linesFromItems(order.items),
    totals: {
      subtotal: Number(order.totals?.subtotal ?? 0),
      itemDiscountTotal: Number(order.totals?.itemDiscountTotal ?? 0),
      orderDiscount: Number(order.totals?.orderDiscount ?? 0),
      taxableValue: Number(order.totals?.taxableValue ?? 0),
      cgst: Number(order.totals?.cgst ?? 0),
      sgst: Number(order.totals?.sgst ?? 0),
      igst: Number(order.totals?.igst ?? 0),
      taxTotal: Number(order.totals?.taxTotal ?? 0),
      additionalCharges: Number(order.totals?.additionalCharges ?? 0),
      deliveryCharges: Number(order.totals?.deliveryCharges ?? 0),
      roundOff: Number(order.totals?.roundOff ?? 0),
      grandTotal: Number(order.totals?.grandTotal ?? 0),
      paidAmount: Number(order.totals?.paidAmount ?? 0),
      balanceDue: Number(order.totals?.balanceDue ?? 0)
    },
    notes: order.notes,
    footer: org?.invoiceFooter || org?.invoiceNotes || undefined,
    meta: {
      date: invoice?.eBillIssuedAt || invoice?.createdAt || order.createdAt,
      dueDate: order.dueDate,
      orderNumber: order.number,
      paymentMethod: order.paymentMethod,
      taxInclusive: order.taxInclusive,
      placeOfSupply: org?.address?.state
    },
    filename
  });
}

export async function issueOrderEBill(user: AuthUser, order: OrderLike) {
  if (!["delivered", "completed"].includes(String(order.status))) return null;
  let invoice = await Invoice.findOne({ orderId: order._id, organizationId: user.organizationId, deletedAt: null });
  if (!invoice) {
    const org = await Organization.findById(user.organizationId);
    const invNo = await nextNumber(org!._id, "invoice", org?.invoicePrefix ?? "INV", 5);
    invoice = await Invoice.create({
      organizationId: user.organizationId,
      number: invNo,
      type: "tax_invoice",
      orderId: order._id,
      customerId: order.customerId,
      snapshot: { customer: order.customerSnapshot, items: order.items, totals: order.totals },
      totals: order.totals,
      dueDate: order.dueDate,
      status: Number(order.totals?.balanceDue ?? 0) <= 0 ? "paid" : Number(order.totals?.paidAmount ?? 0) > 0 ? "partial" : "issued"
    });
  }
  if (invoice.eBillIssuedAt && invoice.eBillPdfUrl) return invoice;
  const pdf = await renderOrderBillPdf(order, user.organizationId, "ebill", `ebill-${invoice.number}.pdf`);
  invoice.eBillIssuedAt = new Date();
  invoice.eBillPdfUrl = pdf.url;
  invoice.pdfUrl = invoice.pdfUrl || pdf.url;
  await invoice.save();
  return invoice;
}
