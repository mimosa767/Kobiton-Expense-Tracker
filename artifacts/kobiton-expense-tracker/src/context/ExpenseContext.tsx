import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { expenseStorage } from '../storage/expenseStorage';
import type { Expense, NewExpense } from '../types/expense';

interface ExpenseContextValue {
  expenses: Expense[];
  isLoading: boolean;
  reload: () => Promise<void>;
  addExpense: (data: NewExpense) => Promise<Expense>;
  updateExpense: (id: string, data: Partial<NewExpense>) => Promise<Expense | null>;
  deleteExpense: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  seedSamples: (samples: Expense[]) => Promise<void>;
}

const ExpenseContext = createContext<ExpenseContextValue | null>(null);

export function ExpenseProvider({ children }: { children: React.ReactNode }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await expenseStorage.getAll();
    setExpenses(data);
  }, []);

  useEffect(() => {
    (async () => {
      await reload();
      setIsLoading(false);
    })();
  }, [reload]);

  async function addExpense(data: NewExpense): Promise<Expense> {
    const expense = await expenseStorage.create(data);
    setExpenses((prev) => [expense, ...prev]);
    return expense;
  }

  async function updateExpense(id: string, data: Partial<NewExpense>): Promise<Expense | null> {
    const updated = await expenseStorage.update(id, data);
    if (updated) {
      setExpenses((prev) => prev.map((e) => (e.id === id ? updated : e)));
    }
    return updated;
  }

  async function deleteExpense(id: string): Promise<void> {
    await expenseStorage.remove(id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }

  async function clearAll(): Promise<void> {
    await expenseStorage.clearAll();
    setExpenses([]);
  }

  async function seedSamples(samples: Expense[]): Promise<void> {
    await expenseStorage.saveAll(samples);
    setExpenses(samples);
  }

  return (
    <ExpenseContext.Provider
      value={{ expenses, isLoading, reload, addExpense, updateExpense, deleteExpense, clearAll, seedSamples }}
    >
      {children}
    </ExpenseContext.Provider>
  );
}

export function useExpenses() {
  const ctx = useContext(ExpenseContext);
  if (!ctx) throw new Error('useExpenses must be used within ExpenseProvider');
  return ctx;
}
