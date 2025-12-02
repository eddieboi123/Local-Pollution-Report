import { Component, OnInit } from '@angular/core';
import { AuthService, AppUser } from '../services/auth-guard';
import { Firestore, doc, updateDoc, Timestamp } from '@angular/fire/firestore';
import { Auth, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  templateUrl: './settings-page.html',
  styleUrls: ['./settings-page.css'],
  imports: [FormsModule, CommonModule, RouterLink]
})
export class SettingsPage implements OnInit {
  user$: Observable<AppUser | null>;
  currentUser: AppUser | null = null;
  settings = {
    language: 'english' as 'english' | 'filipino',
    textSize: 'medium' as 'small' | 'medium' | 'large',
    theme: 'light' as 'light' | 'dark',
    notifications: { email: true, announcement: true, upvote: true }
  };

  // Change Password fields
  passwordForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };
  passwordError = '';
  passwordSuccess = '';
  isChangingPassword = false;

  // Loading states
  isSavingSettings = false;

  toasts: { message: string; type: string }[] = [];

  constructor(
    private authService: AuthService,
    private firebaseAuth: Auth,
    private firestore: Firestore,
    private router: Router
  ) {
    this.user$ = this.authService.user$;
  }

  async ngOnInit() {
    // Load user settings from Firestore
    this.user$.pipe(take(1)).subscribe(user => {
      this.currentUser = user;
      if (user?.settings) {
        this.settings = { ...user.settings };
        this.applySettings();
      } else {
        // Apply default settings
        this.applySettings();
      }
    });
  }

  async saveSettings() {
    if (this.isSavingSettings) return;

    const user = await this.user$.pipe(take(1)).toPromise();
    if (!user) {
      this.showToast('Please login to save settings', 'danger');
      return;
    }

    this.isSavingSettings = true;
    try {
      const userRef = doc(this.firestore, `users/${user.uid}`);
      const updatedSettings = {
        settings: {
          ...this.settings,
          updatedAt: Timestamp.now()
        }
      };

      await updateDoc(userRef, updatedSettings);
      localStorage.setItem('userSettings', JSON.stringify(this.settings));
      this.applySettings();
      this.showToast('Settings saved successfully!', 'success');
    } catch (error: any) {
      console.error('Failed to save settings:', error);
      this.showToast('Failed to save settings. Please try again.', 'danger');
    } finally {
      this.isSavingSettings = false;
    }
  }

  async changePassword() {
    // Reset messages
    this.passwordError = '';
    this.passwordSuccess = '';

    // Validation
    if (!this.passwordForm.currentPassword) {
      this.passwordError = 'Please enter your current password.';
      return;
    }

    if (!this.passwordForm.newPassword) {
      this.passwordError = 'Please enter a new password.';
      return;
    }

    if (this.passwordForm.newPassword.length < 6) {
      this.passwordError = 'New password must be at least 6 characters.';
      return;
    }

    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      this.passwordError = 'New passwords do not match.';
      return;
    }

    if (this.passwordForm.currentPassword === this.passwordForm.newPassword) {
      this.passwordError = 'New password must be different from current password.';
      return;
    }

    this.isChangingPassword = true;

    try {
      const user = this.firebaseAuth.currentUser;
      if (!user || !user.email) {
        throw new Error('No authenticated user found.');
      }

      // Reauthenticate user
      const credential = EmailAuthProvider.credential(
        user.email,
        this.passwordForm.currentPassword
      );

      await reauthenticateWithCredential(user, credential);

      // Update password
      await updatePassword(user, this.passwordForm.newPassword);

      // Success
      this.passwordSuccess = 'Password updated successfully!';
      this.showToast('Password updated successfully!', 'success');

      // Clear form
      this.passwordForm = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      };

    } catch (error: any) {
      console.error('Password change error:', error);

      // Translate Firebase errors
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        this.passwordError = 'Current password is incorrect.';
      } else if (error.code === 'auth/weak-password') {
        this.passwordError = 'New password is too weak. Use at least 6 characters.';
      } else if (error.code === 'auth/requires-recent-login') {
        this.passwordError = 'Please logout and login again before changing password.';
      } else if (error.code === 'auth/too-many-requests') {
        this.passwordError = 'Too many attempts. Please try again later.';
      } else {
        this.passwordError = error.message || 'Failed to update password. Please try again.';
      }

      this.showToast(this.passwordError, 'danger');
    } finally {
      this.isChangingPassword = false;
    }
  }

  showToast(message: string, type: string) {
    const toast = { message, type };
    this.toasts.push(toast);
    setTimeout(() => this.removeToast(toast), 4000);
  }

  removeToast(toast: { message: string; type: string }) {
    this.toasts = this.toasts.filter(t => t !== toast);
  }

  async logout() {
    try {
      await this.authService.logout();
      await this.router.navigate(['/login']);
    } catch (err) {
      console.error('Logout failed', err);
    }
  }

  applySettings() {
    console.log('Applying settings:', this.settings);

    // Language: set document language attribute
    document.documentElement.lang = this.settings.language === 'filipino' ? 'fil' : 'en';
    console.log('Language set to:', document.documentElement.lang);

    // Text size: apply a class to body
    document.body.classList.remove('text-small', 'text-medium', 'text-large');
    document.body.classList.add(`text-${this.settings.textSize}`);
    console.log('Text size class:', `text-${this.settings.textSize}`);

    // Theme: apply dark-mode class to body (matching global styles.css)
    if (this.settings.theme === 'dark') {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('theme-light', 'theme-dark');
    } else {
      document.body.classList.remove('dark-mode', 'theme-dark');
      document.body.classList.add('theme-light');
    }
    console.log('Theme class applied:', this.settings.theme);
    console.log('Body classes:', document.body.className);

    // Store in localStorage for immediate access on next page load
    localStorage.setItem('userSettings', JSON.stringify(this.settings));
  }  // Apply theme immediately on change (for instant feedback)
  onThemeChange() {
    console.log('Theme changed to:', this.settings.theme);
    this.applySettings();
  }

  onLanguageChange() {
    console.log('Language changed to:', this.settings.language);
    this.applySettings();
  }

  onTextSizeChange() {
    console.log('Text size changed to:', this.settings.textSize);
    this.applySettings();
  }
}
