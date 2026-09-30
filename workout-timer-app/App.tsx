import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Updates from 'expo-updates';
import mobileAds from 'react-native-google-mobile-ads';
import { RootStackParamList } from './src/types';

import { LibraryScreen } from './src/screens/LibraryScreen';
import { WorkoutEditorScreen } from './src/screens/WorkoutEditorScreen';
import { ImportScreen } from './src/screens/ImportScreen';
import { WorkoutPreviewScreen } from './src/screens/WorkoutPreviewScreen';
import { ActiveSessionScreen } from './src/screens/ActiveSessionScreen';
import { CompletionScreen } from './src/screens/CompletionScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  // Required once at startup before any BannerAd can load.
  useEffect(() => {
    mobileAds()
      .initialize()
      .catch(error => console.warn('Mobile Ads SDK failed to initialize:', error));
  }, []);

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

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer ref={navigationRef}>
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
            name="Import"
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
          <Stack.Screen
            name="History"
            component={HistoryScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
