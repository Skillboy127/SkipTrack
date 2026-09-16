const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!configuredApiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL is not configured. Add it to workout-timer-app/.env.');
}

export const API_BASE_URL = configuredApiUrl.replace(/\/+$/, '');
