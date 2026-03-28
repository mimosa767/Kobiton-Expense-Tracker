import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Expense, NewExpense } from '../types/expense';
import { STORAGE_KEYS } from '../constants/config';

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

async function getAll(): Promise<Expense[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.expenses);
    if (!raw) return [];
    return JSON.parse(raw) as Expense[];
  } catch {
    return [];
  }
}

async function saveAll(expenses: Expense[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses));
}

async function create(data: NewExpense): Promise<Expense> {
  const expenses = await getAll();
  const now = new Date().toISOString();
  const expense: Expense = {
    ...data,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  expenses.unshift(expense);
  await saveAll(expenses);
  return expense;
}

async function update(id: string, data: Partial<NewExpense>): Promise<Expense | null> {
  const expenses = await getAll();
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated: Expense = {
    ...expenses[idx],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  expenses[idx] = updated;
  await saveAll(expenses);
  return updated;
}

async function remove(id: string): Promise<void> {
  const expenses = await getAll();
  await saveAll(expenses.filter((e) => e.id !== id));
}

async function getById(id: string): Promise<Expense | null> {
  const expenses = await getAll();
  return expenses.find((e) => e.id === id) ?? null;
}

async function clearAll(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.expenses);
}

export const expenseStorage = { getAll, saveAll, create, update, remove, getById, clearAll };
