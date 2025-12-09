import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth-guard';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BarangaysService, Barangay } from '../services/barangays.service';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';


@Component({
  selector: 'app-sign-up',
  templateUrl: './sign-up.html',
  styleUrls: ['./sign-up.css'],
  imports: [RouterLink, CommonModule, FormsModule],
})
export class SignUp {
  username = '';
  fullName = '';
  email = '';
  contact = '';
  address = '';
  password = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  barangays$: Observable<(Barangay & { id?: string })[]> | null = null;
  filteredBarangays: (Barangay & { id?: string })[] = [];
  allBarangays: (Barangay & { id?: string })[] = [];
  selectedBarangay = '';
  barangaySearchText = '';
  showBarangayDropdown = false;

  constructor(private auth: AuthService, private router: Router, private barangaysService: BarangaysService) {
    this.barangays$ = this.barangaysService.getAllBarangays();
    this.barangays$.subscribe(barangays => {
      this.allBarangays = barangays;
      this.filteredBarangays = barangays;
    });
  }

  filterBarangays() {
    const search = this.barangaySearchText.toLowerCase().trim();
    if (!search) {
      this.filteredBarangays = this.allBarangays;
    } else {
      this.filteredBarangays = this.allBarangays.filter(b =>
        b.name.toLowerCase().includes(search)
      );
    }
    this.showBarangayDropdown = true;
  }

  selectBarangay(barangay: Barangay & { id?: string }) {
    this.selectedBarangay = barangay.id || '';
    this.barangaySearchText = barangay.name;
    this.showBarangayDropdown = false;
  }

  onBarangayInputFocus() {
    this.showBarangayDropdown = true;
    this.filterBarangays();
  }

  onBarangayInputBlur() {
    // Delay hiding to allow click on dropdown items
    setTimeout(() => {
      this.showBarangayDropdown = false;
    }, 200);
  }

  clearBarangaySelection() {
    this.selectedBarangay = '';
    this.barangaySearchText = '';
    this.filteredBarangays = this.allBarangays;
  }

  async onSubmit() {
    this.errorMessage = '';
    this.successMessage = '';

    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match';
      return;
    }

    // Check if username already exists
    if (this.username) {
      try {
        const usernameExists = await this.auth.checkUsernameExists(this.username);
        if (usernameExists) {
          this.errorMessage = 'Username already taken. Please choose a different one.';
          return;
        }
      } catch (error: any) {
        this.errorMessage = 'Error checking username availability';
        return;
      }
    }

    try {
      // Register user with default role 'user'
      await this.auth.register(this.email, this.password, 'user', this.selectedBarangay, this.fullName, this.contact, this.address, this.username);

      // Success message
      this.successMessage = 'Account created successfully! Redirecting to home...';

      // Redirect after short delay
      setTimeout(() => this.router.navigate(['/']), 1500);

    } catch (error: any) {
      this.errorMessage = error.message || 'Registration failed';
    }
  }
}
