import type { HawcxInitializeConfig } from '@hawcx/react-native-sdk';

/**
 * Populate the API key locally for testing or use the in-app form.
 * Leaving it blank ensures we never ship real credentials in git history.
 */
export const HAWCX_PROJECT_API_KEY = 'jy8AKdLufbzoyLIpC9JlM6E1WL2s7nu7';
export const HAWCX_BASE_URL = 'https://stage-api.hawcx.com';
export const EXAMPLE_DEFAULT_IDENTIFIER = 'user@example.com';
export const EXAMPLE_DEFAULT_BACKEND_URL = 'http://localhost:3000/api/login';
export const EXAMPLE_REDIRECT_SCHEMES = ['hawcxexampleapp', 'com.hawcx.example'] as const;
/**
 * Magic-link landing URL. It must be registered, exactly, on the project and be
 * served as a Universal Link / App Link for this app (see README). Leave blank
 * to keep magic links on background polling only.
 */
export const EXAMPLE_MAGIC_LINK_LANDING_URL = '';

const buildDefaultConfig = (): HawcxInitializeConfig | null => {
  const trimmedKey = HAWCX_PROJECT_API_KEY.trim();
  if (!trimmedKey) {
    return null;
  }
  const trimmedBase = HAWCX_BASE_URL.trim();
  if (!trimmedBase) {
    return null;
  }
  const magicLinkLandingUrl = EXAMPLE_MAGIC_LINK_LANDING_URL.trim();
  return {
    projectApiKey: trimmedKey,
    baseUrl: trimmedBase,
    ...(magicLinkLandingUrl ? { magicLinkLandingUrl } : {}),
  };
};

export const DEFAULT_HAWCX_CONFIG = buildDefaultConfig();
