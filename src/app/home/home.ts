import { Component, AfterViewInit, ChangeDetectionStrategy, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, of, switchMap, combineLatest, map, take } from 'rxjs';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { UsersService } from '../services/users';
import { AppUser, Report, Announcement } from '../interfaces';
import { AuthService } from '../services/auth-guard';
import { ReportsService } from '../services/reports';
import { AnnouncementsService } from '../services/announcements';
import { NotificationService } from '../services/notification.service';
import { NotificationsService } from '../services/notifications.service';
import * as L from 'leaflet';

interface EnrichedReport extends Report {
  id?: string;
  reporterProfilePic?: string | null;
  createdAtDate?: Date;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrls: ['./home.css'],
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Home implements AfterViewInit, OnDestroy {
  // Signals for reactive state
  searchTerm = signal('');
  selectedFilter = signal('Latest');
  selectedDate = signal('');
  commentTexts = signal<{ [reportId: string]: string }>({});
  selectedImage = signal<string | null>(null);
  showGoToTop = signal(false);
  showProfileMenu = signal(false);

  // Convert observables to signals (initialized in constructor)
  user!: ReturnType<typeof toSignal<AppUser | null>>;

  // Keep observables for compatibility
  user$: Observable<AppUser | null>;
  announcements$: Observable<Announcement[]>;

  // Enriched reports with pre-loaded user data
  private baseReports$: Observable<EnrichedReport[]>;
  private reports!: ReturnType<typeof toSignal<EnrichedReport[]>>;
  private usersMap = new Map<string, AppUser>();

  // All reports for admin statistics (including unapproved)
  private allReports!: ReturnType<typeof toSignal<Report[]>>;

  // Computed signal to check if current user is an admin (main admin or barangay admin)
  isAdmin = computed(() => {
    const user = this.user();
    return user?.role === 'admin';
  });

  // Filtered reports as computed signal
  filteredReports = computed(() => {
    const reports = this.reports();
    const search = this.searchTerm().toLowerCase();
    const filter = this.selectedFilter();
    const date = this.selectedDate();

    let filtered = reports;

    if (search) {
      filtered = filtered.filter(r =>
        r.description.toLowerCase().includes(search) ||
        r.location.toLowerCase().includes(search)
      );
    }

    if (filter === 'Yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      filtered = filtered.filter(r => {
        const reportDate = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
        reportDate.setHours(0, 0, 0, 0);
        return reportDate.getTime() === yesterday.getTime();
      });
    }

    if (filter === 'Select Date' && date) {
      const selected = new Date(date);
      selected.setHours(0, 0, 0, 0);
      filtered = filtered.filter(r => {
        const reportDate = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
        reportDate.setHours(0, 0, 0, 0);
        return reportDate.getTime() === selected.getTime();
      });
    }

    if (filter === 'Trending') {
      filtered = [...filtered].sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    }

    return filtered;
  });

  // Barangay metrics as computed signals
  totalReports = computed(() => this.reports().length);
  pendingReports = computed(() => this.reports().filter(r => r.status === 'Pending').length);
  resolvedReports = computed(() => this.reports().filter(r => r.status === 'Done').length);

  // Admin statistics (for statistics cards on home page)
  adminTotalReports = computed(() => this.allReports().filter(r => r.approved === true).length);
  adminPendingApprovalCount = computed(() => this.allReports().filter(r => r.approved === false || r.approved === undefined || r.approved === null).length);
  adminInProgressCount = computed(() => this.allReports().filter(r => r.approved === true && r.status === 'In Progress').length);
  adminDoneCount = computed(() => this.allReports().filter(r => r.approved === true && r.status === 'Done').length);

  // Map tracking
  private maps: { [reportId: string]: L.Map } = {};

  // Unread notifications count
  unreadNotificationCount = signal(0);

  constructor(
    private authService: AuthService,
    private reportsService: ReportsService,
    private announcementsService: AnnouncementsService,
    private usersService: UsersService,
    private router: Router,
    private notify: NotificationService,
    private notificationsService: NotificationsService
  ) {
    this.user$ = this.authService.user$;

    // Initialize signals that depend on services
    this.user = toSignal(this.authService.user$, { initialValue: null });
    this.baseReports$ = this.getEnrichedReports();
    this.reports = toSignal(this.baseReports$, { initialValue: [] });

    // Initialize all reports for admin statistics (including unapproved)
    const allReports$ = this.user$.pipe(
      switchMap(user => {
        if (!user || user.role !== 'admin') return of([]);
        const isMainAdmin = user.role === 'admin' && (!user.barangay || user.barangay === '');
        return isMainAdmin
          ? this.reportsService.getAllReports()
          : user.barangay
          ? this.reportsService.getReportsByBarangay(user.barangay)
          : of([]);
      })
    );
    this.allReports = toSignal(allReports$, { initialValue: [] });

    // Load announcements
    this.announcements$ = this.user$.pipe(
      switchMap(user => {
        if (!user) return of([]);
        const isMainAdmin = user.role === 'admin' && (!user.barangay || user.barangay === '');
        if (isMainAdmin) {
          return this.announcementsService.getAllAnnouncements();
        }
        return this.announcementsService.getAnnouncementsForBarangay(user?.barangay || null);
      })
    );

    // Load unread notification count
    this.user$.pipe(
      switchMap(user => user ? this.notificationsService.getUnreadCount(user.uid) : of(0))
    ).subscribe(count => this.unreadNotificationCount.set(count));

    // Listen to scroll events
    window.addEventListener('scroll', this.handleScroll);

    // Close dropdown when clicking outside
    document.addEventListener('click', this.handleClickOutside);
  }

  private handleClickOutside = (event: Event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.profile-dropdown')) {
      this.showProfileMenu.set(false);
    }
  };

  toggleProfileMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.showProfileMenu.update(v => !v);
  }

  private getEnrichedReports(): Observable<EnrichedReport[]> {
    return this.user$.pipe(
      switchMap(user => {
        if (!user) return of([]);
        const isMainAdmin = user.role === 'admin' && (!user.barangay || user.barangay === '');

        const reports$ = isMainAdmin
          ? this.reportsService.getAllReports()
          : user.barangay
          ? this.reportsService.getReportsByBarangay(user.barangay)
          : of([]);

        // Filter to only show approved reports on home page
        const approvedReports = reports$.pipe(
          map(reports => reports.filter(r => r.approved === true))
        );

        // Get only users referenced in reports for efficiency
        return approvedReports.pipe(
          switchMap(reports => {
            if (reports.length === 0) return of([]);

            // Extract unique user IDs from reports and comments
            const userIds = new Set<string>();
            reports.forEach(r => {
              if ((r as any).reporterId) userIds.add((r as any).reporterId);
              (r.comments || []).forEach(c => {
                if (c.userId) userIds.add(c.userId);
              });
            });

            // Load all users once (needed for dynamic lookups)
            return this.usersService.getAllUsers().pipe(
              map(users => {
                const userMap = new Map(users.map(u => [u.uid, u]));
                // Store in component for comment profile pictures
                this.usersMap = userMap;

                return reports.map(r => {
                  const images = Array.isArray(r.images) ? r.images : [];

                  let createdAtDate: Date;
                  if (r.createdAt && typeof (r.createdAt as any).toDate === 'function') {
                    createdAtDate = (r.createdAt as any).toDate();
                  } else if (r.createdAt instanceof Date) {
                    createdAtDate = r.createdAt as Date;
                  } else {
                    createdAtDate = new Date(r.createdAt as any);
                  }

                  const reporter = userMap.get((r as any).reporterId);
                  const reporterName = reporter ? (reporter.username || reporter.fullName || reporter.email || 'Anonymous') : (r.reporterName || 'Anonymous');
                  const reporterProfilePic = reporter?.profilePictureUrl || null;

                  return {
                    ...r,
                    images,
                    reporterName,
                    reporterProfilePic,
                    createdAt: createdAtDate
                  } as EnrichedReport;
                });
              })
            );
          })
        );
      })
    );
  }

  // Triggered by the search button
  onSearch() {
    this.selectedFilter.set('Latest');
  }

  // Update search term
  updateSearchTerm(term: string) {
    this.searchTerm.set(term);
  }

  // Update selected filter
  updateFilter(filter: string) {
    this.selectedFilter.set(filter);
  }

  // Update selected date
  updateDate(date: string) {
    this.selectedDate.set(date);
  }

  // Upvote a report (calls ReportsService)
  async upvote(report: EnrichedReport) {
    if (!report.id) return;

    const user = this.user();
    if (!user) {
      this.notify.warning('Please login to upvote reports', 'Login Required');
      this.router.navigate(['/login']);
      return;
    }

    if (user.role === 'admin') {
      this.notify.info('Admins cannot upvote reports', 'Not Allowed');
      return;
    }

    const upvotedBy = report.upvotedBy || [];
    if (upvotedBy.includes(user.uid)) {
      this.notify.info('You have already upvoted this report', 'Already Upvoted');
      return;
    }

    try {
      await this.reportsService.upvoteReport(report.id, user.uid);
      this.notify.success('Report upvoted!', 'Success');
    } catch (err) {
      console.error('Failed to upvote', err);
      this.notify.error('Failed to upvote report', 'Error');
    }
  }

  // Logout helper
  async logout() {
    try {
      await this.authService.logout();
      await this.router.navigate(['/login']);
    } catch (err) {
      console.error('Logout failed', err);
    }
  }

  getInitials(name: string): string {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  getUserProfilePicture(userId: string): string | null {
    const user = this.usersMap.get(userId);
    return user?.profilePictureUrl || null;
  }

  ngAfterViewInit() {
    // Fix Leaflet marker icon paths
    this.fixLeafletIcons();

    // Re-initialize Bootstrap carousel for touch/swipe support
    setTimeout(() => {
      const carouselEl = document.getElementById('announcementsCarousel');
      if (carouselEl && (window as any).bootstrap) {
        (window as any).bootstrap.Carousel.getOrCreateInstance(carouselEl, { touch: true });
      }
    }, 500);
  }

  private fixLeafletIcons(): void {
    // Fix marker icon - use default icon from Leaflet CDN
    if (L.Icon && L.Icon.Default && L.Icon.Default.prototype) {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
      });
    }
  }

  initializeMap(reportId: string, lat: number, lng: number): void {
    // Destroy existing map if any
    if (this.maps[reportId]) {
      this.maps[reportId].remove();
      delete this.maps[reportId];
    }

    // Wait for DOM to be ready
    setTimeout(() => {
      const mapElement = document.getElementById(`map-${reportId}`);
      if (!mapElement) return;

      const map = L.map(`map-${reportId}`).setView([lat, lng], 18);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      L.marker([lat, lng]).addTo(map)
        .bindPopup('Report Location')
        .openPopup();

      this.maps[reportId] = map;

      // Invalidate size to ensure proper rendering
      setTimeout(() => map.invalidateSize(), 100);
    }, 100);
  }

  async addComment(reportId: string): Promise<void> {
    const user = this.user();
    if (!user) {
      this.notify.warning('Please login to add comments', 'Login Required');
      this.router.navigate(['/login']);
      return;
    }

    if (user.role !== 'admin') {
      this.notify.info('Only admins can add comments', 'Not Allowed');
      return;
    }

    const texts = this.commentTexts();
    const commentText = texts[reportId]?.trim();
    if (!commentText) {
      this.notify.warning('Please enter a comment', 'Empty Comment');
      return;
    }

    try {
      await this.reportsService.addComment(
        reportId,
        user.uid,
        user.username || user.fullName || user.email || 'Admin',
        user.role,
        commentText
      );

      // Clear the input
      const updatedTexts = { ...texts };
      delete updatedTexts[reportId];
      this.commentTexts.set(updatedTexts);

      this.notify.success('Comment added successfully', 'Success');
    } catch (err) {
      console.error('Failed to add comment', err);
      this.notify.error('Failed to add comment', 'Error');
    }
  }

  updateCommentText(reportId: string, text: string) {
    const updated = { ...this.commentTexts(), [reportId]: text };
    this.commentTexts.set(updated);
  }

  formatCommentDate(timestamp: any): Date {
    if (!timestamp) return new Date();
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp instanceof Date) {
      return timestamp;
    }
    return new Date(timestamp);
  }

  formatTimestamp(timestamp: any): Date | null {
    if (!timestamp) return null;
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp instanceof Date) {
      return timestamp;
    }
    if (timestamp.seconds) {
      return new Date(timestamp.seconds * 1000);
    }
    return new Date(timestamp);
  }

  openImageModal(imageUrl: string): void {
    this.selectedImage.set(imageUrl);
  }

  closeImageModal(): void {
    this.selectedImage.set(null);
  }

  scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  handleScroll = () => {
    this.showGoToTop.set(window.scrollY > 300);
  };

  ngOnDestroy() {
    window.removeEventListener('scroll', this.handleScroll);
    document.removeEventListener('click', this.handleClickOutside);
  }
}
