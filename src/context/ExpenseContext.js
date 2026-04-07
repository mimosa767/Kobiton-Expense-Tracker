/**
 * ExpenseContext.js
 *
 * Global state management for expenses using React Context + useReducer.
 * Persists data to AsyncStorage via the storage utils.
 */

import React, {
  createContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import 'react-native-get-random-values'; // required for uuid v4 in React Native
import { v4 as uuidv4 } from 'uuid';
import { saveExpenses, loadExpenses as loadFromStorage } from '../utils/storage';

// ─── Context ─────────────────────────────────────────────────────────────────

export const ExpenseContext = createContext(null);

// ─── Reducer ─────────────────────────────────────────────────────────────────

const initialState = {
  expenses: [],
};

function expenseReducer(state, action) {
  switch (action.type) {
    case 'LOAD_EXPENSES':
      return { ...state, expenses: action.payload };

    case 'ADD_EXPENSE':
      return { ...state, expenses: [action.payload, ...state.expenses] };

    case 'DELETE_EXPENSE':
      return {
        ...state,
        expenses: state.expenses.filter((e) => e.id !== action.payload),
      };

    default:
      return state;
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ExpenseProvider({ children }) {
  const [state, dispatch] = useReducer(expenseReducer, initialState);

  // Load persisted expenses on mount
  useEffect(() => {
    loadExpenses();
  }, []);

  // Persist whenever the expenses array changes
  useEffect(() => {
    saveExpenses(state.expenses).catch((err) =>
      console.warn('Failed to persist expenses:', err)
    );
  }, [state.expenses]);

  const loadExpenses = useCallback(async () => {
    try {
      const stored = await loadFromStorage();
      dispatch({ type: 'LOAD_EXPENSES', payload: stored });
    } catch (error) {
      console.warn('Failed to load expenses:', error);
    }
  }, []);

  const addExpense = useCallback(async (expenseData) => {
    const newExpense = {
      id: uuidv4(),
      ...expenseData,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_EXPENSE', payload: newExpense });
    return newExpense;
  }, []);

  const deleteExpense = useCallback((id) => {
    dispatch({ type: 'DELETE_EXPENSE', payload: id });
  }, []);

  // Derive total from current expenses
  const total = useMemo(
    () =>
      state.expenses.reduce(
        (sum, e) => sum + (parseFloat(e.amount) || 0),
        0
      ),
    [state.expenses]
  );

  const value = useMemo(
    () => ({
      expenses: state.expenses,
      addExpense,
      deleteExpense,
      loadExpenses,
      total,
    }),
    [state.expenses, addExpense, deleteExpense, loadExpenses, total]
  );

  return (
    <ExpenseContext.Provider value={value}>{children}</ExpenseContext.Provider>
  );
}
