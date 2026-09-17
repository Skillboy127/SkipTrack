import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useShareIntent } from 'expo-share-intent';
import * as Updates from 'expo-updates';
import { RootStackParamList } from './src/types';

import { LibraryScreen } from './src/screens/LibraryScreen';
import { WorkoutEditorScreen } from './src/screens/WorkoutEditorScreen';
import { ImportScreen } from './src/screens/ImportScreen';
import { WorkoutPreviewScreen } from './src/screens/WorkoutPreviewScreen';
import { ActiveSessionScreen } from './src/screens/ActiveSessionScreen';
import { CompletionScreen } from './src/screens/CompletionScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

export default function App() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const pendingShareRef = useRef<string | null>(null);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;

    const checkForUpdates = async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable || cancelled) return;

        const fetchedUpdate = await Updates.fetchUpdateAsync();
        if (fetchedUpdate.isNew && !cancelled) {
          await Updates.reloadAsync();
        }
      } catch (error) {
        console.warn('OTA update check failed:', error);
      }
    };

    void checkForUpdates();

    return () => {
      cancelled = true;
    };
  }, []);

  const openPendingShare = () => {
    const targetUrl = pendingShareRef.current;
    if (!targetUrl || !navigationRef.isReady()) return;
    navigationRef.navigate('ImportVideo', { initialUrl: targetUrl });
    pendingShareRef.current = null;
    resetShareIntent();
  };

  // Handle incoming Android share intents (e.g., sharing a video from the YouTube app)
  useEffect(() => {
    if (hasShareIntent && shareIntent) {
      const raw = shareIntent.webUrl || shareIntent.text || '';
      const targetUrl = extractUrl(raw) || (raw.startsWith('http') ? raw.trim() : raw.trim());

      if (targetUrl) {
        pendingShareRef.current = targetUrl;
        openPendingShare();
      }
    }
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer ref={navigationRef} onReady={openPendingShare}>
        <Stack.Navigator initialRouteName="Library">
          <Stack.Screen 
            name="Library" 
            component={LibraryScreen} 
            options={{ headerShown: false }} 
          />
          <Stack.Screen 
            name="WorkoutEditor" 
            component={WorkoutEditorScreen} 
            options={{ headerShown: false }} 
          />
          <Stack.Screen 
            name="ImportVideo" 
            component={ImportScreen} 
            options={{ headerShown: false }} 
          />
          <Stack.Screen 
            name="WorkoutPreview" 
            component={WorkoutPreviewScreen} 
            options={{ headerShown: false }} 
          />
          <Stack.Screen 
            name="ActiveSession" 
            component={ActiveSessionScreen} 
            options={{ headerShown: false, gestureEnabled: false }} 
          />
          <Stack.Screen 
            name="Completion" 
            component={CompletionScreen} 
            options={{ headerShown: false, gestureEnabled: false }} 
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
