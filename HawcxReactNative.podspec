require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'HawcxReactNative'
  s.version      = package['version']
  s.summary      = 'React Native bindings for the Hawcx mobile authentication SDKs (V5 + V6).'
  s.description  = <<-DESC
    Production-grade React Native bridge that wraps HawcxFramework (iOS) to expose
    Hawcx V5 and V6 authentication, device trust, push, and web session flows to JavaScript callers.
  DESC
  s.homepage     = 'https://github.com/hawcx/reactnative_sdk'
  s.license      = { :type => 'MIT', :file => 'LICENSE' }
  s.author       = { 'Hawcx Engineering' => 'engineering@hawcx.com' }
  s.source       = { :git => 'https://github.com/hawcx/reactnative_sdk.git', :tag => "v#{s.version}" }

  s.platform     = :ios, '17.5'
  s.swift_version = '5.9'

  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.exclude_files = 'ios/Frameworks/**/*.h'
  s.vendored_frameworks = 'ios/Frameworks/HawcxFramework.xcframework'

  s.dependency 'React-Core'
end
