// src/app/services/reports.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  collectionData,
  query,
  where,
  doc,
  updateDoc,
  orderBy,
  deleteDoc
} from '@angular/fire/firestore';

import { getStorage, ref } from '@angular/fire/storage';
import { uploadBytesResumable, getDownloadURL } from 'firebase/storage';

import { Report } from '../interfaces';
import { serverTimestamp } from 'firebase/firestore';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ReportsService {

  private storage = getStorage(); // Firebase Storage instance

  // control upload mode: parallel (true) or sequential (false)
  public parallelUploads = true;

  constructor(private firestore: Firestore) {}

  /** Add a new report with optional images */
  async addReport(
    user: any,
    reportData: {
      type: string;
      location: string;
      description: string;
      images: File[];
      dateTaken?: string;
      timeTaken?: string;
      barangayId?: string;
    },
    onProgress?: (uploaded: number, total: number) => void
  ): Promise<void> {
    const reportsCollection = collection(this.firestore, 'reports');
    // Upload images to Storage (resumable) respecting parallelUploads
    const files = reportData.images || [];
    const imageUrls: string[] = [];
    const total = files.length;

    const uploadSingle = (file: File, index: number) => {
      return new Promise<string>((resolve, reject) => {
        try {
          const destRef = ref(this.storage, `reports/${user.uid}/${Date.now()}_${file.name}`);
          const uploadTask = uploadBytesResumable(destRef, file as Blob);

          uploadTask.on('state_changed', (snapshot) => {
            // could add per-file bytes progress if caller wants more detail
            // snapshot.bytesTransferred / snapshot.totalBytes
          }, (err) => {
            reject(err);
          }, async () => {
            try {
              const url = await getDownloadURL(destRef as any);
              resolve(url as string);
            } catch (e) { reject(e); }
          });
        } catch (e) { reject(e); }
      });
    };

    if (this.parallelUploads) {
      // start all uploads in parallel
      const promises = files.map((f, i) => uploadSingle(f, i));
      const results = await Promise.all(promises);
      results.forEach((u) => imageUrls.push(u));
      if (onProgress) {
        try { onProgress(total, total); } catch (e) { }
      }
    } else {
      // sequential uploads
      for (let i = 0; i < total; i++) {
        const url = await uploadSingle(files[i], i);
        imageUrls.push(url);
        if (onProgress) {
          try { onProgress(i + 1, total); } catch (e) { }
        }
      }
    }

    // Prepare Firestore document with correct field names matching Report interface
    const newReport: any = {
      type: reportData.type,
      location: reportData.location,
      date: reportData.dateTaken || new Date().toLocaleDateString(),
      time: reportData.timeTaken || new Date().toLocaleTimeString(),
      description: reportData.description,
      images: imageUrls,
      reporterId: user.uid,
      reporterName: user.email || 'Anonymous',
      barangayId: reportData.barangayId || (user?.barangay || null),
      status: 'Pending',
      upvotes: 0,
      createdAt: serverTimestamp()
    };

    // Save to Firestore
    await addDoc(reportsCollection, newReport);
  }

  /** Save a report document when you already have image URLs (no uploads) */
  async saveReportWithUrls(user: any, payload: {
    type: string;
    location: string;
    description: string;
    imageUrls: string[];
    dateTaken?: string;
    timeTaken?: string;
    barangayId?: string;
  }) {
    const reportsCollection = collection(this.firestore, 'reports');
    const newReport: any = {
      type: payload.type,
      location: payload.location,
      date: payload.dateTaken || new Date().toLocaleDateString(),
      time: payload.timeTaken || new Date().toLocaleTimeString(),
      description: payload.description,
      images: payload.imageUrls || [],
      reporterId: user.uid,
      reporterName: user.email || 'Anonymous',
      barangayId: payload.barangayId || (user?.barangay || null),
      status: 'Pending',
      upvotes: 0,
      createdAt: serverTimestamp()
    };

    await addDoc(reportsCollection, newReport);
  }

  /** Get ALL reports (latest first) */
  getAllReports(): Observable<(Report & { id: string })[]> {
    const reportsCollection = collection(this.firestore, 'reports');
    const q = query(reportsCollection, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<
      (Report & { id: string })[]
    >;
  }

  /** Get reports by barangay (latest first) - REQUIRES COMPOSITE INDEX */
  getReportsByBarangay(barangayId: string): Observable<(Report & { id: string })[]> {
    const reportsCollection = collection(this.firestore, 'reports');
    // NOTE: This query requires a composite index on (barangayId, createdAt)
    // Create it in Firebase Console by clicking the link in the error message
    const q = query(reportsCollection, where('barangayId', '==', barangayId), orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<(Report & { id: string })[]>;
  }

  /** Get pollution types from Firestore (collection: pollutionTypes)
   * Each doc should contain { value: string, label?: string }
   */
  getPollutionTypes(): Observable<{ value: string; label?: string }[]> {
    try {
      const col = collection(this.firestore, 'pollutionTypes');
      return collectionData(col, { idField: 'id' }) as Observable<{
        value: string;
        label?: string;
      }[]>;
    } catch (e) {
      return new Observable((sub) => { sub.next([]); sub.complete(); });
    }
  }

  /** Get available locations from Firestore (collection: locations)
   * Each doc should contain { value: string, label?: string }
   */
  getLocations(): Observable<{ value: string; label?: string }[]> {
    try {
      const col = collection(this.firestore, 'locations');
      return collectionData(col, { idField: 'id' }) as Observable<{
        value: string;
        label?: string;
      }[]>;
    } catch (e) {
      return new Observable((sub) => { sub.next([]); sub.complete(); });
    }
  }

  /** Get reports for a specific user */
  getUserReports(userId: string): Observable<(Report & { id: string })[]> {
    const reportsCollection = collection(this.firestore, 'reports');
    const q = query(
      reportsCollection,
      where('reporterId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    return collectionData(q, { idField: 'id' }) as Observable<
      (Report & { id: string })[]
    >;
  }

  /** Update a report */
  async updateReport(reportId: string, data: Partial<Report>): Promise<void> {
    const reportDoc = doc(this.firestore, `reports/${reportId}`);
    await updateDoc(reportDoc, data);
  }

  /** Increment upvotes for a report (simple implementation) */
  async upvoteReport(reportId: string, currentUpvotes: number): Promise<void> {
    const reportDoc = doc(this.firestore, `reports/${reportId}`);
    await updateDoc(reportDoc, { upvotes: (currentUpvotes || 0) + 1 });
  }

  /** DELETE a report (simple - no storage cleanup) */
  async deleteReport(reportId: string): Promise<void> {
    const reportDoc = doc(this.firestore, `reports/${reportId}`);
    await deleteDoc(reportDoc);
  }

  /** DELETE a report AND its associated Storage images */
  async deleteReportWithImages(reportId: string, imageUrls: string[]): Promise<void> {
    // Delete images from Storage first
    if (imageUrls && imageUrls.length > 0) {
      const { deleteObject, ref: storageRef } = await import('firebase/storage');

      for (const url of imageUrls) {
        try {
          // Extract the storage path from the URL
          // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?...
          const urlParts = url.split('/o/');
          if (urlParts.length > 1) {
            const pathWithQuery = urlParts[1].split('?')[0];
            const path = decodeURIComponent(pathWithQuery);
            const imageRef = storageRef(this.storage, path);
            await deleteObject(imageRef);
            console.log('Deleted image from Storage:', path);
          }
        } catch (err) {
          console.error('Failed to delete image from Storage:', url, err);
          // Continue with other deletions even if one fails
        }
      }
    }

    // Delete Firestore document
    const reportDoc = doc(this.firestore, `reports/${reportId}`);
    await deleteDoc(reportDoc);
  }
}
