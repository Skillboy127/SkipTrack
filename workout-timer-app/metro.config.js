// Expo's default Metro config, plus one web-only rule. Android and iOS bundling
// is unchanged: the rule below only applies when the platform is 'web'.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Native-only packages that crash a browser just by being imported, swapped for
// harmless stand-ins in the web build (the web version has no ads).
const WEB_ONLY_STUBS = {
  'react-native-google-mobile-ads': path.resolve(__dirname, 'src/web/stubs/googleMobileAds.ts'),
};

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_ONLY_STUBS[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_ONLY_STUBS[moduleName] };
  }
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
