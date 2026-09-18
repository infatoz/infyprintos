export const DEFAULT_INVENTORY_TYPES = [
  { slug: "raw_material", name: "Raw material", description: "Media, substrates and job inputs", defaultUnit: "sqft", sortOrder: 10, system: true },
  { slug: "substrate", name: "Substrate", description: "Flex, vinyl, paper, board and fabric", defaultUnit: "sqft", sortOrder: 20, system: true },
  { slug: "ink", name: "Ink & toner", description: "Solvent, eco-solvent, UV, toner and 3D filament", defaultUnit: "ltr", sortOrder: 30, system: true },
  { slug: "plate", name: "Plates", description: "Offset and screen plates", defaultUnit: "pcs", sortOrder: 40, system: true },
  { slug: "laminate", name: "Laminate", description: "Thermal, cold and UV laminate rolls", defaultUnit: "mtr", sortOrder: 50, system: true },
  { slug: "finishing", name: "Finishing", description: "Tape, eyelets, boards, mounting and hardware", defaultUnit: "pcs", sortOrder: 60, system: true },
  { slug: "consumable", name: "Consumable", description: "Blades, cleaning, pressroom supplies", defaultUnit: "pcs", sortOrder: 70, system: true },
  { slug: "packaging", name: "Packaging", description: "Cartons, tubes, wrap and labels", defaultUnit: "pcs", sortOrder: 80, system: true },
  { slug: "spare_part", name: "Spare part", description: "Machine parts and service kits", defaultUnit: "pcs", sortOrder: 90, system: true },
  { slug: "finished_good", name: "Finished good", description: "Stocked print ready for dispatch", defaultUnit: "pcs", sortOrder: 100, system: true }
] as const;

export const DEFAULT_INVENTORY_CATEGORIES = [
  { slug: "flex_vinyl", name: "Flex / vinyl", type: "raw_material", sortOrder: 10 },
  { slug: "banner", name: "Banner media", type: "raw_material", sortOrder: 20 },
  { slug: "paper_board", name: "Paper & board", type: "raw_material", sortOrder: 30 },
  { slug: "fabric", name: "Fabric", type: "substrate", sortOrder: 40 },
  { slug: "solvent_ink", name: "Solvent ink", type: "ink", sortOrder: 50 },
  { slug: "uv_ink", name: "UV ink", type: "ink", sortOrder: 60 },
  { slug: "filament", name: "3D filament", type: "ink", sortOrder: 70 },
  { slug: "offset_plate", name: "Offset plate", type: "plate", sortOrder: 80 },
  { slug: "thermal_laminate", name: "Thermal laminate", type: "laminate", sortOrder: 90 },
  { slug: "hardware", name: "Hardware", type: "finishing", sortOrder: 100 },
  { slug: "carton", name: "Carton", type: "packaging", sortOrder: 110 },
  { slug: "press_spare", name: "Press spare", type: "spare_part", sortOrder: 120 }
] as const;

export const MANUAL_ISSUE_TYPES = ["outward", "wastage", "damaged"] as const;
export const RECEIPT_TYPES = ["opening", "purchase", "inward", "return"] as const;

export function slugifyInventory(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}
