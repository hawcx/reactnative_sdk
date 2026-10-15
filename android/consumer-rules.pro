# Keep classes that React Native autolinking expects
-keep class com.hawcx.reactnative.** { *; }

# The bridge reports a prompt it doesn't map as {type: "unknown", rawType}, where
# rawType is the prompt's class name in wire form (AwaitApproval -> await_approval).
# Keep those names stable under R8 so rawType isn't an obfuscated "a".
-keepnames class com.hawcx.protocol.v1.HawcxV1UserPrompt
-keepnames class com.hawcx.protocol.v1.HawcxV1UserPrompt$*
