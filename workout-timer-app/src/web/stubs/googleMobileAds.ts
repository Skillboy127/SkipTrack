// Web only, wired in by metro.config.js: stands in for react-native-google-mobile-ads,
// whose import alone crashes a browser (it looks up native modules on load). The web
// version has no ads; the only shared use is Settings' preview-only Ad Inspector button,
// which is never shown on web.
const unavailable = () => Promise.reject(new Error('Ads are not available on the web version.'));

export default function mobileAds() {
  return {
    initialize: unavailable,
    openAdInspector: unavailable,
    setRequestConfiguration: unavailable,
  };
}

export const AdEventType = {};
export const RewardedAdEventType = {};
export const TestIds = {};
