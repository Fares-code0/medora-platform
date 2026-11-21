import { registerRootComponent } from 'expo';

import { App } from './src/bootstrap/App';
import { track } from './src/utils/analytics';
import { installCrashReporting } from './src/utils/monitoring';

// Before the first render, deliberately (checklist W-04). A crash during
// the provider stack's own mount — a bad stored preference, an invalid
// environment — is exactly the crash worth reporting, and installing this
// from inside a React effect would miss it: effects run after the render
// that would have thrown.
installCrashReporting();

// The one event nothing else can report: a build that crashes during the
// provider stack's mount still launched, and the difference between
// "installed" and "runs" is invisible without this.
track('app.launched');

// `registerRootComponent` calls AppRegistry.registerComponent('main', …)
// and sets up the environment for Expo Go and a development build alike.
registerRootComponent(App);
