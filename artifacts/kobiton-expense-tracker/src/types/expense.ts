export type CurrencyCode = 'INR-₹' | 'USD-$' | 'AUD-A$' | 'SGD-S$' | 'GBP-£' | 'EUR-€' | 'CNY-¥' | 'YEN-¥';

export type ExpenseCategory = 'Business' | 'Travel' | 'Meals' | 'Office' | 'Software' | 'Misc';

export interface Expense {
  id: string;
  head: string;
  amount: number;
  currency: CurrencyCode;
  date: string;
  category: ExpenseCategory;
  recurring: boolean;
  notes: string;
  attachmentUri: string | null;
  attachmentName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NewExpense = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>;
