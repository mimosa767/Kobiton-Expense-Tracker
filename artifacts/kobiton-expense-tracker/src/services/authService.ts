import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_CREDENTIALS, STORAGE_KEYS } from '../constants/config';

export interface Session {
  email: string;
  loggedInAt: string;
}

async function login(email: string, password: string): Promise<Session | null> {
  if (
    email.trim().toLowerCase() === DEMO_CREDENTIALS.email &&
    password === DEMO_CREDENTIALS.password
  ) {
    const session: Session = {
      email: email.trim().toLowerCase(),
      loggedInAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    return session;
  }
  return null;
}

async function logout(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_KEYS.session, STORAGE_KEYS.biometricEnabled]);
}

async function getSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

async function isBiometricEnabled(): Promise<boolean> {
  const val = await AsyncStorage.getItem(STORAGE_KEYS.biometricEnabled);
  return val === 'true';
}

async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.biometricEnabled, enabled ? 'true' : 'false');
}

export const authService = { login, logout, getSession, isBiometricEnabled, setBiometricEnabled };
