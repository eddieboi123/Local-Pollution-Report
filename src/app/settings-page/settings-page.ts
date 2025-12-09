import { Component, OnInit } from '@angular/core';
import { AuthService, AppUser } from '../services/auth-guard';
import { Firestore, doc, updateDoc, Timestamp } from '@angular/fire/firestore';
import { Auth, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { take, switchMap, map } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, RouterLinkActive } from '@angular/router';
import { TranslationService } from '../services/translation.service';
import { NotificationsService } from '../services/notifications.service';
import { ReportsService } from '../services/reports';

@Component({
  selector: 'app-settings',
  templateUrl: './settings-page.html',
  styleUrls: ['./settings-page.css'],
  imports: [FormsModule, CommonModule, RouterLink, RouterLinkActive]
})
export class SettingsPage implements OnInit {
  user$: Observable<AppUser | null>;
  currentUser: AppUser | null = null;

  settings = {
    language: 'english' as 'english' | 'filipino',
    textSize: 'medium' as 'small' | 'medium' | 'large',
    theme: 'light' as 'light' | 'dark',
    notifications: {
      email: true,
      announcement: true,
      upvote: true,
      reportStatus: true,
      passwordChange: true
    }
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

  // Password change verification
  passwordChangeStep: 'form' | 'verify' = 'form';
  passwordVerificationCode = '';
  isSendingPasswordCode = false;
  isVerifyingPasswordCode = false;
  passwordCodeSent = false;

  // Email Verification fields
  emailVerificationCode = '';
  isSendingVerificationCode = false;
  isVerifyingEmail = false;
  verificationCodeSent = false;
  emailVerificationError = '';
  emailVerificationSuccess = '';

  // Loading states
  isSavingSettings = false;

  toasts: { message: string; type: string }[] = [];

  // Unread notifications count
  unreadNotificationCount = 0;

  // Admin pending approval count
  adminPendingApprovalCount = 0;

  // Profile dropdown state
  showProfileMenu = false;

  constructor(
    private authService: AuthService,
    private firebaseAuth: Auth,
    private firestore: Firestore,
    private functions: Functions,
    private router: Router,
    private translationService: TranslationService,
    private notificationsService: NotificationsService,
    private reportsService: ReportsService
  ) {
    this.user$ = this.authService.user$;
    // Load unread notification count
    this.user$.pipe(
      switchMap(user => user ? this.notificationsService.getUnreadCount(user.uid) : of(0))
    ).subscribe(count => this.unreadNotificationCount = count);

    // Close dropdown when clicking outside
    document.addEventListener('click', (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-dropdown')) {
        this.showProfileMenu = false;
      }
    });

    // Load admin pending approval count (for admin badge in navbar)
    this.user$.pipe(
      switchMap(user => {
        if (!user || user.role !== 'admin') return of(0);
        return this.reportsService.getAllReports().pipe(
          map(reports => reports.filter(r => r.approved === false || r.approved === undefined || r.approved === null).length)
        );
      })
    ).subscribe(count => this.adminPendingApprovalCount = count);
  }

  async ngOnInit() {
    // Load user settings from Firestore
    this.user$.pipe(take(1)).subscribe(user => {
      this.currentUser = user;
      if (user) {
        if (user.settings) {
          // Merge user settings with defaults to ensure new properties exist
          this.settings = {
            ...this.settings,
            ...user.settings,
            notifications: {
              ...this.settings.notifications,
              ...user.settings.notifications
            }
          };
        }
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

    // First verify current password before sending code
    this.isChangingPassword = true;
    try {
      const user = this.firebaseAuth.currentUser;
      if (!user || !user.email) {
        throw new Error('No authenticated user found.');
      }

      // Reauthenticate to verify current password
      const credential = EmailAuthProvider.credential(
        user.email,
        this.passwordForm.currentPassword
      );
      await reauthenticateWithCredential(user, credential);

      // Current password is correct, now send verification code
      this.isChangingPassword = false;
      await this.sendPasswordChangeCode();

    } catch (error: any) {
      this.isChangingPassword = false;
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        this.passwordError = 'Current password is incorrect.';
      } else if (error.code === 'auth/too-many-requests') {
        this.passwordError = 'Too many attempts. Please try again later.';
      } else {
        this.passwordError = error.message || 'Failed to verify password.';
      }
      this.showToast(this.passwordError, 'danger');
    }
  }

  async sendPasswordChangeCode() {
    if (this.isSendingPasswordCode) return;

    this.passwordError = '';
    this.isSendingPasswordCode = true;

    try {
      const sendCode = httpsCallable(this.functions, 'sendPasswordChangeCode');
      const result = await sendCode({});
      const data = result.data as any;

      if (data.success) {
        this.passwordChangeStep = 'verify';
        this.passwordCodeSent = true;
        this.showToast('Verification code sent to your email!', 'success');
      } else {
        this.passwordError = data.error || 'Failed to send verification code.';
        this.showToast(this.passwordError, 'danger');
      }
    } catch (error: any) {
      console.error('Failed to send password change code:', error);
      this.passwordError = 'Failed to send verification code. Please try again.';
      this.showToast(this.passwordError, 'danger');
    } finally {
      this.isSendingPasswordCode = false;
    }
  }

  async verifyAndChangePassword() {
    if (this.isVerifyingPasswordCode || !this.passwordVerificationCode) return;

    if (this.passwordVerificationCode.length !== 6) {
      this.passwordError = 'Please enter a valid 6-digit code.';
      return;
    }

    this.passwordError = '';
    this.isVerifyingPasswordCode = true;

    try {
      // Verify the code first
      const verifyCode = httpsCallable(this.functions, 'verifyPasswordChangeCode');
      const verifyResult = await verifyCode({ code: this.passwordVerificationCode });
      const verifyData = verifyResult.data as any;

      if (!verifyData.success) {
        this.passwordError = verifyData.message || 'Invalid verification code.';
        this.showToast(this.passwordError, 'danger');
        this.isVerifyingPasswordCode = false;
        return;
      }

      // Code verified, now change the password
      const user = this.firebaseAuth.currentUser;
      if (!user || !user.email) {
        throw new Error('No authenticated user found.');
      }

      // Reauthenticate again (session might have expired)
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

      // Clear form and reset step
      this.resetPasswordForm();

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
      this.isVerifyingPasswordCode = false;
    }
  }

  resetPasswordForm() {
    this.passwordForm = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    };
    this.passwordChangeStep = 'form';
    this.passwordVerificationCode = '';
    this.passwordCodeSent = false;
    this.passwordError = '';
  }

  cancelPasswordChange() {
    this.resetPasswordForm();
    this.passwordSuccess = '';
  }

  showToast(message: string, type: string) {
    const toast = { message, type };
    this.toasts.push(toast);
    setTimeout(() => this.removeToast(toast), 4000);
  }

  removeToast(toast: { message: string; type: string }) {
    this.toasts = this.toasts.filter(t => t !== toast);
  }

  toggleProfileMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.showProfileMenu = !this.showProfileMenu;
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

    // Language: set document language attribute and update translation service
    document.documentElement.lang = this.settings.language === 'filipino' ? 'fil' : 'en';
    this.translationService.setLanguage(this.settings.language);
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
  }  // Apply and auto-save appearance changes
  async onThemeChange() {
    console.log('Theme changed to:', this.settings.theme);
    this.applySettings();
    await this.autoSaveSettings();
  }

