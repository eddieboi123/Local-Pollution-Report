import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { ReportsService } from '../services/reports';
import { BarangaysService, Barangay, Street } from '../services/barangays.service';
import { AuthService, AppUser } from '../services/auth-guard';
import { NotificationService } from '../services/notification.service';
import { NotificationsService } from '../services/notifications.service';
import { Observable, firstValueFrom, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { getStorage, ref as storageRef } from '@angular/fire/storage';
import { uploadBytesResumable, getDownloadURL } from 'firebase/storage';

@Component({
  selector: 'app-submit-report',
  templateUrl: './submit-report.html',
  styleUrls: ['./submit-report.css'],
  imports: [FormsModule, CommonModule, RouterLink, RouterLinkActive],
  encapsulation: ViewEncapsulation.None
})
export class SubmitReport {
  user$: Observable<AppUser | null>;

  report = {
    type: '',
    location: '',
    description: '',
    images: [] as File[],
    dateTaken: '',
    timeTaken: '',
    lat: undefined as number | undefined,
    lng: undefined as number | undefined
  };

  // map related
  private map: any = null;
  private marker: any = null;
  private boundaryLayer: any = null;
  private L: any = null; // Store Leaflet reference
  private userBarangay: Barangay | null = null;

  // Baguio City base coordinates (center)
  private baguioCityCenter: [number, number] = [16.4023, 120.5960];

  // Unread notifications count
  unreadNotificationCount = 0;

  // Admin pending approval count
  adminPendingApprovalCount = 0;

  // Profile dropdown state
  showProfileMenu = false;

  // Location loading state
  isLocating = false;

  // Street coordinates for Baguio City streets (you can expand this)
  private locationCoords: Record<string, [number, number]> = {
    // Default Baguio City streets
    'Session Road': [16.4115, 120.5930],
    'Burnham Park': [16.4115, 120.5925],
    'Harrison Road': [16.4100, 120.5940],
    'Magsaysay Avenue': [16.4050, 120.5970],
    'Upper Session Road': [16.4130, 120.5920],
    'Lower Session Road': [16.4100, 120.5935],
    'General Luna Road': [16.4080, 120.5950],
    'Abanao Street': [16.4105, 120.5960],
    'Bonifacio Street': [16.4095, 120.5945],
    'Km 5': [16.3850, 120.5800],
    'Km 6': [16.3750, 120.5750]
  };
  previews: string[] = [];
  progressTotal = 0;
  progressUploaded = 0;
  progressPercent = 0;
  uploading = false;
  overallPercent = 0;
  progressPerImage: number[] = [];
  maxFiles = 3;
  pollutionTypes$: Observable<{value:string,label?:string}[]> | null = null;
  locations$: Observable<{value:string,label?:string}[]> | null = null;

  constructor(
    private reportsService: ReportsService,
    private auth: AuthService,
    private barangaysService: BarangaysService,
    private router: Router,
    private notify: NotificationService,
    private notificationsService: NotificationsService
  ) {
    this.user$ = this.auth.user$;
    // Load unread notification count
    this.user$.pipe(
      switchMap(u => u ? this.notificationsService.getUnreadCount(u.uid) : of(0))
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
    // load lookup lists from Firestore via BarangaysService for the current user's barangay
    this.pollutionTypes$ = this.auth.user$.pipe(
      switchMap(u => u && u.barangay ? this.barangaysService.getBarangayById(u.barangay).pipe(map(b => (b && b.pollutionTypes) ? b.pollutionTypes.map(t => ({ value: t, label: t })) : [])) : of([]))
    );
    this.locations$ = this.auth.user$.pipe(
      switchMap(u => u && u.barangay ? this.barangaysService.getBarangayById(u.barangay).pipe(map(s => (s && s.streets) ? s.streets.map(s => {
        const name = typeof s === 'string' ? s : s.name;
        return { value: typeof s === 'string' ? s : JSON.stringify(s), label: name };
      }) : [])) : of([]))
    );

    // Close dropdown when clicking outside
    document.addEventListener('click', (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-dropdown')) {
        this.showProfileMenu = false;
      }
    });
  }

  toggleProfileMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.showProfileMenu = !this.showProfileMenu;
  }

  /** Get user's current location using browser geolocation */
  getMyLocation(): void {
    if (!navigator.geolocation) {
      this.notify.error('Geolocation is not supported by your browser', 'Location Error');
      return;
    }

    this.isLocating = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        // Move marker to user's location
        this.moveMarkerTo(lat, lng);

        // Zoom to maximum level (18)
        if (this.map) {
          this.map.setView([lat, lng], 18);
        }

        this.isLocating = false;
        this.notify.success('Location found! Pin placed at your current position.', 'Location Found');
      },
      (error) => {
        this.isLocating = false;
        let errorMessage = 'Unable to get your location';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location access in your browser.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out.';
            break;
        }
        this.notify.error(errorMessage, 'Location Error');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  async logout() {
    try {
      await this.auth.logout();
      await this.router.navigate(['/login']);
    } catch (err) {
      console.error('Logout failed', err);
    }
  }

  // Initialize Leaflet map after view is ready
  async ngAfterViewInit(): Promise<void> {
    // Small delay to ensure DOM is ready
    setTimeout(async () => {
      try {
        console.log('Attempting to initialize map...');
        const mapElement = document.getElementById('map');
        console.log('Map element found:', !!mapElement);

        if (!mapElement) {
          console.error('Map element #map not found in DOM');
          return;
        }

        // load leaflet dynamically
        const leafletModule = await import('leaflet');
        this.L = leafletModule.default || leafletModule;
        console.log('Leaflet loaded:', !!this.L);
        console.log('Leaflet.map exists:', typeof this.L.map);

        // Fix marker icon - use default icon from Leaflet CDN
        if (this.L.Icon && this.L.Icon.Default && this.L.Icon.Default.prototype) {
          delete (this.L.Icon.Default.prototype as any)._getIconUrl;
          this.L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
          });
        }

        // Get user's barangay to center map
        const user = await firstValueFrom(this.user$);
        let mapCenter = this.baguioCityCenter;
        let initialZoom = 14;

        if (user?.barangay) {
          const barangay = await firstValueFrom(this.barangaysService.getBarangayById(user.barangay));
          if (barangay) {
            this.userBarangay = barangay;
            if (barangay.lat != null && barangay.lng != null) {
              mapCenter = [barangay.lat, barangay.lng];
              initialZoom = 16;
              console.log(`Centering map on barangay ${barangay.name} at [${barangay.lat}, ${barangay.lng}]`);
            }
          }
        }

        // create map centered on user's barangay or Baguio City
        this.map = this.L.map('map', {
          center: mapCenter,
          zoom: initialZoom,
          zoomControl: true,
          scrollWheelZoom: true
        });

        console.log('Map instance created:', !!this.map);

        this.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19
        }).addTo(this.map);

        // Add barangay boundary if available
        if (this.userBarangay?.boundary && this.userBarangay.boundary.length > 0) {
          this.addBarangayBoundary(this.userBarangay.boundary);
        } else if (this.userBarangay?.name) {
          // Try to fetch boundary from OSM if not stored
          this.fetchAndShowBarangayBoundary(this.userBarangay.name);
        }

        // Create draggable marker at center immediately
        this.createDraggableMarker(mapCenter[0], mapCenter[1]);
        this.report.lat = mapCenter[0];
        this.report.lng = mapCenter[1];

        // Add click handler to place marker anywhere on map
        this.map.on('click', (e: any) => {
          const { lat, lng } = e.latlng;
          this.moveMarkerTo(lat, lng);
        });

        // Force map to resize properly - multiple attempts
        setTimeout(() => {
          if (this.map) {
            this.map.invalidateSize();
            console.log('Map invalidateSize called (100ms)');
          }
        }, 100);

        setTimeout(() => {
          if (this.map) {
            this.map.invalidateSize();
            console.log('Map invalidateSize called (300ms)');
          }
        }, 300);

        setTimeout(() => {
          if (this.map) {
            this.map.invalidateSize();
            console.log('Map invalidateSize called (500ms)');
          }
        }, 500);

        console.log('Leaflet map initialized successfully');
      } catch (e) {
        console.error('Leaflet failed to load', e);
      }
    }, 300);
  }

  /** Add barangay boundary polygon to map with red border */
  private addBarangayBoundary(boundary: number[][]) {
    if (!this.map || !this.L || !boundary || boundary.length === 0) return;

    // Remove existing boundary layer if any
    if (this.boundaryLayer) {
      this.map.removeLayer(this.boundaryLayer);
    }

    // Convert [lng, lat] to [lat, lng] for Leaflet (GeoJSON uses [lng, lat])
    const latLngs = boundary.map((coord: number[]) => [coord[1], coord[0]]);

    this.boundaryLayer = this.L.polygon(latLngs, {
      color: '#dc3545',  // Red border
      weight: 3,
      fillColor: '#dc3545',
      fillOpacity: 0.1,
      dashArray: '5, 5'
    }).addTo(this.map);

    // Fit map to boundary
    this.map.fitBounds(this.boundaryLayer.getBounds(), { padding: [20, 20] });
    console.log('Barangay boundary added to map');
  }

  /** Fetch barangay boundary from OpenStreetMap Nominatim API */
  private async fetchAndShowBarangayBoundary(barangayName: string) {
    try {
      const query = encodeURIComponent(`${barangayName}, Baguio City, Philippines`);
      const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&polygon_geojson=1&limit=1`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PollutionReportingApp/1.0'
        }
      });

      if (!response.ok) {
        console.warn('Failed to fetch boundary from OSM');
        return;
      }

      const data = await response.json();
      if (data.length > 0 && data[0].geojson) {
        const geojson = data[0].geojson;
        let boundary: number[][] | undefined;

        if (geojson.type === 'Polygon') {
          boundary = geojson.coordinates[0];
        } else if (geojson.type === 'MultiPolygon') {
          boundary = geojson.coordinates[0][0];
        }

        if (boundary) {
          this.addBarangayBoundary(boundary);
        }
      }
    } catch (err) {
      console.error('Error fetching barangay boundary:', err);
    }
  }

  /** Create a draggable marker at specified position */
  private createDraggableMarker(lat: number, lng: number) {
    if (!this.map || !this.L) return;

    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
      return;
    }

    this.marker = this.L.marker([lat, lng], {
      draggable: true,
      title: 'Drag me to pinpoint exact location'
    }).addTo(this.map);

    // Add a popup to make marker more visible
    this.marker.bindPopup('<b>📍 Drag me!</b><br>Move to exact pollution location').openPopup();

    // Handle marker drag events
    this.marker.on('dragend', (ev: any) => {
      const m = ev.target;
      const pos = m.getLatLng();
      this.report.lat = pos.lat;
      this.report.lng = pos.lng;
      console.log(`Marker dragged to: ${pos.lat}, ${pos.lng}`);
      // Update location text via reverse geocoding
      this.reverseGeocode(pos.lat, pos.lng);
    });

    this.marker.on('drag', (ev: any) => {
      const m = ev.target;
      const pos = m.getLatLng();
      this.report.lat = pos.lat;
      this.report.lng = pos.lng;
    });

    // Initial reverse geocode
    this.reverseGeocode(lat, lng);
  }

  /** Move marker to specified position */
  private moveMarkerTo(lat: number, lng: number) {
    this.report.lat = lat;
    this.report.lng = lng;

    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
    } else {
      this.createDraggableMarker(lat, lng);
    }
    console.log(`Marker moved to: ${lat}, ${lng}`);
    // Update location text via reverse geocoding
    this.reverseGeocode(lat, lng);
  }

  /** Reverse geocode coordinates to get address/location name */
  private async reverseGeocode(lat: number, lng: number) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PollutionReportingApp/1.0'
        }
      });

      if (!response.ok) {
        console.warn('Failed to reverse geocode');
        this.report.location = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        return;
      }

      const data = await response.json();
      if (data && data.display_name) {
        // Build a shorter, more readable address
        const addr = data.address || {};
        const parts: string[] = [];

        // Add road/street name if available
        if (addr.road) parts.push(addr.road);
        else if (addr.pedestrian) parts.push(addr.pedestrian);
        else if (addr.footway) parts.push(addr.footway);

        // Add neighborhood/suburb
        if (addr.neighbourhood) parts.push(addr.neighbourhood);
        else if (addr.suburb) parts.push(addr.suburb);
        else if (addr.quarter) parts.push(addr.quarter);

        // Add barangay if available
        if (addr.village) parts.push(addr.village);

        // Add city
        if (addr.city) parts.push(addr.city);
        else if (addr.town) parts.push(addr.town);

        if (parts.length > 0) {
          this.report.location = parts.join(', ');
        } else {
          // Fallback to full display name but truncate
          this.report.location = data.display_name.split(',').slice(0, 3).join(',').trim();
        }
        console.log('Location set to:', this.report.location);
      } else {
        this.report.location = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      }
    } catch (err) {
      console.error('Reverse geocoding error:', err);
      this.report.location = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  }

  ngOnDestroy(): void {
    if (this.map && this.map.remove) {
      this.map.remove();
      this.map = null;
      this.marker = null;
    }
  }

  onFileChange(event: any) {
    const files: FileList | null = event?.target?.files ?? null;
    // revoke previous previews
    this.previews.forEach(url => URL.revokeObjectURL(url));
    this.previews = [];
    const arr = files ? Array.from(files) : [];
    this.report.images = arr.slice(0, this.maxFiles);
    if (this.report.images.length) {
      this.previews = this.report.images.map(f => URL.createObjectURL(f));
    }
    this.progressPerImage = new Array(this.report.images.length).fill(0);
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const items = e.dataTransfer?.files;
    if (!items) return;
    const arr = Array.from(items as FileList).slice(0, this.maxFiles);
    this.report.images = arr;
    this.previews.forEach(url => URL.revokeObjectURL(url));
    this.previews = this.report.images.map(f => URL.createObjectURL(f));
    this.progressPerImage = new Array(this.report.images.length).fill(0);
  }

  /** Called when user selects a street from the dropdown (optional) */
  onStreetSelect(value: string) {
    if (!value || !this.map || !this.L) {
      return;
    }

    // Parse the value - could be a string or JSON Street object
    let streetData: string | Street;
    try {
      streetData = JSON.parse(value);
    } catch {
      streetData = value;
    }

    // Extract street name and coordinates
    let streetName: string;
    let coords: [number, number] | null = null;

    if (typeof streetData === 'string') {
      streetName = streetData;
    } else {
      streetName = streetData.name;
      if (streetData.lat != null && streetData.lng != null) {
        coords = [streetData.lat, streetData.lng];
      }
    }

    // If no coordinates from Firestore, check hardcoded lookup or use barangay center
    if (!coords) {
      coords = this.locationCoords[streetName];
      if (!coords) {
        // Use barangay center or Baguio City center
        if (this.userBarangay?.lat != null && this.userBarangay?.lng != null) {
          const offset = (Math.random() - 0.5) * 0.002;
          coords = [this.userBarangay.lat + offset, this.userBarangay.lng + offset];
        } else {
          const offset = Math.random() * 0.005;
          coords = [this.baguioCityCenter[0] + offset, this.baguioCityCenter[1] + offset];
        }
      }
    }

    const [lat, lng] = coords;

    // Set location to selected street name
    this.report.location = streetName;

    // Center map and move marker
    this.map.setView([lat, lng], 17);
    this.moveMarkerTo(lat, lng);

    console.log(`Street selected: "${streetName}" at [${lat}, ${lng}]`);
  }

  // Compress a single image to target KB range using canvas
  async compressImage(file: File, maxWidth = 1280, targetMinKB = 200, targetMaxKB = 400): Promise<File> {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = iw > maxWidth ? (maxWidth / iw) : 1;
    const nw = Math.round(iw * scale);
    const nh = Math.round(ih * scale);

    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, nw, nh);

    const minBytes = targetMinKB * 1024;
    const maxBytes = targetMaxKB * 1024;

    const toBlob = (q: number) => new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q));

    // binary search quality
    let low = 0.4, high = 0.95, bestBlob: Blob | null = null;
    for (let i = 0; i < 7; i++) {
      const q = (low + high) / 2;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // create blob
      // note: toBlob may return null in very rare cases
      // eslint-disable-next-line no-await-in-loop
      const blob = await toBlob(q);
      if (!blob) break;
      const size = blob.size;
      bestBlob = blob;
      if (size > maxBytes) {
        high = q;
      } else if (size < minBytes) {
        low = q;
      } else {
        // within desired range
        break;
      }
    }

    if (!bestBlob) {
      return file;
    }

    const newName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
    const newFile = new File([bestBlob], newName, { type: 'image/jpeg' });
    URL.revokeObjectURL(url);
    return newFile;
  }

  async submit() {
    // basic validation
    if (!this.report.type) {
      this.notify.warning('Please select pollution type', 'Missing Information');
      return;
    }
    if (!this.report.description) {
      this.notify.warning('Please provide a description', 'Missing Information');
      return;
    }
    // Location is now optional (street), but lat/lng from map is required
    if (this.report.lat == null || this.report.lng == null) {
      this.notify.warning('Please set a location on the map by clicking or dragging the marker', 'Missing Location');
      return;
    }

    if ((this.report.images || []).length === 0) {
      this.notify.warning('Please upload at least one image', 'Missing Images');
      return;
    }

    this.uploading = true;
    try {
      const user = await firstValueFrom(this.user$);
      if (!user) {
        this.uploading = false;
        this.notify.error('You must be logged in to submit a report', 'Not Logged In');
        this.router.navigate(['/login']);
        return;
      }
      // Prepare: compress images
      this.progressTotal = this.report.images.length;
      this.progressUploaded = 0;
      this.progressPercent = 0;
      this.progressPerImage = new Array(this.report.images.length).fill(0);

      const compressedFiles: File[] = [];
      for (let i = 0; i < this.report.images.length; i++) {
        // compress sequentially to avoid heavy CPU spikes
        // eslint-disable-next-line no-await-in-loop
        const compressed = await this.compressImage(this.report.images[i]);
        compressedFiles.push(compressed);
      }

      // Upload images with per-file progress
      const storage = getStorage();
      const totalFiles = compressedFiles.length;
      const uploadedUrls: string[] = [];

      const uploadSingle = (file: File, idx: number) => {
        return new Promise<string>((resolve, reject) => {
          try {
            const path = `reports/${user.uid}/${Date.now()}_${file.name}`;
            console.log(`🔥 Starting upload ${idx + 1}/${totalFiles}:`, path, 'Size:', file.size, 'bytes');
            const dest = storageRef(storage, path);
            const task = uploadBytesResumable(dest, file as Blob);
            console.log(`✅ Upload task created for file ${idx + 1}`);
            task.on('state_changed', (snapshot) => {
              const percent = Math.round((snapshot.bytesTransferred / (snapshot.totalBytes || 1)) * 100);
              console.log(`📊 File ${idx + 1} progress:`, percent, '%', `(${snapshot.bytesTransferred}/${snapshot.totalBytes})`);
              this.progressPerImage[idx] = percent;
              // compute overall percent as average
              const sum = this.progressPerImage.reduce((s, p) => s + p, 0);
              this.overallPercent = Math.round(sum / totalFiles);
            }, (err) => {
              console.error(`❌ Upload error for file ${idx + 1}:`, err);
              reject(err);
            }, async () => {
              try {
                const url = await getDownloadURL(dest as any);
                console.log(`✅ File ${idx + 1} uploaded successfully! URL:`, url);
                // mark this file as complete
                this.progressPerImage[idx] = 100;
                const sum = this.progressPerImage.reduce((s, p) => s + p, 0);
                this.overallPercent = Math.round(sum / totalFiles);
                this.progressUploaded += 1;
                if (this.progressUploaded <= totalFiles) {
                  this.progressPercent = Math.round((this.progressUploaded / Math.max(1, totalFiles)) * 100);
                }
                resolve(url as string);
              } catch (e) { reject(e); }
            });
          } catch (e) { reject(e); }
        });
      };

      // Upload images sequentially with per-file progress
      for (let i = 0; i < compressedFiles.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const u = await uploadSingle(compressedFiles[i], i);
        uploadedUrls.push(u);
      }

      // Save document with URLs
      // If no street selected, use barangay name or coordinates as location
      let locationText = this.report.location;
      if (!locationText && this.userBarangay?.name) {
        locationText = this.userBarangay.name;
      }
      if (!locationText && this.report.lat != null && this.report.lng != null) {
        locationText = `${this.report.lat.toFixed(6)}, ${this.report.lng.toFixed(6)}`;
      }

      await this.reportsService.saveReportWithUrls(user, {
        type: this.report.type,
        location: locationText || 'Unknown Location',
        description: this.report.description,
        imageUrls: uploadedUrls,
        dateTaken: this.report.dateTaken,
        timeTaken: this.report.timeTaken,
        barangayId: (user as any).barangay,
        lat: this.report.lat,
        lng: this.report.lng
      });

      // reset form
      this.report = { type: 'water', location: '', description: '', images: [], dateTaken: '', timeTaken: '', lat: undefined, lng: undefined };
      this.previews.forEach(url => URL.revokeObjectURL(url));
      this.previews = [];
      this.progressPerImage = [];
      this.uploading = false;
      this.notify.success('Report submitted successfully! Your report will be reviewed and approved by an admin before it is published.', 'Report Submitted');
      await this.router.navigate(['/']);
    } catch (err) {
      console.error('Failed to submit report', err);
      this.uploading = false;
      this.notify.error('Failed to submit report. Please try again.', 'Submission Failed');
    }
  }
}
