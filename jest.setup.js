import { NativeModules } from 'react-native';

NativeModules.HawcxReactNative = NativeModules.HawcxReactNative || {
  initialize: jest.fn(() => Promise.resolve()),
  authenticate: jest.fn(() => Promise.resolve()),
  submitOtp: jest.fn(() => Promise.resolve()),
  getDeviceDetails: jest.fn(() => Promise.resolve()),
  webLogin: jest.fn(() => Promise.resolve()),
  webApprove: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
