import { Platform } from 'react-native';

/**
 * The one place the app asks whether it is running in a browser. Everything downstream
 * takes the answer as data — `hubStreamUrl`, `needsHubSession` and the layout helpers are
 * all pure functions of it — so the platform choice is made once and tested everywhere.
 */
export const isWeb: boolean = Platform.OS === 'web';
