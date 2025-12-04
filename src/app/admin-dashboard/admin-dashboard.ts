import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ReportsService } from '../services/reports';
import { AnnouncementsService } from '../services/announcements';
import { UsersService } from '../services/users';
import { BarangaysService, Barangay } from '../services/barangays.service';
import { AuthService } from '../services/auth-guard';
import { Firestore, collectionData, collection, doc, deleteDoc } from '@angular/fire/firestore';
import { Observable, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppUser, Report, Announcement } from '../interfaces';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { TranslatePipe } from '../pipes/translate.pipe';
import { TranslationService } from '../services/translation.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './admin-dashboard.html',
  styleUrls: ['./admin-dashboard.css']
})
export class AdminDashboard implements OnInit, AfterViewInit {
  activeTab: 'reports' | 'announcements' | 'users' | 'analytics' | 'barangays' | 'tasks' = 'reports';

  reports: (Report & { id?: string })[] = [];
  announcements: (Announcement & { id?: string })[] = [];
  users: (AppUser & { id?: string })[] = [];
  barangays: (Barangay & { id?: string })[] = [];
  user$: Observable<AppUser | null>;

  filterStatus: 'all' | 'Pending' | 'In Progress' | 'Done' = 'all';
  responseText: Record<string, string> = {};

  // Comment tracking
  commentTexts: { [reportId: string]: string } = {};

  // Map tracking
  private maps: { [reportId: string]: L.Map } = {};

  // Image modal tracking
  selectedImage: string | null = null;

