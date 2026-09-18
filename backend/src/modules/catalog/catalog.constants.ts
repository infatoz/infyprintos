export const CATALOG_UNITS = [
  "pcs",
  "pack",
  "meter",
  "sqm",
  "sqft",
  "kg",
  "gram",
  "hour",
  "set",
  "box",
  "roll",
  "sheet"
] as const;

export const DEFAULT_ITEM_TYPES = [
  {
    slug: "custom_print",
    name: "Custom print",
    description: "Print jobs that typically need artwork",
    defaultUnit: "pcs",
    requiresDesign: true,
    trackInventory: false,
    sortOrder: 10,
    system: true
  },
  {
    slug: "product",
    name: "Product",
    description: "Finished goods sold as-is",
    defaultUnit: "pcs",
    requiresDesign: false,
    trackInventory: true,
    sortOrder: 20,
    system: true
  },
  {
    slug: "service",
    name: "Service",
    description: "Labour, design or installation",
    defaultUnit: "hour",
    requiresDesign: false,
    trackInventory: false,
    sortOrder: 30,
    system: true
  },
  {
    slug: "raw_material",
    name: "Raw material",
    description: "Paper, ink, media and consumables",
    defaultUnit: "kg",
    requiresDesign: false,
    trackInventory: true,
    sortOrder: 40,
    system: true
  },
  {
    slug: "digital",
    name: "Digital",
    description: "Files, downloads and e-delivery",
    defaultUnit: "pcs",
    requiresDesign: false,
    trackInventory: false,
    sortOrder: 50,
    system: true
  },
  {
    slug: "bundle",
    name: "Bundle",
    description: "Packaged set of items",
    defaultUnit: "set",
    requiresDesign: false,
    trackInventory: false,
    sortOrder: 60,
    system: true
  },
  {
    slug: "addon",
    name: "Add-on",
    description: "Finishing or extras sold with a job",
    defaultUnit: "pcs",
    requiresDesign: false,
    trackInventory: false,
    sortOrder: 70,
    system: true
  },
  {
    slug: "other",
    name: "Other",
    description: "Unclassified catalog type",
    defaultUnit: "pcs",
    requiresDesign: false,
    trackInventory: false,
    sortOrder: 90,
    system: true
  }
] as const;

export const HSN_PATTERN = /^\d{4,8}$/;
export const SAC_PATTERN = /^\d{4,6}$/;
