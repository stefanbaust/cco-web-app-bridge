export interface SalesItem {
  id?: string;
  description?: string;
  quantity?: number;
  quantityTypeCodeName?: string;
  unitGrossAmount: number;
  taxRate: number;
  grossAmount: number;
}

export interface Receipt {
  id?: string;
  businessTransactionDate: string;
  currency?: string;
  salesItems: SalesItem[];
  totalNetAmount: number;
  totalTaxAmount: number;
  totalGrossAmount: number;
}
