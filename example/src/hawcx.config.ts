import type { HawcxInitializeConfig } from '@hawcx/react-native-sdk';

/**
 * Populate the API key locally for testing or use the in-app form.
 * Leaving it blank ensures we never ship real credentials in git history.
 */
export const HAWCX_PROJECT_API_KEY = 'YOUR_API_KEY';

const buildDefaultConfig = (): HawcxInitializeConfig | null => {
  const trimmedKey = HAWCX_PROJECT_API_KEY.trim();
  if (!trimmedKey) {
    return null;
  }
  return {
    projectApiKey: trimmedKey,
  };
};

export const DEFAULT_HAWCX_CONFIG = buildDefaultConfig();
