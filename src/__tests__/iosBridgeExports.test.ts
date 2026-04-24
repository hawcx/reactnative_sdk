import fs from 'fs';
import path from 'path';

describe('iOS bridge exports', () => {
  const iosDir = path.resolve(__dirname, '../../ios');
  const srcDir = path.resolve(__dirname, '..');
  const indexSource = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  const objcBridge = fs.readFileSync(path.join(iosDir, 'HawcxReactNative.m'), 'utf8');
  const swiftBridge = fs.readFileSync(path.join(iosDir, 'HawcxReactNative.swift'), 'utf8');
  const normalizedObjcBridge = objcBridge.replace(/\s+/g, ' ');
  const normalizedSwiftBridge = swiftBridge.replace(/\s+/g, ' ');

  const exportedObjcMethods = Array.from(
    objcBridge.matchAll(/RCT_EXTERN_METHOD\(([A-Za-z0-9_]+)/g),
    (match) => match[1],
  ).sort();

  const swiftObjcMethods = Array.from(
    swiftBridge.matchAll(/@objc\s*(?:\([^)]*\))?\s*\n\s*func\s+([A-Za-z0-9_]+)/g),
    (match) => match[1],
  ).sort();

  const nativeBridgeBlock = indexSource.match(/type NativeBridge = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  const javascriptNativeMethods = Array.from(
    nativeBridgeBlock.matchAll(/^\s*([A-Za-z0-9_]+)\s*\(/gm),
    (match) => match[1],
  ).sort();

  it('exports backend token persistence to React Native', () => {
    expect(swiftBridge).toContain('func storeBackendOAuthTokens(_ userId: NSString,');
    expect(objcBridge).toContain('RCT_EXTERN_METHOD(storeBackendOAuthTokens:(NSString *)userId');
    expect(objcBridge).toContain('accessToken:(NSString *)accessToken');
    expect(objcBridge).toContain('refreshToken:(id)refreshToken');
  });

  it('keeps iOS Objective-C exports backed by Swift implementations', () => {
    const swiftMethodSet = new Set(swiftObjcMethods);
    const missingSwiftImplementations = exportedObjcMethods.filter(
      (method) => !swiftMethodSet.has(method),
    );

    expect(missingSwiftImplementations).toEqual([]);
  });

  it('keeps JavaScript iOS native methods backed by iOS bridge exports', () => {
    const iosExcludedMethods = new Set(['setFcmToken']);
    const objcMethodSet = new Set(exportedObjcMethods);
    const swiftMethodSet = new Set(swiftObjcMethods);
    const iosJavascriptMethods = javascriptNativeMethods.filter(
      (method) => !iosExcludedMethods.has(method),
    );

    const missingObjcExports = iosJavascriptMethods.filter((method) => !objcMethodSet.has(method));
    const missingSwiftImplementations = iosJavascriptMethods.filter(
      (method) => !swiftMethodSet.has(method),
    );

    expect(missingObjcExports).toEqual([]);
    expect(missingSwiftImplementations).toEqual([]);
  });

  it('keeps post-auth and push helper selectors signature-compatible', () => {
    const expectedSignatures = [
      {
        objc: 'RCT_EXTERN_METHOD(storeBackendOAuthTokens:(NSString *)userId accessToken:(NSString *)accessToken refreshToken:(id)refreshToken resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)',
        swift:
          'func storeBackendOAuthTokens(_ userId: NSString, accessToken: NSString, refreshToken: Any?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)',
      },
      {
        objc: 'RCT_EXTERN_METHOD(setApnsDeviceToken:(NSString *)tokenBase64 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)',
        swift:
          'func setApnsDeviceToken(_ tokenBase64: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)',
      },
      {
        objc: 'RCT_EXTERN_METHOD(userDidAuthenticate:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)',
        swift:
          'func userDidAuthenticate(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)',
      },
      {
        objc: 'RCT_EXTERN_METHOD(handlePushNotification:(NSDictionary *)payload resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)',
        swift:
          'func handlePushNotification(_ payload: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)',
      },
      {
        objc: 'RCT_EXTERN_METHOD(approvePushRequest:(NSString *)requestId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)',
        swift:
          'func approvePushRequest(_ requestId: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)',
      },
      {
        objc: 'RCT_EXTERN_METHOD(declinePushRequest:(NSString *)requestId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)',
        swift:
          'func declinePushRequest(_ requestId: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)',
      },
    ];

    expectedSignatures.forEach(({ objc, swift }) => {
      expect(normalizedObjcBridge).toContain(objc);
      expect(normalizedSwiftBridge).toContain(swift);
    });
  });
});
