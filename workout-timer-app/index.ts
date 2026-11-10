import { registerRootComponent } from 'expo';

import App from './App';
import { registerWorkoutHeadlessTask } from './src/background/workoutService';

// The Android background workout service runs a Headless JS task for the whole
// workout (see src/background/workoutService.ts); it must be registered before
// the root component, like any headless task.
registerWorkoutHeadlessTask();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