  async onTextSizeChange() {
    console.log('Text size changed to:', this.settings.textSize);
    this.applySettings();
    await this.autoSaveSettings();
  }

  async autoSaveSettings() {
    const user = await this.user$.pipe(take(1)).toPromise();
    if (!user) return;

    try {
      const userRef = doc(this.firestore, `users/${user.uid}`);
      await updateDoc(userRef, {
        settings: {
          ...this.settings,
          updatedAt: Timestamp.now()
        }
      });
      localStorage.setItem('userSettings', JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to auto-save settings:', error);
    }
  }

  // Send email verification code
  async sendEmailVerificationCode() {
    if (this.isSendingVerificationCode) return;

    this.emailVerificationError = '';
    this.emailVerificationSuccess = '';
    this.isSendingVerificationCode = true;

    try {
      const sendCode = httpsCallable(this.functions, 'sendEmailVerificationCode');
      const result = await sendCode({});
      const data = result.data as any;

      if (data.success) {
        this.verificationCodeSent = true;
        this.emailVerificationSuccess = 'Verification code sent to your email!';
        this.showToast('Verification code sent to your email!', 'success');
      } else {
        this.emailVerificationError = data.error || 'Failed to send verification code.';
        this.showToast(this.emailVerificationError, 'danger');
      }
    } catch (error: any) {
      console.error('Failed to send verification code:', error);
      // Handle Firebase function errors properly
      const errorMessage = error.code === 'functions/internal'
        ? 'Email service not configured. Please contact support.'
        : error.message || 'Failed to send verification code. Please try again.';
      this.emailVerificationError = errorMessage;
      this.showToast(this.emailVerificationError, 'danger');
    } finally {
      this.isSendingVerificationCode = false;
    }
  }

  // Verify email with code
  async verifyEmailCode() {
    if (this.isVerifyingEmail || !this.emailVerificationCode) return;

    if (this.emailVerificationCode.length !== 6) {
      this.emailVerificationError = 'Please enter a valid 6-digit code.';
      return;
    }

    this.emailVerificationError = '';
    this.emailVerificationSuccess = '';
    this.isVerifyingEmail = true;

    try {
      const verifyCode = httpsCallable(this.functions, 'verifyEmailCode');
      const result = await verifyCode({ code: this.emailVerificationCode });

      if ((result.data as any).success) {
        this.emailVerificationSuccess = 'Email verified successfully!';
        this.showToast('Email verified successfully! You can now receive email notifications.', 'success');
        this.verificationCodeSent = false;
        this.emailVerificationCode = '';

        // Update the current user object locally
        if (this.currentUser) {
          this.currentUser.emailVerified = true;
        }
      } else {
        this.emailVerificationError = (result.data as any).message || 'Verification failed.';
      }
    } catch (error: any) {
      console.error('Failed to verify email:', error);
      this.emailVerificationError = error.message || 'Failed to verify email. Please try again.';
      this.showToast(this.emailVerificationError, 'danger');
    } finally {
      this.isVerifyingEmail = false;
    }
  }

  // Cancel verification
  cancelEmailVerification() {
    this.verificationCodeSent = false;
    this.emailVerificationCode = '';
    this.emailVerificationError = '';
    this.emailVerificationSuccess = '';
  }
}
