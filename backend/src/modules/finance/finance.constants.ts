export const DEFAULT_EXPENSE_TYPES = [
  { slug: "cost_of_sales", name: "Cost of sales", description: "Media, ink and job materials", sortOrder: 10, system: true },
  { slug: "operating", name: "Operating", description: "Day-to-day press and office costs", sortOrder: 20, system: true },
  { slug: "payroll", name: "Payroll", description: "Salaries, wages and contractor payouts", sortOrder: 30, system: true },
  { slug: "utilities", name: "Utilities", description: "Power, water, internet and fuel", sortOrder: 40, system: true },
  { slug: "facility", name: "Facility", description: "Rent, rates and building upkeep", sortOrder: 50, system: true },
  { slug: "logistics", name: "Logistics", description: "Delivery, courier and transport", sortOrder: 60, system: true },
  { slug: "marketing", name: "Marketing", description: "Ads, samples and business development", sortOrder: 70, system: true },
  { slug: "finance", name: "Finance charges", description: "Bank fees, interest and instruments", sortOrder: 80, system: true },
  { slug: "capital", name: "Capital", description: "Machines, tools and long-life assets", sortOrder: 90, system: true },
  { slug: "other", name: "Other", description: "Unclassified business spend", sortOrder: 100, system: true }
] as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  { slug: "raw_material", name: "Raw material", type: "cost_of_sales", sortOrder: 10 },
  { slug: "media_purchase", name: "Media purchase", type: "cost_of_sales", sortOrder: 20 },
  { slug: "ink", name: "Ink & chemicals", type: "cost_of_sales", sortOrder: 30 },
  { slug: "packaging", name: "Packaging", type: "cost_of_sales", sortOrder: 40 },
  { slug: "maintenance", name: "Machine maintenance", type: "operating", sortOrder: 50 },
  { slug: "office", name: "Office supplies", type: "operating", sortOrder: 60 },
  { slug: "vendor", name: "Outsourced job", type: "operating", sortOrder: 70 },
  { slug: "salaries", name: "Salaries", type: "payroll", sortOrder: 80 },
  { slug: "electricity", name: "Electricity", type: "utilities", sortOrder: 90 },
  { slug: "rent", name: "Rent", type: "facility", sortOrder: 100 },
  { slug: "transport", name: "Transport", type: "logistics", sortOrder: 110 },
  { slug: "marketing", name: "Marketing", type: "marketing", sortOrder: 120 },
  { slug: "bank_charges", name: "Bank charges", type: "finance", sortOrder: 130 },
  { slug: "machine_emi", name: "Machine EMI", type: "capital", sortOrder: 140 },
  { slug: "misc", name: "Miscellaneous", type: "other", sortOrder: 150 }
] as const;

export const DEFAULT_PAYMENT_METHODS = [
  { name: "Cash", code: "cash", type: "cash", sortOrder: 10, system: true },
  { name: "UPI", code: "upi", type: "upi", sortOrder: 20, system: true },
  { name: "Bank transfer", code: "bank", type: "bank", sortOrder: 30, system: true },
  { name: "Card", code: "card", type: "card", sortOrder: 40, system: true },
  { name: "Cheque", code: "cheque", type: "cheque", sortOrder: 50, system: true },
  { name: "Credit", code: "credit", type: "credit", sortOrder: 60, system: true }
] as const;

export function slugifyFinance(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}
