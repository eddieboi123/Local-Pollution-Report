import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ReportsService } from '../services/reports';
import { AnnouncementsService } from '../services/announcements';
import { UsersService } from '../services/users';
import { BarangaysService, Barangay } from '../services/barangays.service';
import { AuthService } from '../services/auth-guard';
import { Firestore, collectionData, collection, doc, deleteDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppUser, Report, Announcement } from '../interfaces';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { TranslatePipe } from '../pipes/translate.pipe';
import { TranslationService } from '../services/translation.service';
import { NotificationService } from '../services/notification.service';
import { NotificationsService } from '../services/notifications.service';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './admin-dashboard.html',
  styleUrls: ['./admin-dashboard.css']
})
export class AdminDashboard implements OnInit, AfterViewInit, OnDestroy {
  activeTab: 'reports' | 'announcements' | 'users' | 'analytics' | 'barangays' | 'tasks' = 'reports';

  reports: (Report & { id?: string })[] = [];
  announcements: (Announcement & { id?: string })[] = [];
  users: (AppUser & { id?: string })[] = [];
  barangays: (Barangay & { id?: string })[] = [];
  user$: Observable<AppUser | null>;

  filterStatus: 'all' | 'In Progress' | 'Done' = 'all';
  responseText: Record<string, string> = {};

  // Comment tracking
  commentTexts: { [reportId: string]: string } = {};

  // Map tracking
  private maps: { [reportId: string]: L.Map } = {};

  // Image modal tracking
  selectedImage: string | null = null;

  // Go to top button visibility
  showGoToTop = false;

  // Unread notifications count
  unreadNotificationCount = 0;

  // Profile dropdown state
  showProfileMenu = false;

  announcementModel: Partial<Announcement> = {
    title: '',
    subtitle: '',
    description: '',
    barangayId: undefined
  };

  constructor(
    private reportsService: ReportsService,
    private announcementsService: AnnouncementsService,
    private firestore: Firestore,
    private functions: Functions,
    private usersService: UsersService,
    private barangaysService: BarangaysService,
    private auth: AuthService,
    private router: Router,
    private notify: NotificationService,
    private notificationsService: NotificationsService
  ) {
    this.user$ = this.auth.user$;
    // Load unread notification count
    this.user$.subscribe(user => {
      if (user) {
        this.notificationsService.getUnreadCount(user.uid).subscribe(count => {
          this.unreadNotificationCount = count;
        });
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-dropdown')) {
        this.showProfileMenu = false;
      }
    });
  }

  // UI toasts state (simple per-component implementation)
  toasts: Array<{ id: number; message: string; type: 'info' | 'success' | 'warning' | 'danger' }> = [];
  private nextToastId = 1;

  showToast(message: string, type: 'info' | 'success' | 'warning' | 'danger' = 'info') {
    const id = this.nextToastId++;
    this.toasts.push({ id, message, type });
    setTimeout(() => this.toasts = this.toasts.filter(t => t.id !== id), 4000);
  }

