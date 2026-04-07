/**
 * storage.js
 *
 * AsyncStorage helper utilities for persisting and retrieving expenses.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEY = '@kobiton_expense_tracker:expenses';

/**
 * Persists the full expenses array to AsyncStorage.
 * @param {Array} expenses - Array of expense objects to persist.
 */
export async function saveExpenses(expenses) {
  try {
    const json = JSON.stringify(expenses);
    await AsyncStorage.setItem(STORAGE_KEY, json);
  } catch (error) {
    console.error('saveExpenses error:', error);
    throw error;
  }
}

/**
 * Retrieves the persisted expenses array from AsyncStorage.
 * Returns an empty array if no data is found.
 * @returns {Promise<Array>} Array of stored expense objects.
 */
export async function loadExpenses() {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (json === null) return [];
    return JSON.parse(json);
  } catch (error) {
    console.error('loadExpenses error:', error);
    return [];
  }
}

/**
 * Clears all persisted expense data.
 * Useful for testing or a user-initiated reset.
 */
export async function clearExpenses() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('clearExpenses error:', error);
    throw error;
  }
}
