import type { HawcxInitializeConfig } from '@hawcx/react-native-sdk';

/**
 * Populate the API key locally for testing or use the in-app form.
 * Leaving it blank ensures we never ship real credentials in git history.
 */
export const HAWCX_PROJECT_API_KEY = 'ceasar2';
export const HAWCX_BASE_URL = 'https://ceasar-api.hawcx.com';
export const EXAMPLE_DEFAULT_IDENTIFIER = 'user@example.com';
export const EXAMPLE_DEFAULT_BACKEND_URL = 'http://localhost:3000/api/login';
export const EXAMPLE_REDIRECT_SCHEMES = ['hawcxexampleapp', 'com.hawcx.example'] as const;

const buildDefaultConfig = (): HawcxInitializeConfig | null => {
  const trimmedKey = HAWCX_PROJECT_API_KEY.trim();
  if (!trimmedKey) {
    return null;
  }
  const trimmedBase = HAWCX_BASE_URL.trim();
  if (!trimmedBase) {
    return null;
  }
  return {
    projectApiKey: trimmedKey,
    baseUrl: trimmedBase,
  };
};

export const DEFAULT_HAWCX_CONFIG = buildDefaultConfig();
