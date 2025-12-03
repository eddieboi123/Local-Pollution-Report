import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { ReportsService } from '../services/reports';
import { BarangaysService, Street } from '../services/barangays.service';
import { AuthService, AppUser } from '../services/auth-guard';
import { Observable, firstValueFrom, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { getStorage, ref as storageRef } from '@angular/fire/storage';
import { uploadBytesResumable, getDownloadURL } from 'firebase/storage';

@Component({
  selector: 'app-submit-report',
  templateUrl: './submit-report.html',
  styleUrls: ['./submit-report.css'],
  imports: [FormsModule, CommonModule, RouterLink],
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
  private L: any = null; // Store Leaflet reference

  // Baguio City base coordinates (center)
  private baguioCityCenter: [number, number] = [16.4023, 120.5960];

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
    private router: Router
  ) {
    this.user$ = this.auth.user$;
    // load lookup lists from Firestore via BarangaysService for the current user's barangay
    this.pollutionTypes$ = this.auth.user$.pipe(
      switchMap(u => u && u.barangay ? this.barangaysService.getBarangayById(u.barangay).pipe(map(b => (b && b.pollutionTypes) ? b.pollutionTypes.map(t => ({ value: t, label: t })) : [])) : of([]))
    );
    this.locations$ = this.auth.user$.pipe(
      switchMap(u => u && u.barangay ? this.barangaysService.getBarangayById(u.barangay).pipe(map(b => (b && b.streets) ? b.streets.map(s => {
        const name = typeof s === 'string' ? s : s.name;
        return { value: typeof s === 'string' ? s : JSON.stringify(s), label: name };
      }) : [])) : of([]))
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

        // create map centered on Baguio City
        this.map = this.L.map('map', {
          center: this.baguioCityCenter,
          zoom: 14,
          zoomControl: true,
          scrollWheelZoom: true
        });

        console.log('Map instance created:', !!this.map);

        this.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19
        }).addTo(this.map);

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

        console.log('Leaflet map initialized successfully - Baguio City');
      } catch (e) {
        console.error('Leaflet failed to load', e);
      }
    }, 300);
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

  /** Called when the user changes the location select */
  onLocationChange(value: string) {
    console.log('onLocationChange called:', value);
    console.log('Map exists?', !!this.map);
    console.log('Leaflet exists?', !!this.L);

    if (!value || !this.map || !this.L) {
      console.warn('Cannot update location: map or Leaflet not ready');
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
      this.report.location = streetName;
    } else {
      streetName = streetData.name;
      this.report.location = streetName;
      if (streetData.lat != null && streetData.lng != null) {
        coords = [streetData.lat, streetData.lng];
      }
    }

    // If no coordinates from Firestore, check hardcoded lookup or generate approximate
    if (!coords) {
      coords = this.locationCoords[streetName];
      if (!coords) {
        // Generate approximate coordinates near Baguio City center
        const offset = Math.random() * 0.01;
        coords = [this.baguioCityCenter[0] + offset, this.baguioCityCenter[1] + offset];
        console.log(`No predefined coordinates for "${streetName}", using approximate location`);
      }
    }

    const [lat, lng] = coords;

    // Center map on the location
    this.map.setView([lat, lng], 17);

    // Add or move draggable marker
    if (this.marker) {
      // If marker already exists, just move it
      this.marker.setLatLng([lat, lng]);
      console.log('Marker moved to:', lat, lng);
    } else {
      // Create new draggable marker
      this.marker = this.L.marker([lat, lng], {
        draggable: true,
        title: 'Drag me to pinpoint exact location'
      }).addTo(this.map);

      // Add a popup to make marker more visible
      this.marker.bindPopup('<b>📍 Drag me!</b><br>Move to exact pollution location').openPopup();

      // Handle marker drag event
      this.marker.on('dragend', (ev: any) => {
        const m = ev.target;
        const pos = m.getLatLng();
        this.report.lat = pos.lat;
        this.report.lng = pos.lng;
        console.log(`Marker dragged to: ${pos.lat}, ${pos.lng}`);
      });

      // Handle marker drag (while dragging)
      this.marker.on('drag', (ev: any) => {
        const m = ev.target;
        const pos = m.getLatLng();
        this.report.lat = pos.lat;
        this.report.lng = pos.lng;
      });

      console.log('New marker created at:', lat, lng);
    }

    // Set initial lat/lng in the form
    this.report.lat = lat;
    this.report.lng = lng;

    console.log(`Map centered on "${streetName}" at [${lat}, ${lng}]`);
  }  // Compress a single image to target KB range using canvas
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
      return alert('Please select pollution type');
    }
    if (!this.report.location || !this.report.description) {
      return alert('Please provide location and description');
    }

    if ((this.report.images || []).length === 0) {
      return alert('Please upload at least one image');
    }

    this.uploading = true;
    try {
      const user = await firstValueFrom(this.user$);
      if (!user) {
        this.uploading = false;
        alert('You must be logged in to submit a report');
        return this.router.navigate(['/login']);
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
      await this.reportsService.saveReportWithUrls(user, {
        type: this.report.type,
        location: this.report.location,
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
      alert('Report submitted successfully! Your report will be reviewed and approved by an admin before it is published.');
      await this.router.navigate(['/home']);
    } catch (err) {
      console.error('Failed to submit report', err);
      this.uploading = false;
      alert('Failed to submit report');
    }
  }
}
