export interface SalesItem {
  id?: string;
  description?: string;
  quantity?: number;
  quantityTypeCodeName?: string;
  unitGrossAmount: number;
  taxRate: number;
  grossAmount: number;
  paymentGrossAmount: number;
}

export interface Receipt {
  id?: string;
  businessTransactionDate: string;
  currency?: string;
  salesItems: SalesItem[];
  totalNetAmount: number;
  paymentNetAmount: number;
  totalTaxAmount: number;
  paymentTaxAmount: number;
  totalGrossAmount: number;
  paymentGrossAmount: number;
}
