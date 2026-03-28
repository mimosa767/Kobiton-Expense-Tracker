import type { Expense } from '../types/expense';

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function getSampleExpenses(): Expense[] {
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return d.toISOString().split('T')[0];
  };

  return [
    {
      id: generateId(),
      head: 'Taxi',
      amount: 50,
      currency: 'USD-$',
      date: day(1),
      category: 'Travel',
      recurring: false,
      notes: 'Airport to hotel',
      attachmentUri: null,
      attachmentName: null,
      createdAt: new Date(now.getTime() - 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 86400000).toISOString(),
    },
    {
      id: generateId(),
      head: 'Hotel',
      amount: 189.99,
      currency: 'USD-$',
      date: day(2),
      category: 'Business',
      recurring: false,
      notes: 'Conference stay – 2 nights',
      attachmentUri: null,
      attachmentName: null,
      createdAt: new Date(now.getTime() - 172800000).toISOString(),
      updatedAt: new Date(now.getTime() - 172800000).toISOString(),
    },
    {
      id: generateId(),
      head: 'Food',
      amount: 42.5,
      currency: 'USD-$',
      date: day(2),
      category: 'Meals',
      recurring: false,
      notes: 'Team lunch',
      attachmentUri: null,
      attachmentName: null,
      createdAt: new Date(now.getTime() - 172800000 + 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 172800000 + 3600000).toISOString(),
    },
    {
      id: generateId(),
      head: 'Flight',
      amount: 320,
      currency: 'USD-$',
      date: day(5),
      category: 'Travel',
      recurring: false,
      notes: 'Round trip SFO-NYC',
      attachmentUri: null,
      attachmentName: null,
      createdAt: new Date(now.getTime() - 432000000).toISOString(),
      updatedAt: new Date(now.getTime() - 432000000).toISOString(),
    },
    {
      id: generateId(),
      head: 'Internet',
      amount: 29.99,
      currency: 'USD-$',
      date: day(7),
      category: 'Software',
      recurring: true,
      notes: 'Monthly Wi-Fi plan',
      attachmentUri: null,
      attachmentName: null,
      createdAt: new Date(now.getTime() - 604800000).toISOString(),
      updatedAt: new Date(now.getTime() - 604800000).toISOString(),
    },
    {
      id: generateId(),
      head: 'Office Supplies',
      amount: 78.4,
      currency: 'USD-$',
      date: day(10),
      category: 'Office',
      recurring: false,
      notes: 'Notebooks, pens, sticky notes',
      attachmentUri: null,
      attachmentName: null,
      createdAt: new Date(now.getTime() - 864000000).toISOString(),
      updatedAt: new Date(now.getTime() - 864000000).toISOString(),
    },
    {
      id: generateId(),
      head: 'Client Meeting',
      amount: 115,
      currency: 'EUR-€',
      date: day(12),
      category: 'Business',
      recurring: false,
      notes: 'Client dinner in Frankfurt',
      attachmentUri: null,
      attachmentName: null,
      createdAt: new Date(now.getTime() - 1036800000).toISOString(),
      updatedAt: new Date(now.getTime() - 1036800000).toISOString(),
    },
  ];
}
