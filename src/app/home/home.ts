import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, of, switchMap, combineLatest, map, take } from 'rxjs';
import { Router, RouterLink } from '@angular/router';
import { UsersService } from '../services/users';
import { AppUser, Report, Announcement } from '../interfaces';
import { AuthService } from '../services/auth-guard';
import { ReportsService } from '../services/reports';
import { AnnouncementsService } from '../services/announcements';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  imports: [CommonModule, FormsModule, RouterLink],
})
export class Home {
  user$: Observable<AppUser | null>;
  reports$: Observable<(Report & { createdAtDate?: Date })[]>;
  users$: Observable<AppUser[]>;
  announcements$: Observable<Announcement[]>;
  searchTerm: string = '';
  selectedFilter: string = 'Latest';
  selectedDate: string = '';

  // Barangay metrics
  totalReports$: Observable<number>;
  pendingReports$: Observable<number>;
  resolvedReports$: Observable<number>;

  constructor(
    private authService: AuthService,
    private reportsService: ReportsService,
    private announcementsService: AnnouncementsService,
    private usersService: UsersService,
    private router: Router
  ) {
    this.user$ = this.authService.user$;

    // load users once and keep as observable
    this.users$ = this.usersService.getAllUsers();

    // base reports observable: load all reports for user's barangay (if user has barangay)
    const baseReports$ = this.user$.pipe(
      switchMap(user => {
        if (!user || !user.barangay) return of([]);
        return this.reportsService.getReportsByBarangay(user.barangay);
      })
    );

    // combine reports with users to keep reporter info synchronized (name/role changes reflected)
    this.reports$ = combineLatest([baseReports$, this.users$]).pipe(
      map(([reports, users]) => {
        const userMap = new Map(users.map(u => [u.uid, u] as [string, AppUser]));
        return reports.map(r => {
          // ensure images array exists
          const images = Array.isArray(r.images) ? r.images : [];

          // normalize createdAt to Date for template convenience
          let createdAtDate: Date;
          if (r.createdAt && typeof (r.createdAt as any).toDate === 'function') {
            createdAtDate = (r.createdAt as any).toDate();
          } else if (r.createdAt instanceof Date) {
            createdAtDate = r.createdAt as Date;
          } else {
            createdAtDate = new Date(r.createdAt as any);
          }

          // prefer the current user name from users collection if available
          const reporter = userMap.get((r as any).reporterId);
          const reporterName = reporter ? (reporter.email || 'Anonymous') : (r.reporterName || 'Anonymous');

          // overwrite createdAt with a Date for template
          return {
            ...r,
            images,
            reporterName,
            createdAt: createdAtDate
          } as Report;
        });
      })
    );

    // Load announcements scoped to the current user's barangay (includes global announcements)
    this.announcements$ = this.user$.pipe(
      switchMap(user => this.announcementsService.getAnnouncementsForBarangay(user?.barangay || null))
    );

    // Calculate barangay metrics from reports
    this.totalReports$ = this.reports$.pipe(
      map(reports => reports.length)
    );

    this.pendingReports$ = this.reports$.pipe(
      map(reports => reports.filter(r => r.status === 'Pending').length)
    );

    this.resolvedReports$ = this.reports$.pipe(
      map(reports => reports.filter(r => r.status === 'Done').length)
    );
  }

  // Triggered by the search button (input is bound, so this is optional helper)
  onSearch() {
    // noop - searchTerm is already bound and used in filterReports
    this.selectedFilter = 'Latest';
  }

  // Upvote a report (calls ReportsService)
  async upvote(report: Report & { id?: string }) {
    if (!report.id) return;
    try {
      await this.reportsService.upvoteReport(report.id, report.upvotes || 0);
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

  filterReports(reports: Report[]): Report[] {
    let filtered = reports;

    if (this.searchTerm) {
      filtered = filtered.filter(r =>
        r.description.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        r.location.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }

    if (this.selectedFilter === 'Yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      filtered = filtered.filter(r => {
        const reportDate = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
        reportDate.setHours(0, 0, 0, 0);
        return reportDate.getTime() === yesterday.getTime();
      });
    }

    if (this.selectedFilter === 'Select Date' && this.selectedDate) {
      const selected = new Date(this.selectedDate);
      selected.setHours(0, 0, 0, 0);
      filtered = filtered.filter(r => {
        const reportDate = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
        reportDate.setHours(0, 0, 0, 0);
        return reportDate.getTime() === selected.getTime();
      });
    }

    if (this.selectedFilter === 'Trending') {
      filtered = [...filtered].sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    }

    return filtered;
  }
}
