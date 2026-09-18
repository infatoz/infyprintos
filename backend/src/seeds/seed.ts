import bcrypt from "bcryptjs";
import { connectDb, disconnectDb } from "../config/db";
import { env } from "../config/env";
import { DEFAULT_ROLES } from "../common/permissions";
import { Organization, Branch } from "../models/Organization";
import { Role, User } from "../models/User";
import { CustomerTier, CreditTerm, Customer, CustomerAddress, MembershipCard } from "../models/Customer";
import { CatalogType, Category, Item, ItemVariant, PriceList } from "../models/Catalog";
import { DEFAULT_ITEM_TYPES } from "../modules/catalog/catalog.constants";
import { OrderStatus } from "../models/Order";
import { Machine, Department } from "../models/Production";
import { InventoryItem, InventoryCategory, BillOfMaterials, InventoryTransaction, Supplier } from "../models/Inventory";
import { moveStock } from "../common/inventory";
import { ensureInventoryTaxonomy, ensureUnits } from "../modules/inventory/inventory.service";
import { ensureExpenseTaxonomy, ensurePaymentMethods } from "../modules/finance/finance.service";
import { NotificationTemplate, Printer, PaymentMethod, Coupon } from "../models/Settings";
import { randomToken } from "../common/crypto";

const STATUSES = [
  { name: "Draft", code: "draft", color: "#94A3B8", sortOrder: 10, allowedTransitions: ["quotation_sent", "order_created", "cancelled"] },
  { name: "Quotation Sent", code: "quotation_sent", color: "#38BDF8", sortOrder: 20, allowedTransitions: ["awaiting_customer_approval", "cancelled"] },
  { name: "Awaiting Customer Approval", code: "awaiting_customer_approval", color: "#818CF8", sortOrder: 30, allowedTransitions: ["order_created", "cancelled"] },
  { name: "Order Created", code: "order_created", color: "#34D399", sortOrder: 40, allowedTransitions: ["payment_pending", "design_pending", "ready_to_print", "on_hold", "cancelled"] },
  { name: "Payment Pending", code: "payment_pending", color: "#FBBF24", sortOrder: 50, allowedTransitions: ["design_pending", "ready_to_print", "on_hold", "cancelled"] },
  { name: "Design Pending", code: "design_pending", color: "#F472B6", sortOrder: 60, allowedTransitions: ["design_uploaded", "on_hold", "cancelled"] },
  { name: "Design Uploaded", code: "design_uploaded", color: "#C084FC", sortOrder: 70, allowedTransitions: ["awaiting_design_approval"] },
  { name: "Awaiting Design Approval", code: "awaiting_design_approval", color: "#A78BFA", sortOrder: 80, allowedTransitions: ["ready_to_print", "design_rejected"] },
  { name: "Design Rejected", code: "design_rejected", color: "#FB7185", sortOrder: 90, allowedTransitions: ["design_pending", "cancelled"], requiresReason: true },
  { name: "Ready to Print", code: "ready_to_print", color: "#2DD4BF", sortOrder: 100, allowedTransitions: ["in_production", "on_hold"] },
  { name: "In Production", code: "in_production", color: "#22D3EE", sortOrder: 110, allowedTransitions: ["quality_check", "delayed"] },
  { name: "Quality Check", code: "quality_check", color: "#67E8F9", sortOrder: 120, allowedTransitions: ["ready_to_dispatch", "in_production"] },
  { name: "Ready to Dispatch", code: "ready_to_dispatch", color: "#86EFAC", sortOrder: 130, allowedTransitions: ["dispatched"] },
  { name: "Dispatched", code: "dispatched", color: "#4ADE80", sortOrder: 140, allowedTransitions: ["delivered"] },
  { name: "Delivered", code: "delivered", color: "#22C55E", sortOrder: 150, allowedTransitions: ["completed"], terminal: false },
  { name: "Completed", code: "completed", color: "#15803D", sortOrder: 160, allowedTransitions: [], terminal: true },
  { name: "Delayed", code: "delayed", color: "#F97316", sortOrder: 170, allowedTransitions: ["in_production", "ready_to_dispatch"], requiresReason: true },
  { name: "On Hold", code: "on_hold", color: "#64748B", sortOrder: 180, allowedTransitions: ["design_pending", "ready_to_print", "cancelled"], requiresReason: true },
  { name: "Cancelled", code: "cancelled", color: "#EF4444", sortOrder: 190, allowedTransitions: [], terminal: true, requiresReason: true }
];

