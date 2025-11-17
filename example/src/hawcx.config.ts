import type { HawcxInitializeConfig } from '@hawcx/react-native-sdk';

/**
 * Populate these fields locally for testing or use the in-app form.
 * Leaving them blank ensures we never ship real credentials in git history.
 */
export const HAWCX_PROJECT_API_KEY = '';
export const HAWCX_OAUTH_CLIENT_ID = '';
export const HAWCX_OAUTH_TOKEN_ENDPOINT = '';
export const HAWCX_OAUTH_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
-----END PUBLIC KEY-----`;

const buildDefaultConfig = (): HawcxInitializeConfig | null => {
  const trimmedKey = HAWCX_PROJECT_API_KEY.trim();
  if (!trimmedKey) {
    return null;
  }
  const baseConfig: HawcxInitializeConfig = {
    projectApiKey: trimmedKey,
  };

  const trimmedClientId = HAWCX_OAUTH_CLIENT_ID.trim();
  const trimmedEndpoint = HAWCX_OAUTH_TOKEN_ENDPOINT.trim();
  const trimmedPem = HAWCX_OAUTH_PUBLIC_KEY_PEM.trim();

  if (trimmedClientId && trimmedEndpoint && trimmedPem) {
    baseConfig.oauthConfig = {
      clientId: trimmedClientId,
      tokenEndpoint: trimmedEndpoint,
      publicKeyPem: trimmedPem,
    };
  }

  return baseConfig;
};

export const DEFAULT_HAWCX_CONFIG = buildDefaultConfig();
