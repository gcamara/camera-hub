import { Alert } from 'react-native';

import { isWeb } from './platform';

/**
 * `Alert.alert` is an empty function in react-native-web, so every confirmation built on it
 * silently does nothing in a browser — a Disconnect button that cannot disconnect. A browser
 * has its own modal dialogs; these two helpers pick whichever one the platform actually has.
 */
export function notify(title: string, message?: string): void {
  if (isWeb) {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** What the confirming button says; a browser's own dialog can only say OK. */
  confirmLabel: string;
  destructive?: boolean;
}

export function confirm(options: ConfirmOptions, onConfirm: () => void): void {
  const { title, message, confirmLabel, destructive = false } = options;
  if (isWeb) {
    const prompt = [message, `${confirmLabel}?`].filter(Boolean).join('\n\n');
    if (globalThis.confirm?.(`${title}\n\n${prompt}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
