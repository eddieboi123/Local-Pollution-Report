import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, RouterLinkActive } from '@angular/router';
import { Subscription, of, Observable } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { AuthService, AppUser } from '../services/auth-guard';
import { NotificationsService } from '../services/notifications.service';
import { NotificationService } from '../services/notification.service';
import { ReportsService } from '../services/reports';
import { AppNotification } from '../interfaces';
import { NotificationModalComponent } from '../shared/notification-modal.component';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.html',
  styleUrls: ['./notifications.css'],
  imports: [CommonModule, RouterLink, RouterLinkActive, NotificationModalComponent]
})
export class NotificationsComponent implements OnInit, OnDestroy {
  notifications: AppNotification[] = [];
  currentUser: AppUser | null = null;
  user$!: Observable<AppUser | null>;
  isLoading = true;
  filter: 'all' | 'unread' = 'all';

  // Admin pending approval count
  adminPendingApprovalCount = 0;

  // Profile dropdown state
  showProfileMenu = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private authService: AuthService,
    private notificationsService: NotificationsService,
    private notify: NotificationService,
    private router: Router,
    private reportsService: ReportsService
  ) {
    this.user$ = this.authService.user$;

    // Close dropdown when clicking outside
    document.addEventListener('click', (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-dropdown')) {
        this.showProfileMenu = false;
      }
    });
  }

  ngOnInit() {
    this.subscriptions.push(
      this.authService.user$.subscribe(user => {
        this.currentUser = user;
        if (user) {
          this.loadNotifications();
          // Load admin pending approval count (for admin badge in navbar)
          if (user.role === 'admin') {
            this.subscriptions.push(
              this.reportsService.getAllReports().pipe(
                map(reports => reports.filter(r => r.approved === false || r.approved === undefined || r.approved === null).length)
              ).subscribe(count => this.adminPendingApprovalCount = count)
            );
          }
        } else {
          this.notifications = [];
          this.isLoading = false;
        }
      })
    );
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  loadNotifications() {
    if (!this.currentUser) return;

    this.isLoading = true;
    this.subscriptions.push(
      this.notificationsService.getUserNotifications(this.currentUser.uid).subscribe(
        notifications => {
          this.notifications = notifications;
          this.isLoading = false;
        },
        error => {
          console.error('Error loading notifications:', error);
          this.isLoading = false;
        }
      )
    );
  }

  get filteredNotifications(): AppNotification[] {
    if (this.filter === 'unread') {
      return this.notifications.filter(n => !n.read);
    }
    return this.notifications;
  }

  get unreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  setFilter(filter: 'all' | 'unread') {
    this.filter = filter;
  }

  async markAsRead(notification: AppNotification) {
    if (!notification.id || notification.read) return;

    try {
      await this.notificationsService.markAsRead(notification.id);
      notification.read = true;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      this.notify.error('Failed to mark notification as read');
    }
  }

  async markAllAsRead() {
    if (!this.currentUser) return;

    try {
      await this.notificationsService.markAllAsRead(this.currentUser.uid);
      this.notifications.forEach(n => n.read = true);
      this.notify.success('All notifications marked as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
      this.notify.error('Failed to mark all as read');
    }
  }

  async deleteNotification(notification: AppNotification, event: Event) {
    event.stopPropagation();
    if (!notification.id) return;

    const confirmed = await this.notify.confirm(
      'Are you sure you want to delete this notification?',
      'Delete Notification',
      'Yes, Delete',
      'Cancel'
    );

    if (!confirmed) return;

    try {
      await this.notificationsService.deleteNotification(notification.id);
      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.notify.success('Notification deleted');
    } catch (error) {
      console.error('Error deleting notification:', error);
      this.notify.error('Failed to delete notification');
    }
  }

  async deleteAllNotifications() {
    if (!this.currentUser) return;

    const confirmed = await this.notify.confirm(
      'Are you sure you want to delete all notifications? This action cannot be undone.',
      'Clear All Notifications',
      'Yes, Clear All',
      'Cancel'
    );

    if (!confirmed) return;

    try {
      await this.notificationsService.deleteAllNotifications(this.currentUser.uid);
      this.notifications = [];
      this.notify.success('All notifications cleared');
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      this.notify.error('Failed to clear notifications');
    }
  }

  navigateToNotification(notification: AppNotification) {
    // Mark as read
    this.markAsRead(notification);

    // Navigate based on notification type
    if (notification.reportId) {
      // Navigate to report - for admins go to admin dashboard, for users go to home
      if (this.currentUser?.role === 'admin') {
        if (notification.barangayId && notification.barangayId !== 'main') {
          this.router.navigate(['/admin/barangay', notification.barangayId]);
        } else {
          this.router.navigate(['/admin']);
        }
      } else {
        this.router.navigate(['/']);
      }
    } else if (notification.announcementId) {
      this.router.navigate(['/']);
    }
  }

  getIcon(type: string): string {
    return this.notificationsService.getNotificationIcon(type);
  }

  formatTime(timestamp: any): string {
    return this.notificationsService.formatTime(timestamp);
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
}
