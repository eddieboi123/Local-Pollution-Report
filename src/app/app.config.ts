import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

import { initializeApp, provideFirebaseApp, getApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { SettingsService } from './services/settings';

// Initialize settings service on app startup
export function initializeSettings(settingsService: SettingsService) {
  return () => {
    // Service constructor will handle initialization
    return Promise.resolve();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),

    // Firebase initialization
    provideFirebaseApp(() =>
      initializeApp({
        projectId: "local-pollution-report-app",
        appId: "1:511484801358:web:3de78999a872c66451ee1f",
        storageBucket: "local-pollution-report-app.firebasestorage.app",
        apiKey: "AIzaSyDo3JkHYYhZqNPaBLBHzPoywZwyRYVSBiA",
        authDomain: "local-pollution-report-app.firebaseapp.com",
        messagingSenderId: "511484801358"
      })
    ),

    // Firestore
    provideFirestore(() => getFirestore()),

    // Authentication
    provideAuth(() => getAuth()),

    // ✅ Firebase Storage (attach the app)
    provideStorage(() => getStorage(getApp())),

    // Firebase Functions
    provideFunctions(() => getFunctions()),

    // Initialize SettingsService on app startup
    {
      provide: APP_INITIALIZER,
      useFactory: initializeSettings,
      deps: [SettingsService],
      multi: true
    }
  ]
};
