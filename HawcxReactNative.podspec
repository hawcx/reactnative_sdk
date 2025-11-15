require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'HawcxReactNative'
  s.version      = package['version']
  s.summary      = 'React Native bindings for the Hawcx V5 mobile authentication framework.'
  s.description  = <<-DESC
    Production-grade React Native bridge that wraps HawcxFramework (iOS) to expose
    V5 authentication, OTP, push, and web session flows to JavaScript callers.
  DESC
  s.homepage     = 'https://github.com/hawcx/react-native-sdk'
  s.license      = { :type => 'MIT', :file => 'LICENSE' }
  s.author       = { 'Hawcx Engineering' => 'engineering@hawcx.com' }
  s.source       = { :git => 'https://github.com/hawcx/react-native-sdk.git', :tag => "v#{s.version}" }

  s.platform     = :ios, '14.0'
  s.swift_version = '5.9'

  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.vendored_frameworks = 'ios/Frameworks/HawcxFramework.xcframework'

  s.dependency 'React-Core'
end
