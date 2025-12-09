import { Component, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService, AppUser } from '../services/auth-guard';
import { UsersService } from '../services/users.service';
import { BarangaysService } from '../services/barangays.service';
import { NotificationsService } from '../services/notifications.service';
import { ReportsService } from '../services/reports';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-help-page',
  imports: [RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './help-page.html',
  styleUrl: './help-page.css',
})
export class HelpPage implements OnInit {
  user$: Observable<AppUser | null>;
  barangayName$: Observable<string> = of('');
  barangayAdminEmail$: Observable<string> = of('barangay@admin.gov.ph');
  barangayAdminContact$: Observable<string> = of('(02) 1234-5678');

  // Unread notifications count
  unreadNotificationCount = 0;

  // Admin pending approval count
  adminPendingApprovalCount = 0;

  // Profile dropdown state
  showProfileMenu = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private usersService: UsersService,
    private barangaysService: BarangaysService,
    private notificationsService: NotificationsService,
    private reportsService: ReportsService
  ) {
    this.user$ = this.auth.user$;
    // Load unread notification count
    this.user$.pipe(
      switchMap(user => user ? this.notificationsService.getUnreadCount(user.uid) : of(0))
    ).subscribe(count => this.unreadNotificationCount = count);

    // Load admin pending approval count (for admin badge in navbar)
    this.user$.pipe(
      switchMap(user => {
        if (!user || user.role !== 'admin') return of(0);
        return this.reportsService.getAllReports().pipe(
          map(reports => reports.filter(r => r.approved === false || r.approved === undefined || r.approved === null).length)
        );
      })
    ).subscribe(count => this.adminPendingApprovalCount = count);

    // Close dropdown when clicking outside
    document.addEventListener('click', (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-dropdown')) {
        this.showProfileMenu = false;
      }
    });
  }

  ngOnInit(): void {
    // Get barangay name and admin contact info
    this.barangayName$ = this.user$.pipe(
      switchMap(user => {
        if (!user?.barangay) return of('Your Barangay');
        return this.barangaysService.getAllBarangays().pipe(
          map(barangays => {
            const barangay = barangays.find(b => b.id === user.barangay);
            return barangay ? barangay.name : user.barangay;
          })
        );
      })
    );

    // Get barangay admin email and contact
    this.barangayAdminEmail$ = this.user$.pipe(
      switchMap(user => {
        if (!user?.barangay) return of('No admin assigned');
        const userBarangay = user.barangay;
        return this.usersService.getUsersByBarangay(userBarangay).pipe(
          map(users => {
            // Find barangay admin (user with role 'admin' in this barangay)
            const admin = users.find(u => u.role === 'admin');
            return admin?.email || 'No admin assigned';
          })
        );
      })
    );

    this.barangayAdminContact$ = this.user$.pipe(
      switchMap(user => {
        if (!user?.barangay) return of('No admin assigned');
        const userBarangay = user.barangay;
        return this.usersService.getUsersByBarangay(userBarangay).pipe(
          map(users => {
            // Find barangay admin (user with role 'admin' in this barangay)
            const admin = users.find(u => u.role === 'admin') as any;
            return admin?.contact || 'No admin assigned';
          })
        );
      })
    );
  }

  toggleProfileMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.showProfileMenu = !this.showProfileMenu;
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
      await this.router.navigate(['/login']);
    } catch (err) {
      console.error('Logout failed', err);
      await this.router.navigate(['/login']);
    }
  }
}