async function seed() {
  await connectDb();
  let org = await Organization.findOne({ name: "Infatoz Prints" });
  if (!org) {
    org = await Organization.create({
      name: "Infatoz Prints",
      legalName: "Infatoz Printing & Business Operations",
      gstin: "29AABCI1234A1Z5",
      pan: "AABCI1234A",
      email: "hello@infatoz.com",
      phone: "+91 98765 00000",
      whatsapp: "919876500000",
      address: { line1: "12 Press Lane", city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" },
      invoicePrefix: "INV",
      quotationPrefix: "QT",
      orderPrefix: "ORD"
    });
  }
  let branch = await Branch.findOne({ organizationId: org._id, code: "HQ" });
  if (!branch) {
    branch = await Branch.create({
      organizationId: org._id,
      name: "Head Office",
      code: "HQ",
      isDefault: true,
      address: { line1: "12 Press Lane", city: "Bengaluru", state: "Karnataka", pincode: "560001" }
    });
  }

  const roles: Record<string, typeof Role.prototype> = {};
  for (const [slug, def] of Object.entries(DEFAULT_ROLES)) {
    roles[slug] = await Role.findOneAndUpdate(
      { organizationId: org._id, slug },
      { ...def, slug, organizationId: org._id, branchId: branch._id },
      { upsert: true, new: true }
    );
  }

  const passwordHash = await bcrypt.hash(env.seedOwnerPassword, env.bcryptRounds);
  const existingOwner =
    (await User.findOne({ organizationId: org._id, email: env.seedOwnerEmail })) ||
    (await User.findOne({ organizationId: org._id, email: "owner@infatoz.com" })) ||
    (await User.findOne({ organizationId: org._id, roleId: roles.owner._id }));
  await User.findOneAndUpdate(
    existingOwner ? { _id: existingOwner._id } : { organizationId: org._id, email: env.seedOwnerEmail },
    {
      name: env.seedOwnerName,
      email: env.seedOwnerEmail,
      passwordHash,
      roleId: roles.owner._id,
      organizationId: org._id,
      branchId: branch._id,
      phone: "9876500000",
      active: true
    },
    { upsert: true, new: true }
  );

  const tiers = [
    { name: "Basic", slug: "basic", discountPercent: 0, sortOrder: 1, color: "#94A3B8" },
    { name: "Premium", slug: "premium", discountPercent: 5, sortOrder: 2, color: "#F59E0B" },
    { name: "Premium Plus", slug: "premium_plus", discountPercent: 8, sortOrder: 3, color: "#D97706" },
    { name: "Corporate", slug: "corporate", discountPercent: 12, sortOrder: 4, color: "#0F766E" },
    { name: "Wholesale", slug: "wholesale", discountPercent: 18, sortOrder: 5, color: "#1D4ED8" }
  ];
  const tierDocs: Record<string, { _id: unknown }> = {};
  for (const t of tiers) {
    tierDocs[t.slug] = await CustomerTier.findOneAndUpdate(
      { organizationId: org._id, slug: t.slug },
      { ...t, organizationId: org._id },
      { upsert: true, new: true }
    );
  }

  const terms = [
    { name: "Prepaid", slug: "prepaid", type: "prepaid", netDays: 0 },
    { name: "Due on billing", slug: "due_on_billing", type: "due_on_billing", netDays: 0 },
    { name: "Net 7", slug: "net_7", type: "net_days", netDays: 7 },
    { name: "Net 15", slug: "net_15", type: "net_days", netDays: 15 },
    { name: "Net 30", slug: "net_30", type: "net_days", netDays: 30 }
  ];
  for (const t of terms) {
    await CreditTerm.findOneAndUpdate({ organizationId: org._id, slug: t.slug }, { ...t, organizationId: org._id }, { upsert: true, new: true });
  }

  for (const s of STATUSES) {
    await OrderStatus.findOneAndUpdate({ organizationId: org._id, code: s.code }, { ...s, organizationId: org._id, customerLabel: s.name }, { upsert: true, new: true });
  }

  for (const m of [
    { name: "Cash", code: "cash", type: "cash", system: true, sortOrder: 10 },
    { name: "UPI", code: "upi", type: "upi", system: true, sortOrder: 20 },
    { name: "Bank transfer", code: "bank", type: "bank", system: true, sortOrder: 30 },
    { name: "Card", code: "card", type: "card", system: true, sortOrder: 40 },
    { name: "Cheque", code: "cheque", type: "cheque", system: true, sortOrder: 50 },
    { name: "Credit", code: "credit", type: "credit", system: true, sortOrder: 60 }
  ]) {
    await PaymentMethod.findOneAndUpdate({ organizationId: org._id, code: m.code }, { ...m, organizationId: org._id, active: true }, { upsert: true });
  }
  await ensurePaymentMethods(String(org._id), String(branch._id));
  await ensureExpenseTaxonomy(String(org._id), String(branch._id));

  await Printer.findOneAndUpdate(
    { organizationId: org._id, name: "Front Desk A4" },
    { organizationId: org._id, branchId: branch._id, name: "Front Desk A4", type: "a4", connectionType: "browser", paperSize: "A4", isDefault: true },
    { upsert: true }
  );
  await Printer.findOneAndUpdate(
    { organizationId: org._id, name: "Thermal Receipt" },
    { organizationId: org._id, branchId: branch._id, name: "Thermal Receipt", type: "thermal", paperSize: "80mm" },
    { upsert: true }
  );

  const categories = [
    { name: "Visiting Cards", slug: "visiting-cards", type: "product" },
    { name: "Banners & Signage", slug: "banners", type: "product" },
    { name: "Corporate Gifting", slug: "gifting", type: "product" },
    { name: "3D Printing", slug: "3d-printing", type: "service" },
    { name: "Raw Materials", slug: "raw-materials", type: "raw_material" }
  ];
  const cats: Record<string, { _id: unknown }> = {};
  for (const c of categories) {
    cats[c.slug] = await Category.findOneAndUpdate({ organizationId: org._id, slug: c.slug }, { ...c, organizationId: org._id }, { upsert: true, new: true });
  }
  for (const t of DEFAULT_ITEM_TYPES) {
    await CatalogType.findOneAndUpdate(
      { organizationId: org._id, slug: t.slug },
      { ...t, organizationId: org._id, active: true },
      { upsert: true, new: true }
    );
  }

  const vc = await Item.findOneAndUpdate(
    { organizationId: org._id, sku: "VC-STD" },
    {
      organizationId: org._id,
      branchId: branch._id,
      name: "Visiting Cards",
      sku: "VC-STD",
      itemType: "custom_print",
      categoryId: cats["visiting-cards"]._id,
      salesPrice: 350,
      originalPrice: 400,
      baseCost: 120,
      taxRate: 18,
      unit: "pack",
      barcode: "890000000001",
      requiresDesign: true,
      description: "Premium visiting cards with lamination options",
      hsn: "4911",
      variantOptions: [
        { name: "Quantity", values: ["250", "500", "1000"] },
        { name: "Sides", values: ["Single", "Double"] },
        { name: "GSM", values: ["300", "350"] },
        { name: "Finish", values: ["Matte", "Glossy"] }
      ]
    },
    { upsert: true, new: true }
  );
  const vc500 = await ItemVariant.findOneAndUpdate(
    { organizationId: org._id, itemId: vc._id, name: "500 / Double / 350 GSM / Matte" },
    { organizationId: org._id, itemId: vc._id, name: "500 / Double / 350 GSM / Matte", sku: "VC-500-MATTE", salesPrice: 650, cost: 220, options: { Quantity: "500", Sides: "Double", GSM: "350", Finish: "Matte" } },
    { upsert: true, new: true }
  );

  const banner = await Item.findOneAndUpdate(
    { organizationId: org._id, sku: "BN-FLEX" },
    {
      organizationId: org._id,
      name: "Flex Banner",
      sku: "BN-FLEX",
      itemType: "custom_print",
      categoryId: cats["banners"]._id,
      salesPrice: 35,
      originalPrice: 45,
      baseCost: 12,
      taxRate: 18,
      unit: "sqft",
      allowDecimalQty: true,
      barcode: "890000000002",
      requiresDesign: true,
      description: "Outdoor flex banner printing. Price per sq.ft.",
      variantOptions: [
        { name: "Material", values: ["Star Flex", "Black Back", "Fabric"] },
        { name: "Finishing", values: ["None", "Eyelets", "Frame"] }
      ]
    },
    { upsert: true, new: true }
  );

  const mug = await Item.findOneAndUpdate(
    { organizationId: org._id, sku: "GF-MUG" },
    {
      organizationId: org._id,
      name: "Printed Ceramic Mug",
      sku: "GF-MUG",
      itemType: "product",
      categoryId: cats["gifting"]._id,
      salesPrice: 249,
      baseCost: 90,
      taxRate: 18,
      unit: "pcs",
      requiresDesign: true,
      barcode: "890000000003"
    },
    { upsert: true, new: true }
  );

  const print3d = await Item.findOneAndUpdate(
    { organizationId: org._id, sku: "3D-PLA" },
    {
      organizationId: org._id,
      name: "3D Print (PLA)",
      sku: "3D-PLA",
      itemType: "custom_print",
      categoryId: cats["3d-printing"]._id,
      salesPrice: 8,
      baseCost: 2.5,
      taxRate: 18,
      unit: "gram",
      allowDecimalQty: true,
      requiresDesign: true,
      description: "PLA 3D printing billed by estimated weight"
    },
    { upsert: true, new: true }
  );

  await PriceList.findOneAndUpdate(
    { organizationId: org._id, itemId: vc._id, tierId: tierDocs.corporate._id, minQty: 1 },
    { organizationId: org._id, itemId: vc._id, variantId: vc500._id, tierId: tierDocs.corporate._id, minQty: 1, price: 560 },
    { upsert: true }
  );

  await ensureUnits(String(org._id));
  await ensureInventoryTaxonomy(String(org._id), String(branch._id));
  const invCats = Object.fromEntries(
    (await InventoryCategory.find({ organizationId: org._id, deletedAt: null })).map((c) => [c.slug, c])
  );
  await Supplier.findOneAndUpdate(
    { organizationId: org._id, code: "SUP-0001" },
    {
      organizationId: org._id,
      code: "SUP-0001",
      name: "Apex Media Supplies",
      phone: "9876501111",
      phoneDigits: "9876501111",
      gstin: "29AABCU9603R1ZX",
      paymentTerms: "Net 15",
      leadTimeDays: 3,
      city: "Bengaluru",
      state: "Karnataka"
    },
    { upsert: true }
  );

  const flexRoll = await InventoryItem.findOneAndUpdate(
    { organizationId: org._id, sku: "RM-FLEX-10" },
    {
      organizationId: org._id,
      sku: "RM-FLEX-10",
      name: "Star Flex Roll",
      type: "raw_material",
      category: "Banner media",
      categoryId: invCats.banner?._id,
      unit: "sqft",
      reorderLevel: 200,
      costPerUnit: 8,
      warehouse: "Main"
    },
    { upsert: true, new: true }
  );
  const paper = await InventoryItem.findOneAndUpdate(
    { organizationId: org._id, sku: "RM-CARD-350" },
    {
      organizationId: org._id,
      sku: "RM-CARD-350",
      name: "350 GSM Art Card",
      type: "raw_material",
      category: "Paper & board",
      categoryId: invCats.paper_board?._id,
      unit: "sheet",
      reorderLevel: 200,
      costPerUnit: 6
    },
    { upsert: true, new: true }
  );
  const filament = await InventoryItem.findOneAndUpdate(
    { organizationId: org._id, sku: "RM-PLA-WHT" },
    {
      organizationId: org._id,
      sku: "RM-PLA-WHT",
      name: "PLA Filament White",
      type: "ink",
      category: "3D filament",
      categoryId: invCats.filament?._id,
      unit: "gram",
      reorderLevel: 500,
      costPerUnit: 1.2
    },
    { upsert: true, new: true }
  );
  const openings: Array<{ item: { _id: unknown; stockQty?: number }; qty: number; cost: number }> = [
    { item: flexRoll, qty: 2500, cost: 8 },
    { item: paper, qty: 1200, cost: 6 },
    { item: filament, qty: 4000, cost: 1.2 }
  ];
  for (const row of openings) {
    const hasLedger = await InventoryTransaction.findOne({ inventoryItemId: row.item._id });
    if (!hasLedger && Number(row.item.stockQty || 0) <= 0) {
      await moveStock({
        organizationId: String(org._id),
        inventoryItemId: String(row.item._id),
        type: "opening",
        quantity: row.qty,
        unitCost: row.cost,
        reason: "Seed opening stock",
        idempotencyKey: `seed-opening:${String(row.item._id)}`
      });
    }
  }

  await BillOfMaterials.findOneAndUpdate(
    { organizationId: org._id, itemId: banner._id },
    {
      organizationId: org._id,
      itemId: banner._id,
      wastePercent: 5,
      materials: [{ inventoryItemId: flexRoll._id, quantityPerUnit: 1, unit: "sqft" }]
    },
    { upsert: true }
  );

  await Department.findOneAndUpdate(
    { organizationId: org._id, code: "PREPRESS" },
    { organizationId: org._id, name: "Prepress", code: "PREPRESS" },
    { upsert: true }
  );
  await Department.findOneAndUpdate(
    { organizationId: org._id, code: "PRESS" },
    { organizationId: org._id, name: "Press Floor", code: "PRESS" },
    { upsert: true }
  );
  await Department.findOneAndUpdate(
    { organizationId: org._id, code: "FINISH" },
    { organizationId: org._id, name: "Finishing", code: "FINISH" },
    { upsert: true }
  );

  await Machine.findOneAndUpdate(
    { organizationId: org._id, code: "HP-R1000" },
    { organizationId: org._id, name: "HP Latex R1000", code: "HP-R1000", type: "wide_format", capacity: "54 inch", costPerHour: 450, status: "available" },
    { upsert: true }
  );
  await Machine.findOneAndUpdate(
    { organizationId: org._id, code: "PRUSA-MK4" },
    { organizationId: org._id, name: "Prusa MK4", code: "PRUSA-MK4", type: "3d_printer", capacity: "250mm", costPerHour: 120, status: "available" },
    { upsert: true }
  );

  const templates = [
    { event: "customer_created", channel: "whatsapp", name: "Customer welcome", body: "Hello {{customer_name}}, welcome to {{business_name}}. Your membership ID is {{membership_id}}." },
    { event: "quotation_sent", channel: "whatsapp", name: "Quotation approval", body: "Hello {{customer_name}},\n\nYour quotation {{quotation_number}} from {{business_name}} is ready for approval.\nTotal: ₹{{grand_total}}\n\nReview here:\n{{approval_link}}" },
    { event: "order_created", channel: "whatsapp", name: "Order confirmation", body: "Hi {{customer_name}}, order {{order_number}} is confirmed. Amount: ₹{{grand_total}}. Thank you for choosing {{business_name}}." },
    { event: "order_status", channel: "whatsapp", name: "Order status update", body: "Hi {{customer_name}}, order {{order_number}} is now {{status_name}}. — {{business_name}}" },
    { event: "order_cancelled", channel: "whatsapp", name: "Order cancelled", body: "Hi {{customer_name}}, order {{order_number}} has been cancelled{{reason_suffix}}. — {{business_name}}" },
    { event: "design_uploaded", channel: "whatsapp", name: "Design approval", body: "Hi {{customer_name}}, artwork for order {{order_number}} is ready. Approve here: {{approval_link}}" },
    { event: "payment_received", channel: "whatsapp", name: "Payment receipt", body: "Hi {{customer_name}}, payment of ₹{{amount}} received for {{order_number}}. Thank you! — {{business_name}}" },
    { event: "order_delivered", channel: "whatsapp", name: "Delivered", body: "Hi {{customer_name}}, your order {{order_number}} has been delivered. We hope you love the print! — {{business_name}}" }
  ];
  for (const t of templates) {
    await NotificationTemplate.findOneAndUpdate({ organizationId: org._id, event: t.event, channel: t.channel }, { ...t, organizationId: org._id, enabled: true }, { upsert: true });
  }

  await Coupon.findOneAndUpdate(
    { organizationId: org._id, code: "WELCOME10" },
    { organizationId: org._id, code: "WELCOME10", type: "percent", value: 10, minOrder: 500, maxDiscount: 250, active: true },
    { upsert: true }
  );

  const existingCustomer = await Customer.findOne({ organizationId: org._id, phone: "9876512345" });
  if (!existingCustomer) {
    const customer = await Customer.create({
      organizationId: org._id,
      branchId: branch._id,
      code: "CUS202600001",
      name: "Aarav Menon",
      phone: "9876512345",
      whatsapp: "919876512345",
      email: "aarav@example.com",
      type: "business",
      tierId: tierDocs.corporate._id,
      creditLimit: 50000,
      business: { name: "Northwind Traders", category: "Retail", gstin: "29AABCU9603R1ZX" }
    });
    await CustomerAddress.create({
      organizationId: org._id,
      customerId: customer._id,
      label: "Office",
      type: "billing",
      line1: "42 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      isDefault: true
    });
    await MembershipCard.create({
      organizationId: org._id,
      customerId: customer._id,
      membershipId: "INF-AARAV001",
      qrToken: randomToken(16),
      tierName: "Corporate",
      status: "active"
    });
  }

  console.log(`Seed complete. Login: ${env.seedOwnerEmail} / ${env.seedOwnerPassword}`);
  await disconnectDb();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
