import { Component, OnInit } from '@angular/core';
import { AuthService, AppUser } from '../services/auth-guard';
import { BarangaysService } from '../services/barangays.service';
import { ReportsService } from '../services/reports';
import { Report } from '../interfaces';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, RouterLinkActive } from '@angular/router';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { Firestore, doc, updateDoc } from '@angular/fire/firestore';
import { NotificationService } from '../services/notification.service';
import { NotificationsService } from '../services/notifications.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.html',
  imports: [FormsModule, CommonModule, RouterLink, RouterLinkActive]
})
export class Profile implements OnInit {
  user$: Observable<AppUser | null>;
  barangayName$ = new Observable<string>();
  uploadingImage = false;
  currentUser: AppUser | null = null;

  // User report statistics
  totalUserReports$!: Observable<number>;
  pendingUserReports$!: Observable<number>;
  inProgressUserReports$!: Observable<number>;
  resolvedUserReports$!: Observable<number>;

  // Unread notifications count
  unreadNotificationCount = 0;

  // Admin pending approval count
  adminPendingApprovalCount = 0;

  // Profile dropdown state
  showProfileMenu = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private barangaysService: BarangaysService,
    private reportsService: ReportsService,
    private storage: Storage,
    private firestore: Firestore,
    private notify: NotificationService,
    private notificationsService: NotificationsService
  ) {
    this.user$ = this.auth.user$;
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
  }

  ngOnInit(): void {
    // Get barangay name based on user's barangay ID
    this.barangayName$ = this.user$.pipe(
      switchMap(user => {
        this.currentUser = user;
        if (!user?.barangay) {
          return new Observable<string>(observer => {
            observer.next('Admin');
            observer.complete();
          });
        }
        return this.barangaysService.getAllBarangays().pipe(
          map(barangays => {
            const barangay = barangays.find(b => b.id === user.barangay);
            return barangay ? barangay.name : user.barangay;
          })
        );
      })
    );

    // Calculate user's report statistics
    const userReports$: Observable<Report[]> = this.user$.pipe(
      switchMap(user => {
        if (!user) return of([]);
        return this.reportsService.getAllReports().pipe(
          map(reports => reports.filter(r => (r as any).reporterId === user.uid))
        );
      })
    );

    this.totalUserReports$ = userReports$.pipe(
      map(reports => reports.length)
    );

    // Pending = not yet approved by admin
    this.pendingUserReports$ = userReports$.pipe(
      map(reports => reports.filter(r => !r.approved).length)
    );

    // In Progress = approved and being worked on
    this.inProgressUserReports$ = userReports$.pipe(
      map(reports => reports.filter(r => r.approved && r.status === 'In Progress').length)
    );

    // Resolved = marked as Done
    this.resolvedUserReports$ = userReports$.pipe(
      map(reports => reports.filter(r => r.status === 'Done').length)
    );

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

  async onProfilePictureChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !this.currentUser) return;

    const file = input.files[0];

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.notify.warning('Please select an image file', 'Invalid File');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      this.notify.warning('Image size should be less than 5MB', 'File Too Large');
      return;
    }

    try {
      this.uploadingImage = true;

      // Create a unique filename
      const timestamp = Date.now();
      const filename = `profile-pictures/${this.currentUser.uid}_${timestamp}`;
      const storageRef = ref(this.storage, filename);

      // Upload the file
      await uploadBytes(storageRef, file);

      // Get the download URL
      const downloadURL = await getDownloadURL(storageRef);

      // Update user document in Firestore
      const userRef = doc(this.firestore, `users/${this.currentUser.uid}`);
      await updateDoc(userRef, {
        profilePictureUrl: downloadURL
      });

      this.uploadingImage = false;
      this.notify.success('Profile picture updated successfully!', 'Success');
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      this.uploadingImage = false;
      this.notify.error('Failed to upload profile picture. Please try again.', 'Upload Failed');
    }
  }

  toggleProfileMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.showProfileMenu = !this.showProfileMenu;
  }

  async logout() {
    try {
      await this.auth.logout();
      await this.router.navigate(['/login']);
    } catch (err) {
      console.error('Logout failed', err);
    }
  }

  toDate(timestamp: any): Date {
    if (!timestamp) return new Date();
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp instanceof Date) {
      return timestamp;
    }
    return new Date(timestamp);
  }
}
