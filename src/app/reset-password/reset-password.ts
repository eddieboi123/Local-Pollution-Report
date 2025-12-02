import { Component } from '@angular/core';
import { AuthService } from '../services/auth-guard';
import { Auth, sendPasswordResetEmail } from '@angular/fire/auth';
import { Firestore, collection, addDoc, serverTimestamp } from '@angular/fire/firestore';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.html',
  imports: [RouterLink, FormsModule, CommonModule],
})
export class ResetPassword {
  email = '';
  message = '';
  errorMessage = '';
  cooldown = 60;
  canSend = true;
  isLoading = false;
  isInvalidEmail = false;

  constructor(
    private auth: Auth,
    private firestore: Firestore
  ) {}

  // Email validation
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Log reset request to Firestore
  private async logResetRequest(email: string, status: 'sent' | 'failed', errorMessage?: string): Promise<void> {
    try {
      const logsCollection = collection(this.firestore, 'password_reset_logs');
      await addDoc(logsCollection, {
        email,
        requestedAt: serverTimestamp(),
        status,
        errorMessage: errorMessage || null
      });
    } catch (error) {
      console.error('Failed to log reset request:', error);
    }
  }

  // Translate Firebase errors to user-friendly messages
  private translateFirebaseError(errorCode: string): string {
    switch (errorCode) {
      case 'auth/user-not-found':
        return 'No account found with that email.';
      case 'auth/invalid-email':
        return 'Please enter a valid email.';
      case 'auth/too-many-requests':
        return 'Too many reset attempts. Please try again later.';
      case 'auth/network-request-failed':
        return 'Network error. Please check your connection.';
      default:
        return 'Failed to send reset link. Please try again.';
    }
  }

  async onReset() {
    if (!this.canSend || this.isLoading) return;

    // Reset messages
    this.message = '';
    this.errorMessage = '';
    this.isInvalidEmail = false;

    // Trim whitespace
    this.email = this.email.trim();

    // Validate email
    if (!this.email) {
      this.errorMessage = 'Please enter your email address.';
      this.isInvalidEmail = true;
      return;
    }

    if (!this.isValidEmail(this.email)) {
      this.errorMessage = 'Please enter a valid email.';
      this.isInvalidEmail = true;
      return;
    }

    this.isLoading = true;

    try {
      // Send password reset email via Firebase
      console.log('Attempting to send reset email to:', this.email);
      await sendPasswordResetEmail(this.auth, this.email);
      console.log('✅ Firebase sendPasswordResetEmail succeeded');

      // Log success to Firestore
      await this.logResetRequest(this.email, 'sent');

      // Show success message
      this.message = 'A password reset link has been sent to your email. Check your spam folder if the reset link isn\'t in your inbox.';
      this.email = ''; // Clear email field

      // Start cooldown
      this.canSend = false;
      const interval = setInterval(() => {
        this.cooldown--;
        if (this.cooldown <= 0) {
          this.canSend = true;
          this.cooldown = 60;
          clearInterval(interval);
        }
      }, 1000);

    } catch (error: any) {
      const friendlyMessage = this.translateFirebaseError(error.code || error.message);
      this.errorMessage = friendlyMessage;
      this.isInvalidEmail = true;

      // Log failure to Firestore
      await this.logResetRequest(this.email, 'failed', error.code || error.message);
    } finally {
      this.isLoading = false;
    }
  }

  // Check if form is valid
  get isFormValid(): boolean {
    return this.email.trim().length > 0 && this.isValidEmail(this.email.trim());
  }
}
