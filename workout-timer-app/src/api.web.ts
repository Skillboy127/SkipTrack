// Web version of api.ts. The web version never talks to the Flex server: no
// imports through Gemini, no usage counts, no device ID. Only what shared screens
// import is provided, and it does nothing.
import type { ServerUsage } from './types';

export async function refreshUsage(): Promise<ServerUsage | null> {
  return null;
}
