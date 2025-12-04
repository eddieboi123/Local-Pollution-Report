import { Component, AfterViewInit, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, of, switchMap, combineLatest, map, take } from 'rxjs';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { UsersService } from '../services/users';
import { AppUser, Report, Announcement } from '../interfaces';
import { AuthService } from '../services/auth-guard';
import { ReportsService } from '../services/reports';
import { AnnouncementsService } from '../services/announcements';
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
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Home implements AfterViewInit {
  // Signals for reactive state
  searchTerm = signal('');
  selectedFilter = signal('Latest');
  selectedDate = signal('');
  commentTexts = signal<{ [reportId: string]: string }>({});
  selectedImage = signal<string | null>(null);
  showGoToTop = signal(false);

  // Convert observables to signals (initialized in constructor)
  user!: ReturnType<typeof toSignal<AppUser | null>>;

  // Keep observables for compatibility
  user$: Observable<AppUser | null>;
  announcements$: Observable<Announcement[]>;

  // Enriched reports with pre-loaded user data
  private baseReports$: Observable<EnrichedReport[]>;
  private reports!: ReturnType<typeof toSignal<EnrichedReport[]>>;
  private usersMap = new Map<string, AppUser>();

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

  // Map tracking
  private maps: { [reportId: string]: L.Map } = {};

  constructor(
    private authService: AuthService,
    private reportsService: ReportsService,
    private announcementsService: AnnouncementsService,
    private usersService: UsersService,
    private router: Router
  ) {
    this.user$ = this.authService.user$;

    // Initialize signals that depend on services
    this.user = toSignal(this.authService.user$, { initialValue: null });
    this.baseReports$ = this.getEnrichedReports();
    this.reports = toSignal(this.baseReports$, { initialValue: [] });    // Load announcements
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

    // Listen to scroll events
    window.addEventListener('scroll', this.handleScroll);
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
      alert('Please login to upvote reports');
      this.router.navigate(['/login']);
      return;
    }

    if (user.role === 'admin') {
      alert('Admins cannot upvote reports');
      return;
    }

    const upvotedBy = report.upvotedBy || [];
    if (upvotedBy.includes(user.uid)) {
      alert('You have already upvoted this report');
      return;
    }

    try {
      await this.reportsService.upvoteReport(report.id, user.uid);
    } catch (err) {
      console.error('Failed to upvote', err);
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

      const map = L.map(`map-${reportId}`).setView([lat, lng], 15);

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
      alert('Please login to add comments');
      this.router.navigate(['/login']);
      return;
    }

    if (user.role !== 'admin') {
      alert('Only admins can add comments');
      return;
    }

    const texts = this.commentTexts();
    const commentText = texts[reportId]?.trim();
    if (!commentText) {
      alert('Please enter a comment');
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

      alert('Comment added successfully');
    } catch (err) {
      console.error('Failed to add comment', err);
      alert('Failed to add comment');
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
}
