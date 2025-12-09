import { Injectable } from '@angular/core';
import { Firestore, collection, collectionData, addDoc, doc, docData, updateDoc, query, where, deleteDoc, orderBy } from '@angular/fire/firestore';
import { Observable, firstValueFrom, map } from 'rxjs';
import { arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { AuthService } from './auth-guard';

export interface Street {
  name: string;
  lat?: number;
  lng?: number;
}

export interface Barangay {
  id?: string;
  name: string;
  adminIds: string[];
  streets: (string | Street)[];  // Support both old and new format
  pollutionTypes: string[];
  lat?: number;  // Center latitude of barangay
  lng?: number;  // Center longitude of barangay
  boundary?: number[][];  // GeoJSON polygon coordinates for boundary
  createdAt?: any;
}

@Injectable({ providedIn: 'root' })
export class BarangaysService {
  constructor(private firestore: Firestore, private auth: AuthService) {}

  /**
   * Ensure current user is authorized for actions on a barangay.
   * If requireGlobal=true then only a main-admin (no barangay assigned) is allowed.
   * Otherwise allow main-admin or an admin whose `barangay` matches `barangayId`.
   */
  private async ensureAdminFor(barangayId?: string | null, requireGlobal = false) {
    const u = await firstValueFrom(this.auth.user$);
    if (!u || u.role !== 'admin') throw new Error('Unauthorized: admin required');
    const isGlobal = !u.barangay || u.barangay === '';
    if (requireGlobal) {
      if (!isGlobal) throw new Error('Unauthorized: main-admin required');
      return;
    }
    // allow if global admin or local admin for the specified barangay
    if (isGlobal) return;
    if (barangayId && u.barangay === barangayId) return;
    throw new Error('Unauthorized: admin for this barangay required');
  }

  /** Create a new barangay and return its doc id (via addDoc result) */
  async createBarangay(payload: { name: string; adminId?: string; streets?: string[]; pollutionTypes?: string[]; lat?: number; lng?: number; boundary?: number[][]; }) {
    // creating a barangay is restricted to main-admins
    await this.ensureAdminFor(null, true);
    const col = collection(this.firestore, 'barangays');
    const data: any = {
      name: payload.name,
      adminIds: payload.adminId ? [payload.adminId] : [],
      streets: payload.streets || [],
      pollutionTypes: payload.pollutionTypes || [],
      createdAt: serverTimestamp()
    };
    // Add coordinates if provided
    if (payload.lat != null) data.lat = payload.lat;
    if (payload.lng != null) data.lng = payload.lng;
    if (payload.boundary) data.boundary = payload.boundary;
    const docRef = await addDoc(col, data);
    return docRef.id;
  }

  /** Delete a barangay */
  async deleteBarangay(barangayId: string) {
    // deleting a barangay is restricted to main-admins
    await this.ensureAdminFor(null, true);
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await deleteDoc(d);
  }

  /** Get all barangays sorted by name (ascending) */
  getAllBarangays(): Observable<(Barangay & { id?: string })[]> {
    const col = collection(this.firestore, 'barangays');
    return (collectionData(col, { idField: 'id' }) as Observable<(Barangay & { id?: string })[]>).pipe(
      map(barangays => barangays.sort((a, b) => a.name.localeCompare(b.name)))
    );
  }

  /** Get barangay by id */
  getBarangayById(barangayId: string): Observable<Barangay | undefined> {
    const d = doc(this.firestore, `barangays/${barangayId}`);
    return docData(d) as Observable<Barangay>;
  }

  /** Update basic fields of a barangay */
  async updateBarangay(barangayId: string, changes: Partial<Barangay>) {
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await updateDoc(d, changes as any);
  }

  /** Add a street to a barangay with optional coordinates */
  async addStreet(barangayId: string, street: string | Street) {
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await updateDoc(d, { streets: arrayUnion(street) });
  }

  /** Remove a street from a barangay */
  async removeStreet(barangayId: string, street: string | Street) {
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await updateDoc(d, { streets: arrayRemove(street) });
  }

  /** Add a pollution type to a barangay */
  async addPollutionType(barangayId: string, type: string) {
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await updateDoc(d, { pollutionTypes: arrayUnion(type) });
  }

  /** Remove a pollution type from a barangay */
  async removePollutionType(barangayId: string, type: string) {
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await updateDoc(d, { pollutionTypes: arrayRemove(type) });
  }

  /** Assign a barangay admin (add to adminIds) */
  async assignAdmin(barangayId: string, adminUid: string) {
    // allow main-admins or barangay-admins for this barangay
    await this.ensureAdminFor(barangayId);
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await updateDoc(d, { adminIds: arrayUnion(adminUid) });
  }

  /** Remove an admin from barangay */
  async removeAdmin(barangayId: string, adminUid: string) {
    // allow main-admins or barangay-admins for this barangay
    await this.ensureAdminFor(barangayId);
    const d = doc(this.firestore, `barangays/${barangayId}`);
    await updateDoc(d, { adminIds: arrayRemove(adminUid) });
  }
}
