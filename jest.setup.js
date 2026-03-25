import { NativeModules } from 'react-native';

NativeModules.HawcxReactNative = NativeModules.HawcxReactNative || {
  initialize: jest.fn(() => Promise.resolve()),
  authenticate: jest.fn(() => Promise.resolve()),
  submitOtp: jest.fn(() => Promise.resolve()),
  v6Start: jest.fn(() => Promise.resolve()),
  v6SelectMethod: jest.fn(() => Promise.resolve()),
  v6SubmitCode: jest.fn(() => Promise.resolve()),
  v6SubmitTotp: jest.fn(() => Promise.resolve()),
  v6SubmitPhone: jest.fn(() => Promise.resolve()),
  v6Resend: jest.fn(() => Promise.resolve(true)),
  v6Poll: jest.fn(() => Promise.resolve()),
  v6Cancel: jest.fn(() => Promise.resolve()),
  v6Reset: jest.fn(() => Promise.resolve()),
  v6HandleRedirectUrl: jest.fn(() => Promise.resolve()),
  storeBackendOAuthTokens: jest.fn(() => Promise.resolve(true)),
  getDeviceDetails: jest.fn(() => Promise.resolve()),
  webLogin: jest.fn(() => Promise.resolve()),
  webApprove: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
