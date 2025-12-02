import { Injectable } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { AuthService, AppUser } from './auth-guard';
import { Observable, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  constructor(private firestore: Firestore, private authService: AuthService) {
    // Apply saved settings on service initialization
    this.initializeSettings();
  }

  private initializeSettings() {
    // Apply settings from localStorage immediately (for fast load)
    const savedSettings = localStorage.getItem('userSettings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        this.applyTheme(settings.theme || 'light');
        this.applyLanguage(settings.language || 'english');
        this.applyTextSize(settings.textSize || 'medium');
      } catch (error) {
        console.error('Failed to parse saved settings:', error);
      }
    }

    // Subscribe to user settings changes
    this.getSettings().subscribe(settings => {
      if (settings) {
        this.applyTheme(settings.theme || 'light');
        this.applyLanguage(settings.language || 'english');
        this.applyTextSize(settings.textSize || 'medium');
        localStorage.setItem('userSettings', JSON.stringify(settings));
      }
    });
  }

  getSettings(): Observable<AppUser['settings'] | null> {
    return this.authService.user$.pipe(
      switchMap(user => {
        if (!user) return of(null);
        const userDoc = doc(this.firestore, `users/${user.uid}`);
        return docData(userDoc, { idField: 'uid' }) as Observable<AppUser>;
      }),
      map(user => user?.settings || null)
    );
  }

  private applyTheme(theme: 'light' | 'dark') {
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('theme-light', 'theme-dark');
    } else {
      document.body.classList.remove('dark-mode', 'theme-dark');
      document.body.classList.add('theme-light');
    }
  }

  private applyLanguage(language: 'english' | 'filipino') {
    document.documentElement.lang = language === 'filipino' ? 'fil' : 'en';
  }

  private applyTextSize(textSize: 'small' | 'medium' | 'large') {
    document.body.classList.remove('text-small', 'text-medium', 'text-large');
    document.body.classList.add(`text-${textSize}`);
  }
}
