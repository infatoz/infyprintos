import { NotificationLog, NotificationTemplate } from "../models/Settings";
import { Customer } from "../models/Customer";
import { Organization } from "../models/Organization";
import { env } from "../config/env";

export type NotifyVars = Record<string, string | number | undefined>;

export type WhatsappShare = {
  logId: string;
  event: string;
  to: string;
  toE164: string;
  body: string;
  waMe: string;
  status: string;
};

export const DEFAULT_WHATSAPP_BODIES: Record<string, string> = {
  customer_created: "Hello {{customer_name}}, welcome to {{business_name}}. Your membership ID is {{membership_id}}.",
  quotation_sent:
    "Hello {{customer_name}},\n\nYour quotation {{quotation_number}} from {{business_name}} is ready for approval.\nTotal: ₹{{grand_total}}\n\nReview here:\n{{approval_link}}",
  order_created: "Hi {{customer_name}}, order {{order_number}} is confirmed. Amount: ₹{{grand_total}}. Thank you for choosing {{business_name}}.",
  order_status: "Hi {{customer_name}}, order {{order_number}} is now {{status_name}}. — {{business_name}}",
  order_cancelled: "Hi {{customer_name}}, order {{order_number}} has been cancelled{{reason_suffix}}. — {{business_name}}",
  design_uploaded: "Hi {{customer_name}}, artwork for order {{order_number}} is ready. Approve here: {{approval_link}}",
  payment_received: "Hi {{customer_name}}, payment of ₹{{amount}} received for {{order_number}}. Thank you! — {{business_name}}",
  order_delivered:
    "Hi {{customer_name}}, your order {{order_number}} has been delivered. E-bill {{invoice_number}} is ready. Total ₹{{grand_total}}. — {{business_name}}"
};

export const DEFAULT_TEMPLATE_DEFS = [
  { event: "customer_created", name: "Customer welcome" },
  { event: "quotation_sent", name: "Quotation approval" },
  { event: "order_created", name: "Order confirmation" },
  { event: "order_status", name: "Order status update" },
  { event: "order_cancelled", name: "Order cancelled" },
  { event: "design_uploaded", name: "Design approval" },
  { event: "payment_received", name: "Payment receipt" },
  { event: "order_delivered", name: "Delivered" }
] as const;

export function renderTemplate(body: string, vars: NotifyVars) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""));
}

export function toWhatsappE164(raw?: string | null) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 10) return `91${d}`;
  return d;
}

export function whatsappMeUrl(to: string, body: string) {
  const e164 = toWhatsappE164(to);
  if (!e164) return "";
  return `https://wa.me/${e164}?text=${encodeURIComponent(body)}`;
}

export function shareFromLog(log: {
  _id: unknown;
  event?: string;
  to?: string;
  body?: string;
  status?: string;
  payload?: { waMe?: string };
}): WhatsappShare {
  const body = log.body ?? "";
  const to = log.to ?? "";
  return {
    logId: String(log._id),
    event: log.event ?? "",
    to,
    toE164: toWhatsappE164(to),
    body,
    waMe: log.payload?.waMe || whatsappMeUrl(to, body),
    status: log.status ?? "queued"
  };
}

export function withWhatsappShare<T extends { toObject?: () => object } | object>(doc: T, log?: { _id: unknown; event?: string; to?: string; body?: string; status?: string; payload?: { waMe?: string } } | null) {
  const base = doc && typeof (doc as { toObject?: () => object }).toObject === "function" ? (doc as { toObject: () => object }).toObject() : doc;
  return { ...(base as object), whatsapp: log ? shareFromLog(log) : undefined };
}

export async function queueNotification(opts: {
  organizationId: string;
  event: string;
  channel?: "whatsapp" | "sms" | "email" | "in_app";
  to: string;
  vars: NotifyVars;
  referenceType?: string;
  referenceId?: string;
}) {
  const channel = opts.channel ?? "whatsapp";
  const template = await NotificationTemplate.findOne({
    organizationId: opts.organizationId,
    event: opts.event,
    channel,
    enabled: true,
    deletedAt: null
  });
  const source = template?.body || DEFAULT_WHATSAPP_BODIES[opts.event] || `${opts.event}`;
  const body = renderTemplate(source, opts.vars);
  const waMe = whatsappMeUrl(opts.to, body);
  const log = await NotificationLog.create({
    organizationId: opts.organizationId,
    event: opts.event,
    channel,
    to: opts.to,
    body,
    status: "queued",
    referenceType: opts.referenceType,
    referenceId: opts.referenceId,
    payload: { vars: opts.vars, waMe, toE164: toWhatsappE164(opts.to), manual: true }
  });
  return log;
}

export async function latestShareFor(organizationId: string, referenceType: string, referenceId: string) {
  return NotificationLog.findOne({ organizationId, referenceType, referenceId, deletedAt: null }).sort("-createdAt");
}

export async function notifyOrderEvent(
  organizationId: string,
  order: {
    _id: unknown;
    number: string;
    status?: string;
    customerId: unknown;
    totals?: { grandTotal?: number };
    customerSnapshot?: { name?: string; phone?: string };
  },
  event: string,
  extra?: NotifyVars
) {
  const [customer, org] = await Promise.all([Customer.findById(order.customerId), Organization.findById(organizationId)]);
  const to = customer?.whatsapp || customer?.phone || order.customerSnapshot?.phone || "";
  return queueNotification({
    organizationId,
    event,
    to,
    vars: {
      customer_name: customer?.name || order.customerSnapshot?.name,
      order_number: order.number,
      grand_total: order.totals?.grandTotal,
      status_name: extra?.status_name || String(order.status ?? "").replaceAll("_", " "),
      business_name: org?.name,
      ...extra
    },
    referenceType: "Order",
    referenceId: String(order._id)
  });
}

export function eventForOrderStatus(code: string) {
  if (code === "delivered" || code === "completed") return "order_delivered";
  if (code === "cancelled") return "order_cancelled";
  return "order_status";
}

export async function ensureDefaultTemplates(organizationId: string) {
  for (const t of DEFAULT_TEMPLATE_DEFS) {
    const exists = await NotificationTemplate.findOne({ organizationId, event: t.event, channel: "whatsapp", deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await NotificationTemplate.create({
        organizationId,
        event: t.event,
        channel: "whatsapp",
        name: t.name,
        body: DEFAULT_WHATSAPP_BODIES[t.event],
        enabled: true
      });
    } catch {
      /* concurrent seed */
    }
  }
}

export function publicUrl(path: string) {
  return `${env.appUrl}${path}`;
}
