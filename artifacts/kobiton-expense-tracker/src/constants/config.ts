import type { ExpenseHead, CurrencyCode, ExpenseCategory } from '../types/expense';

export const DEMO_CREDENTIALS = {
  email: 'test@kobiton.com',
  password: 'kobiton123',
};

export const EXPENSE_HEADS: ExpenseHead[] = [
  'Taxi',
  'Food',
  'Hotel',
  'Flight',
  'Office Supplies',
  'Client Meeting',
  'Internet',
  'Parking',
  'Other',
];

export const CURRENCIES: CurrencyCode[] = [
  'INR-₹',
  'USD-$',
  'AUD-A$',
  'SGD-S$',
  'GBP-£',
  'EUR-€',
  'CNY-¥',
  'YEN-¥',
];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Business',
  'Travel',
  'Meals',
  'Office',
  'Software',
  'Misc',
];

export const STORAGE_KEYS = {
  expenses: '@kobiton_expenses',
  session: '@kobiton_session',
  biometricEnabled: '@kobiton_biometric',
};

export const AMOUNT_SLIDER_MAX = 10000;