  removeToast(id: number) {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  goHome() {
    this.router.navigate(['/']);
  }

  ngOnInit(): void {
    // Listen to scroll events
    window.addEventListener('scroll', this.handleScroll.bind(this));
    this.loadReports();
    this.loadAnnouncements();
    this.loadUsers();
    this.loadBarangays();
    this.auth.user$.pipe(take(1)).subscribe((u: any) => {
      this.isMainAdmin = !!u && (u.role === 'admin') && (!u.barangay || u.barangay === '');
      this.currentUserId = u?.uid || '';
    });
  }

  isMainAdmin = false;
  currentUserId = ''; // Store current user's ID to exclude from users list

  // Barangay filter for main admin - separate filters for each section
  selectedBarangayFilter = ''; // Reports filter
  selectedUsersBarangayFilter = ''; // Users filter
  selectedTasksBarangayFilter = ''; // Submitted reports filter
  selectedAnnouncementsBarangayFilter = ''; // Announcements filter
  selectedAnalyticsBarangayFilter = ''; // Analytics filter

  // Search text for each tab (main admin)
  reportsSearchText = '';
  tasksSearchText = '';
  announcementsSearchText = '';
  usersSearchText = '';
  barangaysSearchText = '';
  announcementTargetSearchText = ''; // For announcement target barangay selection
  analyticsSearchText = ''; // For analytics barangay filter

  // Dropdown visibility state for each filter
  showReportsDropdown = false;
  showTasksDropdown = false;
  showAnnouncementsDropdown = false;
  showUsersDropdown = false;
  showAnnouncementTargetDropdown = false;
  showAnalyticsDropdown = false;

  // Selected announcement target barangay name for display
  selectedAnnouncementTargetName = '';

  // Filtered barangays for dropdown searches
  filteredBarangaysForDropdown: (Barangay & { id?: string })[] = [];

  // Analytics chart references
  @ViewChild('analyticsBarCanvas', { static: false }) analyticsBarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('analyticsPieCanvas', { static: false }) analyticsPieCanvas!: ElementRef<HTMLCanvasElement>;
  private analyticsBarChart: Chart | null = null;
  private analyticsPieChart: Chart | null = null;

  // Analytics data
  analyticsPollutionTypes: string[] = [];
  analyticsCountsByType: Record<string, number> = {};
  analyticsLast7Days: { label: string; count: number }[] = [];

  setTab(tab: 'reports' | 'announcements' | 'users' | 'analytics' | 'barangays' | 'tasks') {
    this.activeTab = tab;
    if (tab === 'analytics') {
      this.loadAnalyticsData();
    }
  }

  /** Handle barangay filter change */
  onBarangayFilterChange() {
    // The filteredReports() method will automatically filter based on selectedBarangayFilter
    // No additional action needed as we use getters
  }

  /** Get count of reports for the selected barangay filter */
  getFilteredReportsCount(): number {
    return this.filteredReports().length;
  }

  // --- Reports ---
  loadReports() {
    this.auth.user$.pipe(take(1)).subscribe((currentUser: any) => {
      const isGlobalAdmin = currentUser?.role === 'admin' && (!currentUser.barangay || currentUser.barangay === '');

      if (isGlobalAdmin) {
        // Main admin sees all reports
        this.reportsService.getAllReports().subscribe(rs => {
          this.reports = rs;
        });
      } else if (currentUser?.barangay) {
        // Barangay admin sees only their barangay reports
        this.reportsService.getReportsByBarangay(currentUser.barangay).subscribe(rs => {
          this.reports = rs;
        });
      }
    });
  }

  filteredReports() {
    let approvedReports = this.reports.filter(r => r.approved === true);

    // Apply barangay filter if selected (main admin only)
    if (this.selectedBarangayFilter) {
      approvedReports = approvedReports.filter(r => r.barangayId === this.selectedBarangayFilter);
    }

    if (this.filterStatus === 'all') return approvedReports;
    return approvedReports.filter(r => r.status === this.filterStatus);
  }

  /** Get reports pending approval (not approved yet), with optional barangay filter */
  getPendingReports(): (Report & { id?: string })[] {
    let pending = this.reports.filter(r => r.approved === false || r.approved === undefined || r.approved === null);

    // Apply barangay filter if selected (main admin only)
    if (this.selectedTasksBarangayFilter) {
      pending = pending.filter(r => r.barangayId === this.selectedTasksBarangayFilter);
    }

    return pending;
  }

  /** Get count of all pending approvals for badge (unfiltered) */
  getPendingApprovalCount(): number {
    return this.reports.filter(r => r.approved === false || r.approved === undefined || r.approved === null).length;
  }

  async updateStatus(report: Report & { id?: string }, status: 'In Progress' | 'Done') {
    if (!report.id) return;

    // If setting to Done, show confirmation since it's permanent
    if (status === 'Done') {
      const confirmed = await this.notify.confirm(
        'Are you sure you want to mark this report as Done? This action is permanent and cannot be undone.',
        'Mark as Done',
        'Yes, Mark Done',
        'Cancel'
      );
      if (!confirmed) return;
    }

    try {
      await this.reportsService.updateReport(report.id, { status });
      const idx = this.reports.findIndex(r => r.id === report.id);
      if (idx >= 0) this.reports[idx].status = status;
      this.showToast(`Report status updated to ${status}`, 'success');
    } catch (err) {
      console.error('Failed to update status', err);
      this.showToast('Failed to update status', 'danger');
    }
  }

  async sendResponse(report: Report & { id?: string }, text: string) {
    if (!report.id) return;
    const adminResponse = { text, date: new Date().toISOString() };
    await this.reportsService.updateReport(report.id, { adminResponse });
    const idx = this.reports.findIndex(r => r.id === report.id);
    if (idx >= 0) this.reports[idx].adminResponse = adminResponse;
    this.responseText[report.id] = '';
  }

  async deleteReport(report: Report & { id?: string }) {
    if (!report.id) return;
    const confirmed = await this.notify.confirm('Are you sure you want to delete this report? This will also delete all associated images.', 'Delete Report', 'Yes, Delete', 'Cancel');
    if (!confirmed) return;

    try {
      await this.reportsService.deleteReportWithImages(report.id, report.images || []);
      this.reports = this.reports.filter(r => r.id !== report.id);
      this.showToast('Report and images deleted successfully', 'success');
    } catch (err) {
      console.error('Failed to delete report', err);
      this.showToast('Failed to delete report: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Approve a report - sets it to In Progress and makes it visible on home page */
  async approveReport(report: Report & { id?: string }) {
    if (!report.id) return;
    try {
      await this.reportsService.updateReport(report.id, { approved: true, status: 'In Progress' });
      report.approved = true;
      report.status = 'In Progress';
      this.showToast('Report approved and is now In Progress', 'success');
    } catch (err) {
      console.error('Failed to approve report', err);
      this.showToast('Failed to approve report: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Unapprove a report to hide it from home page */
  async unapproveReport(report: Report & { id?: string }) {
    if (!report.id) return;
    try {
      await this.reportsService.updateReport(report.id, { approved: false });
      report.approved = false;
      this.showToast('Report unapproved and hidden from home page', 'success');
    } catch (err) {
      console.error('Failed to unapprove report', err);
      this.showToast('Failed to unapprove report: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Reject a report with a reason and send notification to reporter */
  async rejectReport(report: Report & { id?: string }) {
    if (!report.id) return;

    // Prompt for rejection reason
    const reason = await this.notify.prompt('Please provide a reason for rejecting this report:', 'Reject Report', 'Not related to pollution', 'Enter reason...', 'Reject', 'Cancel');
    if (reason === null) return; // User cancelled

    try {
      // Call Firebase Cloud Function to send rejection email notification
      const rejectFunc = httpsCallable(this.functions, 'onReportRejection');

      await rejectFunc({
        reportId: report.id,
        reporterId: report.reporterId,
        reportLocation: report.location || 'Unknown',
        reportType: report.type || 'Unknown',
        reason: reason
      });

      // Delete the report after rejecting
      await this.reportsService.deleteReport(report.id);
      this.reports = this.reports.filter(r => r.id !== report.id);

      this.showToast('Report rejected, notification sent, and report deleted', 'success');
    } catch (err) {
      console.error('Failed to reject report', err);
      this.showToast('Failed to reject report: ' + ((err as any)?.message || ''), 'danger');
    }
  }  // --- Announcements ---
  loadAnnouncements() {
    this.auth.user$.pipe(take(1)).subscribe((currentUser: any) => {
      const isGlobalAdmin = currentUser?.role === 'admin' && (!currentUser.barangay || currentUser.barangay === '');

      if (isGlobalAdmin) {
        // Main admin sees all announcements
        this.announcementsService.getAllAnnouncements().subscribe(a => {
          this.announcements = a;
        });
      } else if (currentUser?.barangay) {
        // Barangay admin sees only their barangay announcements (plus global ones)
        this.announcementsService.getAnnouncementsForBarangay(currentUser.barangay).subscribe(a => {
          this.announcements = a;
        });
      }
    });
  }

  // --- Barangays ---
  loadBarangays() {
    this.auth.user$.pipe(take(1)).subscribe((currentUser: any) => {
      const isGlobalAdmin = currentUser?.role === 'admin' && (!currentUser.barangay || currentUser.barangay === '');

      if (isGlobalAdmin) {
        // Main admin sees all barangays
        this.barangaysService.getAllBarangays().subscribe(b => {
          this.barangays = b;
          this.filteredBarangaysForDropdown = b;
        });
      } else if (currentUser?.barangay) {
        // Barangay admin sees only their barangay
        this.barangaysService.getAllBarangays().subscribe(allBarangays => {
          this.barangays = allBarangays.filter(b => b.id === currentUser.barangay);
          this.filteredBarangaysForDropdown = this.barangays;
        });
      }
    });
  }

  /** Filter barangays based on search text for a specific section */
  getFilteredBarangays(searchText: string): (Barangay & { id?: string })[] {
    if (!searchText || !searchText.trim()) {
      return this.barangays;
    }
    const search = searchText.toLowerCase().trim();
    return this.barangays.filter(b => b.name.toLowerCase().includes(search));
  }

  /** Get barangays filtered by search text for Barangays tab */
  get filteredBarangaysList(): (Barangay & { id?: string })[] {
    return this.getFilteredBarangays(this.barangaysSearchText);
  }

  // ========== Autocomplete Dropdown Helpers ==========

  /** Select a barangay for Reports filter */
  selectReportsBarangay(barangay: Barangay & { id?: string }) {
    this.selectedBarangayFilter = barangay.id || '';
    this.reportsSearchText = barangay.name;
    this.showReportsDropdown = false;
  }

  /** Select a barangay for Tasks filter */
  selectTasksBarangay(barangay: Barangay & { id?: string }) {
    this.selectedTasksBarangayFilter = barangay.id || '';
    this.tasksSearchText = barangay.name;
    this.showTasksDropdown = false;
  }

  /** Select a barangay for Announcements filter */
  selectAnnouncementsBarangay(barangay: Barangay & { id?: string }) {
    this.selectedAnnouncementsBarangayFilter = barangay.id || '';
    this.announcementsSearchText = barangay.name;
    this.showAnnouncementsDropdown = false;
  }

  /** Select a barangay for Users filter */
  selectUsersBarangay(barangay: Barangay & { id?: string }) {
    this.selectedUsersBarangayFilter = barangay.id || '';
    this.usersSearchText = barangay.name;
    this.showUsersDropdown = false;
  }

  /** Clear Reports barangay filter */
  clearReportsBarangayFilter() {
    this.selectedBarangayFilter = '';
    this.reportsSearchText = '';
    this.showReportsDropdown = false;
  }

  /** Clear Tasks barangay filter */
  clearTasksBarangayFilter() {
    this.selectedTasksBarangayFilter = '';
    this.tasksSearchText = '';
    this.showTasksDropdown = false;
  }

  /** Clear Announcements barangay filter */
  clearAnnouncementsBarangayFilter() {
    this.selectedAnnouncementsBarangayFilter = '';
    this.announcementsSearchText = '';
    this.showAnnouncementsDropdown = false;
  }

  /** Clear Users barangay filter */
  clearUsersBarangayFilter() {
    this.selectedUsersBarangayFilter = '';
    this.usersSearchText = '';
    this.showUsersDropdown = false;
  }

  /** Select a barangay for Announcement Target */
  selectAnnouncementTargetBarangay(barangay: Barangay & { id?: string }) {
    this.announcementModel.barangayId = barangay.id || undefined;
    this.announcementTargetSearchText = barangay.name;
    this.selectedAnnouncementTargetName = barangay.name;
    this.showAnnouncementTargetDropdown = false;
  }

  /** Clear Announcement Target barangay (set to All/Global) */
  clearAnnouncementTargetBarangay() {
    this.announcementModel.barangayId = undefined;
    this.announcementTargetSearchText = '';
    this.selectedAnnouncementTargetName = '';
    this.showAnnouncementTargetDropdown = false;
  }

  /** Select a barangay for Analytics filter */
  selectAnalyticsBarangay(barangay: Barangay & { id?: string }) {
    this.selectedAnalyticsBarangayFilter = barangay.id || '';
    this.analyticsSearchText = barangay.name;
    this.showAnalyticsDropdown = false;
    this.loadAnalyticsData();
  }

  /** Clear Analytics barangay filter */
  clearAnalyticsBarangayFilter() {
    this.selectedAnalyticsBarangayFilter = '';
    this.analyticsSearchText = '';
    this.showAnalyticsDropdown = false;
    this.loadAnalyticsData();
  }

  /** Handle focus on filter input */
  onFilterInputFocus(filter: 'reports' | 'tasks' | 'announcements' | 'users' | 'announcementTarget' | 'analytics') {
    if (filter === 'reports') this.showReportsDropdown = true;
    else if (filter === 'tasks') this.showTasksDropdown = true;
    else if (filter === 'announcements') this.showAnnouncementsDropdown = true;
    else if (filter === 'users') this.showUsersDropdown = true;
    else if (filter === 'announcementTarget') this.showAnnouncementTargetDropdown = true;
    else if (filter === 'analytics') this.showAnalyticsDropdown = true;
  }

  /** Handle blur on filter input */
  onFilterInputBlur(filter: 'reports' | 'tasks' | 'announcements' | 'users' | 'announcementTarget' | 'analytics') {
    setTimeout(() => {
      if (filter === 'reports') this.showReportsDropdown = false;
      else if (filter === 'tasks') this.showTasksDropdown = false;
      else if (filter === 'announcements') this.showAnnouncementsDropdown = false;
      else if (filter === 'users') this.showUsersDropdown = false;
      else if (filter === 'announcementTarget') this.showAnnouncementTargetDropdown = false;
      else if (filter === 'analytics') this.showAnalyticsDropdown = false;
    }, 200);
  }

  /** Handle filter input change - keep dropdown open */
  onFilterInputChange(filter: 'reports' | 'tasks' | 'announcements' | 'users' | 'announcementTarget' | 'analytics') {
    // Clear the selection when typing (to require re-selecting from dropdown)
    if (filter === 'reports') {
      this.selectedBarangayFilter = '';
      this.showReportsDropdown = true;
    } else if (filter === 'tasks') {
      this.selectedTasksBarangayFilter = '';
      this.showTasksDropdown = true;
    } else if (filter === 'announcements') {
      this.selectedAnnouncementsBarangayFilter = '';
      this.showAnnouncementsDropdown = true;
    } else if (filter === 'users') {
      this.selectedUsersBarangayFilter = '';
      this.showUsersDropdown = true;
    } else if (filter === 'announcementTarget') {
      this.announcementModel.barangayId = undefined;
      this.showAnnouncementTargetDropdown = true;
    } else if (filter === 'analytics') {
      this.selectedAnalyticsBarangayFilter = '';
      this.showAnalyticsDropdown = true;
    }
  }

  /** Create a new barangay */
  async createBarangay(name: string, lat?: number, lng?: number) {
    if (!name || !name.trim()) { this.showToast('Provide barangay name', 'warning'); return; }
    try {
      // Fetch boundary from OSM if lat/lng provided
      let boundary: number[][] | undefined;
      if (lat != null && lng != null) {
        boundary = await this.fetchBarangayBoundary(name.trim());
      }
      await this.barangaysService.createBarangay({
        name: name.trim(),
        lat: lat != null ? lat : undefined,
        lng: lng != null ? lng : undefined,
        boundary
      });
      this.loadBarangays();
      this.showToast('Barangay created', 'success');
    } catch (err) {
      console.error('Failed to create barangay', err);
      this.showToast('Failed to create barangay', 'danger');
    }
  }

  /** Fetch barangay boundary polygon from OpenStreetMap Nominatim */
  async fetchBarangayBoundary(barangayName: string): Promise<number[][] | undefined> {
    try {
      // Search for barangay in Baguio City, Philippines
      const query = encodeURIComponent(`${barangayName}, Baguio City, Philippines`);
      const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&polygon_geojson=1&limit=1`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PollutionReportingApp/1.0'
        }
      });

      if (!response.ok) {
        console.warn('Failed to fetch boundary from OSM');
        return undefined;
      }

      const data = await response.json();
      if (data.length > 0 && data[0].geojson) {
        const geojson = data[0].geojson;
        if (geojson.type === 'Polygon') {
          return geojson.coordinates[0]; // Return outer ring
        } else if (geojson.type === 'MultiPolygon') {
          return geojson.coordinates[0][0]; // Return first polygon's outer ring
        }
      }
      console.warn('No boundary found for', barangayName);
      return undefined;
    } catch (err) {
      console.error('Error fetching boundary:', err);
      return undefined;
    }
  }

  /** Assign an admin to a barangay: set role and add adminId to barangay */
  async assignAdminToBarangay(barangayId: string, userUid: string) {
    if (!barangayId || !userUid) return;
    try {
      await this.usersService.updateRole(userUid, 'admin');
      await this.usersService.setUserBarangay(userUid, barangayId);
      await this.barangaysService.assignAdmin(barangayId, userUid);
      this.showToast('Assigned admin to barangay', 'success');
      this.loadUsers();
      this.loadBarangays();
    } catch (err) {
      console.error('Failed to assign admin', err);
      this.showToast('Failed to assign admin: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Remove an admin from a barangay and downgrade role */
  async unassignAdminFromBarangay(barangayId: string, adminUid: string) {
    const confirmed = await this.notify.confirm('Remove admin privileges from this user?', 'Remove Admin');
    if (!confirmed) return;
    try {
      await this.barangaysService.removeAdmin(barangayId, adminUid);
      // downgrade user role to 'user' and clear barangay assignment
      await this.usersService.updateRole(adminUid, 'user');
      await this.usersService.setUserBarangay(adminUid, null);
      this.notify.success('Admin removed successfully', 'Success');
      this.loadUsers();
      this.loadBarangays();
    } catch (err) {
      console.error('Failed to remove admin', err);
      this.notify.error('Failed to remove admin', 'Error');
    }
  }

  async removeBarangay(barangayId: string) {
    const ok = await this.notify.confirm('Delete this barangay? This action cannot be undone.', 'Delete Barangay', 'Yes, Delete', 'Cancel');
    if (!ok) return;
    try {
      await this.barangaysService.deleteBarangay(barangayId);
      this.loadBarangays();
      this.showToast('Barangay deleted', 'success');
    } catch (err) {
      console.error('Failed to delete barangay', err);
      this.showToast('Failed to delete barangay: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Navigate to main analytics page with the barangay pre-selected */
  openBarangayAnalytics(barangayId: string) {
    if (!barangayId) return;
    this.router.navigate(['/analytics'], { queryParams: { barangay: barangayId } });
  }

  /** Users that can be assigned as admins (non-admins) */
  get assignableUsers() {
    return (this.users || []).filter(u => !u.role || u.role !== 'admin');
  }

  getUserEmail(uid: string) {
    const u = (this.users || []).find(x => x.uid === uid);
    return u ? (u.username || u.email || uid) : uid;
  }

  // Get admins for a barangay by checking both adminIds array and user.barangay field
  getBarangayAdmins(barangayId: string): AppUser[] {
    if (!barangayId) return [];
    return (this.users || []).filter(u =>
      u.role === 'admin' && u.barangay === barangayId
    );
  }

  // Sync barangay adminIds with actual users who have this barangay assigned
  async syncBarangayAdmins(barangayId: string) {
    if (!barangayId) return;
    try {
      const admins = this.getBarangayAdmins(barangayId);
      const barangay = this.barangays.find(b => b.id === barangayId);
      if (!barangay) return;

      // Get current adminIds from barangay
      const currentAdminIds = barangay.adminIds || [];
      const actualAdminIds = admins.map(a => a.uid);

      // Find admins to add (in user data but not in barangay adminIds)
      const toAdd = actualAdminIds.filter(id => !currentAdminIds.includes(id));

      // Add missing admins to barangay
      for (const adminId of toAdd) {
        await this.barangaysService.assignAdmin(barangayId, adminId);
      }

      if (toAdd.length > 0) {
        this.showToast(`Synced ${toAdd.length} admin(s) to barangay`, 'success');
        this.loadBarangays();
      } else {
        this.showToast('Barangay admins already in sync', 'info');
      }
    } catch (err) {
      console.error('Failed to sync admins', err);
      this.showToast('Failed to sync admins: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  getBarangayName(barangayId: string | null | undefined): string {
    if (!barangayId) return 'Admin';
    const barangay = this.barangays.find(b => b.id === barangayId);
    return barangay ? barangay.name : barangayId;
  }

  async postAnnouncement(payload: Partial<Announcement>) {
    if (!payload.title || !payload.description) { this.showToast('Title and description required', 'warning'); return; }
    try {
      // Get current user to determine barangayId
      const currentUser = await firstValueFrom(this.auth.user$);
      const isGlobalAdmin = currentUser?.role === 'admin' && (!currentUser.barangay || currentUser.barangay === '');

      // For main admin, use the selected barangayId from model (null means global)
      // For barangay admin, always use their barangay
      const barangayId = isGlobalAdmin ? (payload.barangayId || null) : currentUser?.barangay || null;

      await this.announcementsService.postAnnouncement({
        title: payload.title,
        subtitle: payload.subtitle || '',
        description: payload.description,
        location: payload.location || '',
        date: new Date(),
        createdAt: new Date(),
        barangayId: barangayId
      } as Announcement);
      this.announcementModel = { title: '', subtitle: '', description: '', barangayId: undefined };
      this.loadAnnouncements();
      this.showToast('Announcement posted', 'success');
    } catch (err) {
      console.error('Failed to post announcement', err);
      this.showToast('Failed to post announcement: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  // --- Users ---
  loadUsers() {
    this.auth.user$.pipe(take(1)).subscribe((currentUser: any) => {
      const isGlobalAdmin = currentUser?.role === 'admin' && (!currentUser.barangay || currentUser.barangay === '');

      if (isGlobalAdmin) {
        // Main admin sees all users
        this.usersService.getAllUsers().subscribe((u: AppUser[]) => {
          this.users = u;
        });
      } else if (currentUser?.barangay) {
        // Barangay admin sees only their barangay users
        this.usersService.getUsersByBarangay(currentUser.barangay).subscribe((u: AppUser[]) => {
          this.users = u;
        });
      }
    });
  }

  /** Change a user's role (admin/user) - MAIN ADMIN ONLY */
  async changeUserRole(user: AppUser, role: 'user' | 'admin') {
    if (!user?.uid) return;

    // Only main admin can toggle roles
    if (!this.isMainAdmin) {
      this.showToast('Only main admin can change user roles', 'danger');
      return;
    }

    try {
      if (role === 'admin') {
        // Check if user has a barangay assigned
        if (!user.barangay) {
          this.showToast('User must be assigned to a barangay first. Please assign them to a barangay in the user details.', 'warning');
          return;
        }

        // Check if this barangay already has an admin
        const existingAdmins = this.getBarangayAdmins(user.barangay);
        if (existingAdmins.length > 0 && !existingAdmins.some(a => a.uid === user.uid)) {
          const confirmed = await this.notify.confirm(
            `${user.barangay} already has an admin (${existingAdmins[0].username || existingAdmins[0].email}). Only 1 admin per barangay is allowed. Replace with ${user.username || user.email}?`,
            'Replace Admin',
            'Yes, Replace',
            'Cancel'
          );
          if (!confirmed) return;

          // Remove existing admin(s)
          for (const existingAdmin of existingAdmins) {
            await this.usersService.updateRoleByMainAdmin(existingAdmin.uid, 'user');
            await this.barangaysService.removeAdmin(user.barangay, existingAdmin.uid);
          }
        }

        // Promote user to admin
        await this.usersService.updateRoleByMainAdmin(user.uid, 'admin');

        // Sync with barangay adminIds array
        await this.barangaysService.assignAdmin(user.barangay, user.uid);

        user.role = 'admin';
        this.showToast(`${user.username || user.email} is now admin of ${user.barangay}`, 'success');

        // Reload to update UI
        this.loadUsers();
        this.loadBarangays();
      } else {
        // Demoting from admin to user
        if (user.barangay) {
          // Remove from barangay adminIds
          await this.barangaysService.removeAdmin(user.barangay, user.uid);
        }

        await this.usersService.updateRoleByMainAdmin(user.uid, 'user');
        user.role = 'user';
        this.showToast(`${user.username || user.email} is now a regular user`, 'success');

        // Reload to update UI
        this.loadUsers();
        this.loadBarangays();
      }
    } catch (err) {
      console.error('Failed to update role', err);
      this.showToast('Failed to update role: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Toggle suspend/unsuspend a user */
  async toggleSuspendUser(user: AppUser) {
    if (!user?.uid) return;

    const isSuspended = (user as any).suspended === true;
    const action = isSuspended ? 'unsuspend' : 'suspend';

    // Get current user to prevent self-suspension
    const currentUser = await firstValueFrom(this.auth.user$);
    if (currentUser?.uid === user.uid) {
      this.showToast(`You cannot ${action} yourself`, 'danger');
      return;
    }

    // Barangay admins can only manage users in their barangay, not other admins
    if (!this.isMainAdmin) {
      if (user.barangay !== currentUser?.barangay) {
        this.showToast('You can only manage users in your barangay', 'danger');
        return;
      }
      if (user.role === 'admin') {
        this.showToast('Barangay admins cannot manage other admins', 'danger');
        return;
      }
    }

    const confirmed = await this.notify.confirm(`Are you sure you want to ${action} ${user.email}?`, `${action.charAt(0).toUpperCase() + action.slice(1)} User`, `Yes, ${action}`, 'Cancel');
    if (!confirmed) return;

    try {
      if (isSuspended) {
        await this.usersService.unsuspendUser(user.uid);
        (user as any).suspended = false;
        this.showToast('User unsuspended successfully', 'success');
      } else {
        await this.usersService.suspendUser(user.uid);
        (user as any).suspended = true;
        this.showToast('User suspended successfully', 'success');
      }
    } catch (err) {
      console.error(`Failed to ${action} user`, err);
      this.showToast(`Failed to ${action} user: ` + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Delete a user permanently */
  async deleteUserAction(user: AppUser) {
    if (!user?.uid) return;

    // Get current user to prevent self-deletion
    const currentUser = await firstValueFrom(this.auth.user$);
    if (currentUser?.uid === user.uid) {
      this.showToast('You cannot delete yourself', 'danger');
      return;
    }

    // Barangay admins can only delete users in their barangay, not other admins
    if (!this.isMainAdmin) {
      if (user.barangay !== currentUser?.barangay) {
        this.showToast('You can only delete users in your barangay', 'danger');
        return;
      }
      if (user.role === 'admin') {
        this.showToast('Barangay admins cannot delete other admins', 'danger');
        return;
      }
    }

    const confirmed = await this.notify.confirm(`⚠️ PERMANENTLY DELETE ${user.email}? This action cannot be undone!`, 'Delete User', 'Yes, Delete', 'Cancel');
    if (!confirmed) return;

    try {
      await this.usersService.deleteUser(user.uid);
      this.users = this.users.filter(u => u.uid !== user.uid);
      this.showToast('User deleted successfully', 'success');
    } catch (err) {
      console.error('Failed to delete user', err);
      this.showToast('Failed to delete user: ' + ((err as any)?.message || ''), 'danger');
    }
  }

  /** Delete announcement by id (if present) */
  async deleteAnnouncement(a: Announcement) {
    if (!a?.id) return;
    try {
      const announcementDoc = doc(this.firestore, `announcements/${a.id}`);
      await deleteDoc(announcementDoc);
      this.announcements = this.announcements.filter(x => x.id !== a.id);
      this.notify.success('Announcement deleted', 'Success');
    } catch (err) {
      console.error('Failed to delete announcement', err);
      this.notify.error('Failed to delete announcement', 'Error');
    }
  }

  // --- Analytics Methods ---

  /** Handle analytics barangay filter change */
  onAnalyticsBarangayFilterChange() {
    this.loadAnalyticsData();
  }

  /** Load and calculate analytics data */
  loadAnalyticsData() {
    // Filter reports based on selected barangay
    let filteredReports = this.reports.filter(r => r.approved === true);
    if (this.selectedAnalyticsBarangayFilter) {
      filteredReports = filteredReports.filter(r => r.barangayId === this.selectedAnalyticsBarangayFilter);
    }

    // Extract unique pollution types
    const typeSet = new Set<string>();
    filteredReports.forEach(r => {
      const t = (r.type || '').toLowerCase();
      if (t) typeSet.add(t);
    });
    this.analyticsPollutionTypes = Array.from(typeSet).sort();

    // Initialize counts for all types
    this.analyticsCountsByType = {};
    this.analyticsPollutionTypes.forEach(type => {
      this.analyticsCountsByType[type] = 0;
    });

    // Calculate last 7 days
    const byDay: Record<string, number> = {};
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDay[key] = 0;
    }

    filteredReports.forEach(r => {
      const t = (r.type || '').toLowerCase();
      if (t && this.analyticsCountsByType.hasOwnProperty(t)) {
        this.analyticsCountsByType[t]++;
      }

      // Normalize createdAt
      let created: Date | null = null;
      if (r.createdAt && typeof (r.createdAt as any).toDate === 'function') {
        created = (r.createdAt as any).toDate();
      } else if (r.createdAt instanceof Date) {
        created = r.createdAt as Date;
      } else if (r.createdAt) {
        created = new Date(r.createdAt as any);
      }

      if (created) {
        const k = created.toISOString().slice(0, 10);
        if (k in byDay) byDay[k]++;
      }
    });

    this.analyticsLast7Days = Object.keys(byDay).map(k => ({ label: k.slice(5), count: byDay[k] }));

    // Update charts after a short delay to ensure DOM is ready
    setTimeout(() => this.updateAnalyticsCharts(), 100);
  }

  /** Update analytics charts */
  private updateAnalyticsCharts() {
    try {
      const labels = this.analyticsLast7Days.map(d => d.label);
      const data = this.analyticsLast7Days.map(d => d.count);

      // Bar chart
      if (!this.analyticsBarChart && this.analyticsBarCanvas?.nativeElement) {
        this.analyticsBarChart = new Chart(this.analyticsBarCanvas.nativeElement.getContext('2d')!, {
          type: 'bar',
          data: { labels: labels, datasets: [{ label: 'Reports', data: data, backgroundColor: '#0d6efd' }] },
          options: { responsive: true, maintainAspectRatio: false }
        });
      } else if (this.analyticsBarChart) {
        this.analyticsBarChart.data.labels = labels;
        this.analyticsBarChart.data.datasets[0].data = data;
        this.analyticsBarChart.update();
      }

      // Pie chart
      const pieLabels = this.analyticsPollutionTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1));
      const pieData = this.analyticsPollutionTypes.map(t => this.analyticsCountsByType[t] || 0);
      const colors = ['#198754', '#0dcaf0', '#ffc107', '#dc3545', '#6610f2', '#fd7e14', '#20c997', '#6c757d'];

      if (!this.analyticsPieChart && this.analyticsPieCanvas?.nativeElement) {
        this.analyticsPieChart = new Chart(this.analyticsPieCanvas.nativeElement.getContext('2d')!, {
          type: 'pie',
          data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: colors.slice(0, pieLabels.length) }] },
          options: { responsive: true, maintainAspectRatio: false }
        });
      } else if (this.analyticsPieChart) {
        this.analyticsPieChart.data.labels = pieLabels;
        this.analyticsPieChart.data.datasets[0].data = pieData;
        this.analyticsPieChart.data.datasets[0].backgroundColor = colors.slice(0, pieLabels.length);
        this.analyticsPieChart.update();
      }
    } catch (e) {
      console.warn('Chart init failed', e);
    }
  }

  /** Get analytics total reports (filtered) */
  get analyticsTotalReports(): number {
    let filtered = this.reports.filter(r => r.approved === true);
    if (this.selectedAnalyticsBarangayFilter) {
      filtered = filtered.filter(r => r.barangayId === this.selectedAnalyticsBarangayFilter);
    }
    return filtered.length;
  }

  /** Get analytics in progress count (filtered) */
  get analyticsInProgressCount(): number {
    let filtered = this.reports.filter(r => r.approved === true && r.status === 'In Progress');
    if (this.selectedAnalyticsBarangayFilter) {
      filtered = filtered.filter(r => r.barangayId === this.selectedAnalyticsBarangayFilter);
    }
    return filtered.length;
  }

  /** Get analytics done count (filtered) */
  get analyticsDoneCount(): number {
    let filtered = this.reports.filter(r => r.approved === true && r.status === 'Done');
    if (this.selectedAnalyticsBarangayFilter) {
      filtered = filtered.filter(r => r.barangayId === this.selectedAnalyticsBarangayFilter);
    }
    return filtered.length;
  }

  // Analytics helpers used in template
  get totalReports() {
    return this.reports?.filter(r => r.approved === true).length || 0;
  }

  get pendingApprovalCount() {
    return this.reports?.filter(r => r.approved === false || r.approved === undefined || r.approved === null).length || 0;
  }

  get inProgressCount() {
    return this.reports?.filter(r => r.approved === true && r.status === 'In Progress').length || 0;
  }

  get doneCount() {
    return this.reports?.filter(r => r.approved === true && r.status === 'Done').length || 0;
  }

  // Group users by barangay (for main admin display), excluding the current admin and other main admins
  get usersByBarangay(): Record<string, AppUser[]> {
    const grouped: Record<string, AppUser[]> = {};

    // Filter out the current admin from the users list
    // Also filter out other main admins (admins without a barangay)
    let filteredUsers = this.users.filter(u => {
      // Exclude current user
      if (u.uid === this.currentUserId) return false;

      // Exclude main admins (admins with no barangay) - main admins cannot see each other
      const isMainAdmin = u.role === 'admin' && (!u.barangay || u.barangay.trim() === '');
      if (isMainAdmin) return false;

      return true;
    });

    // Apply barangay filter if selected
    if (this.selectedUsersBarangayFilter) {
      filteredUsers = filteredUsers.filter(u => u.barangay === this.selectedUsersBarangayFilter);
    }

    filteredUsers.forEach(u => {
      let barangayName = 'Unassigned';

      // Check if user has a barangay (not empty string, null, or undefined)
      if (u.barangay && u.barangay.trim() !== '') {
        // Find the barangay name from barangays list
        const barangay = this.barangays.find(b => b.id === u.barangay);
        barangayName = barangay ? barangay.name : u.barangay;
      }

      if (!grouped[barangayName]) grouped[barangayName] = [];
      grouped[barangayName].push(u);
    });
    return grouped;
  }

  /** Get filtered users count for display */
  getFilteredUsersCount(): number {
    let count = 0;
    for (const key of Object.keys(this.usersByBarangay)) {
      count += this.usersByBarangay[key].length;
    }
    return count;
  }

  /** Get users for barangay admin view (excludes themselves) */
  get filteredUsersForBarangayAdmin(): AppUser[] {
    return this.users.filter(u => u.uid !== this.currentUserId);
  }

  // Get barangay names for users grouping
  get barangayKeys(): string[] {
    return Object.keys(this.usersByBarangay).sort((a, b) => {
      // Put 'Unassigned' last
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
  }

  // Group announcements by barangay (for main admin display)
  get announcementsByBarangay(): Record<string, (Announcement & { id?: string })[]> {
    const grouped: Record<string, (Announcement & { id?: string })[]> = {};

    // Apply barangay filter if selected
    let filteredAnnouncements = this.announcements;
    if (this.selectedAnnouncementsBarangayFilter) {
      // Filter by specific barangay, or show global if 'global' is selected
      if (this.selectedAnnouncementsBarangayFilter === 'global') {
        filteredAnnouncements = this.announcements.filter(a => !a.barangayId);
      } else {
        filteredAnnouncements = this.announcements.filter(a => a.barangayId === this.selectedAnnouncementsBarangayFilter);
      }
    }

    filteredAnnouncements.forEach(a => {
      let barangayName = 'Global';

      if (a.barangayId) {
        // Find the barangay name from barangays list
        const barangay = this.barangays.find(b => b.id === a.barangayId);
        barangayName = barangay ? barangay.name : a.barangayId;
      }

      if (!grouped[barangayName]) grouped[barangayName] = [];
      grouped[barangayName].push(a);
    });
    return grouped;
  }

  /** Get filtered announcements count for display */
  getFilteredAnnouncementsCount(): number {
    let count = 0;
    for (const key of Object.keys(this.announcementsByBarangay)) {
      count += this.announcementsByBarangay[key].length;
    }
    return count;
  }

  // Get barangay names for announcements grouping
  get announcementBarangayKeys(): string[] {
    return Object.keys(this.announcementsByBarangay).sort((a, b) => {
      // Put 'Global' first
      if (a === 'Global') return -1;
      if (b === 'Global') return 1;
      return a.localeCompare(b);
    });
  }

  // Group reports by barangay (for main admin display)
  get reportsByBarangay(): Record<string, (Report & { id?: string })[]> {
    const grouped: Record<string, (Report & { id?: string })[]> = {};
    const filtered = this.filteredReports();
    filtered.forEach(r => {
      let barangayName = 'No Barangay';

      if (r.barangayId) {
        // Find the barangay name from barangays list
        const barangay = this.barangays.find(b => b.id === r.barangayId);
        barangayName = barangay ? barangay.name : r.barangayId;
      }

      if (!grouped[barangayName]) grouped[barangayName] = [];
      grouped[barangayName].push(r);
    });
    return grouped;
  }

  // Get barangay names for reports grouping
  get reportBarangayKeys(): string[] {
    return Object.keys(this.reportsByBarangay).sort();
  }

  /** Convert Firestore Timestamp to JavaScript Date for display */
  toDate(timestamp: any): Date | null {
    if (!timestamp) return null;
    // Check if it's a Firestore Timestamp
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    // Check if it's already a Date
    if (timestamp instanceof Date) {
      return timestamp;
    }
    // Try to parse as date string
    return new Date(timestamp);
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

  ngAfterViewInit() {
    // Maps will be initialized when needed
  }

  initializeMap(reportId: string, lat: number, lng: number, prefix: string = 'admin-map-'): void {
    const mapId = `${prefix}${reportId}`;

    // Destroy existing map if any
    if (this.maps[mapId]) {
      this.maps[mapId].remove();
      delete this.maps[mapId];
    }

    // Wait for DOM to be ready
    setTimeout(() => {
      const mapElement = document.getElementById(mapId);
      if (!mapElement) return;

      const map = L.map(mapId).setView([lat, lng], 18);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      L.marker([lat, lng]).addTo(map)
        .bindPopup('Report Location')
        .openPopup();

      this.maps[mapId] = map;

      // Invalidate size to ensure proper rendering
      setTimeout(() => map.invalidateSize(), 100);
    }, 100);
  }

  async addCommentToReport(reportId: string): Promise<void> {
    if (!reportId) {
      this.notify.error('Invalid report ID', 'Error');
      console.error('Report ID is missing');
      return;
    }

    const user = await firstValueFrom(this.user$.pipe(take(1)));
    if (!user || user.role !== 'admin') {
      this.notify.warning('Only admins can add comments', 'Not Allowed');
      return;
    }

    const commentText = this.commentTexts[reportId]?.trim();
    if (!commentText) {
      this.notify.warning('Please enter a comment', 'Empty Comment');
      return;
    }

    try {
      console.log('Adding comment to report:', reportId);
      await this.reportsService.addComment(
        reportId,
        user.uid,
        user.username || user.email || 'Admin',
        user.role,
        commentText
      );

      // Clear the input
      this.commentTexts[reportId] = '';

      // Reload reports to show new comment
      await this.loadReports();

      this.notify.success('Comment added successfully', 'Success');
    } catch (err) {
      console.error('Failed to add comment', err);
      this.notify.error('Failed to add comment: ' + (err as Error).message, 'Error');
    }
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

  getInitials(name: string): string {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  getUserProfilePicture(userId: string): string | null {
    const user = this.users.find(u => u.uid === userId);
    return user?.profilePictureUrl || null;
  }

  openImageModal(imageUrl: string): void {
    this.selectedImage = imageUrl;
  }

  closeImageModal(): void {
    this.selectedImage = null;
  }

  scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  handleScroll() {
    this.showGoToTop = window.scrollY > 300;
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.handleScroll.bind(this));
  }
}
