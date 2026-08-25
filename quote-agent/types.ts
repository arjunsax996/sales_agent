export interface QuoteRequestItem {
  chemicalName: string; // as typed by the requester — informal is fine, e.g. "IPA", "caustic soda"
  quantity: number;
  unit: string; // free text, e.g. "gal", "kg", "lb", "L"
}

export interface QuoteRequest {
  companyName: string;
  items: QuoteRequestItem[];
}

export interface QuoteLineItem {
  requested: QuoteRequestItem;
  matchedBaseChemical: string | null;
  matchedSku: string | null;
  matchedProductLabel: string | null; // e.g. "Sodium Hydroxide, Technical Grade, 25 kg Bag"
  unitPrice: number | null;
  unitsNeeded: number | null; // how many of that pack size covers the requested quantity
  lineTotal: number | null;
  needsHumanReview: boolean;
  reviewReason?: string;
}

export interface Quotation {
  companyName: string;
  generatedAt: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  itemsNeedingReview: number;
}
