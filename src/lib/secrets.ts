import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** The keychain is native only; the browser preview keeps secrets in plain storage and is never a shipping target. */
export const secrets = {
  get: (key: string) => (Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value)),
  remove: (key: string) => (Platform.OS === 'web' ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key)),
};

/** A secret the keychain cannot return is indistinguishable from one that was never set, so both read as empty. */
export async function readSecret(key: string): Promise<string> {
  try {
    return (await secrets.get(key)) ?? '';
  } catch {
    return '';
  }
}

/** Keychain keys accept a narrow alphabet; anything else in an id would make the entry unreadable. */
export function secretKey(prefix: string, id: string): string {
  return `${prefix}${id.replace(/[^A-Za-z0-9._-]/g, '')}`;
}