  // Go to top button visibility
  showGoToTop = false;

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
    private usersService: UsersService,
    private barangaysService: BarangaysService,
    private auth: AuthService,
    private router: Router
  ) {
    this.user$ = this.auth.user$;
  }

  // UI toasts and confirm dialog state (simple per-component implementation)
  toasts: Array<{ id: number; message: string; type: 'info' | 'success' | 'warning' | 'danger' }> = [];
  private nextToastId = 1;

  // confirm dialog
  confirmVisible = false;
  confirmMessage = '';
  private confirmResolve: ((v: boolean) => void) | null = null;

  showToast(message: string, type: 'info' | 'success' | 'warning' | 'danger' = 'info') {
    const id = this.nextToastId++;
    this.toasts.push({ id, message, type });
    setTimeout(() => this.toasts = this.toasts.filter(t => t.id !== id), 4000);
  }

  removeToast(id: number) {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  showConfirm(message: string): Promise<boolean> {
    this.confirmMessage = message;
    this.confirmVisible = true;
    return new Promise(resolve => { this.confirmResolve = resolve; });
  }

  onConfirmAnswer(answer: boolean) {
    this.confirmVisible = false;
    if (this.confirmResolve) this.confirmResolve(answer);
    this.confirmResolve = null;
  }

  goHome() {
    this.router.navigate(['/home']);
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
    });
  }

  isMainAdmin = false;

  setTab(tab: 'reports' | 'announcements' | 'users' | 'analytics' | 'barangays' | 'tasks') {
    this.activeTab = tab;
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
    const approvedReports = this.reports.filter(r => r.approved === true);
    if (this.filterStatus === 'all') return approvedReports;
    return approvedReports.filter(r => r.status === this.filterStatus);
  }

  /** Get reports pending approval (not approved yet) */
  getPendingReports(): (Report & { id?: string })[] {
    return this.reports.filter(r => r.approved === false || r.approved === undefined || r.approved === null);
  }

  /** Get count of pending approvals for badge */
  getPendingApprovalCount(): number {
    return this.getPendingReports().length;
  }

  async updateStatus(report: Report & { id?: string }, status: 'Pending' | 'In Progress' | 'Done') {
    if (!report.id) return;
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
    const confirmed = await this.showConfirm('Are you sure you want to delete this report? This will also delete all associated images.');
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

  /** Approve a report to make it visible on home page */
  async approveReport(report: Report & { id?: string }) {
    if (!report.id) return;
    try {
      await this.reportsService.updateReport(report.id, { approved: true });
      report.approved = true;
      this.showToast('Report approved and will now appear on home page', 'success');
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

  // --- Announcements ---
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
        });
      } else if (currentUser?.barangay) {
        // Barangay admin sees only their barangay
        this.barangaysService.getAllBarangays().subscribe(allBarangays => {
          this.barangays = allBarangays.filter(b => b.id === currentUser.barangay);
        });
      }
    });
  }

  /** Create a new barangay */
  async createBarangay(name: string) {
    if (!name || !name.trim()) { this.showToast('Provide barangay name', 'warning'); return; }
    try {
      await this.barangaysService.createBarangay({ name: name.trim() });
      this.loadBarangays();
      this.showToast('Barangay created', 'success');
    } catch (err) {
      console.error('Failed to create barangay', err);
      this.showToast('Failed to create barangay', 'danger');
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
    if (!confirm('Remove admin privileges from this user?')) return;
    try {
      await this.barangaysService.removeAdmin(barangayId, adminUid);
      // downgrade user role to 'user' and clear barangay assignment
      await this.usersService.updateRole(adminUid, 'user');
      await this.usersService.setUserBarangay(adminUid, null);
      alert('Admin removed');
      this.loadUsers();
      this.loadBarangays();
    } catch (err) {
      console.error('Failed to remove admin', err);
      alert('Failed to remove admin');
    }
  }

  async removeBarangay(barangayId: string) {
    const ok = await this.showConfirm('Delete this barangay? This action cannot be undone.');
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

  /** Navigate to barangay-scoped analytics */
  openBarangayAnalytics(barangayId: string) {
    if (!barangayId) return;
    this.router.navigate(['/admin/barangay', barangayId, 'analytics']);
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
          const confirmed = await this.showConfirm(
            `${user.barangay} already has an admin (${existingAdmins[0].username || existingAdmins[0].email}). Only 1 admin per barangay is allowed. Replace with ${user.username || user.email}?`
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

    const confirmed = await this.showConfirm(`Are you sure you want to ${action} ${user.email}?`);
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

    const confirmed = await this.showConfirm(`⚠️ PERMANENTLY DELETE ${user.email}? This action cannot be undone!`);
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
    } catch (err) {
      console.error('Failed to delete announcement', err);
      alert('Failed to delete announcement');
    }
  }

  // Analytics helpers used in template
  get totalReports() {
    return this.reports?.length || 0;
  }

  get pendingCount() {
    return this.reports?.filter(r => r.status === 'Pending').length || 0;
  }

  get inProgressCount() {
    return this.reports?.filter(r => r.status === 'In Progress').length || 0;
  }

  get doneCount() {
    return this.reports?.filter(r => r.status === 'Done').length || 0;
  }

  // Group users by barangay (for main admin display)
  get usersByBarangay(): Record<string, AppUser[]> {
    const grouped: Record<string, AppUser[]> = {};
    this.users.forEach(u => {
      let barangayName = 'Admin';

      if (u.barangay) {
        // Find the barangay name from barangays list
        const barangay = this.barangays.find(b => b.id === u.barangay);
        barangayName = barangay ? barangay.name : u.barangay;
      }

      if (!grouped[barangayName]) grouped[barangayName] = [];
      grouped[barangayName].push(u);
    });
    return grouped;
  }

  // Get barangay names for users grouping
  get barangayKeys(): string[] {
    return Object.keys(this.usersByBarangay).sort((a, b) => {
      // Put 'Admin' first
      if (a === 'Admin') return -1;
      if (b === 'Admin') return 1;
      return a.localeCompare(b);
    });
  }

  // Group announcements by barangay (for main admin display)
  get announcementsByBarangay(): Record<string, (Announcement & { id?: string })[]> {
    const grouped: Record<string, (Announcement & { id?: string })[]> = {};
    this.announcements.forEach(a => {
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

      const map = L.map(mapId).setView([lat, lng], 15);

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
      alert('Invalid report ID');
      console.error('Report ID is missing');
      return;
    }

    const user = await firstValueFrom(this.user$.pipe(take(1)));
    if (!user || user.role !== 'admin') {
      alert('Only admins can add comments');
      return;
    }

    const commentText = this.commentTexts[reportId]?.trim();
    if (!commentText) {
      alert('Please enter a comment');
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

      alert('Comment added successfully');
    } catch (err) {
      console.error('Failed to add comment', err);
      alert('Failed to add comment: ' + (err as Error).message);
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
}
