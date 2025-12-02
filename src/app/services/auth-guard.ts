import { Injectable } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, authState, User as FirebaseUser, sendPasswordResetEmail } from '@angular/fire/auth';
import { Firestore, doc, setDoc, docData, updateDoc } from '@angular/fire/firestore';
import { Observable, of, switchMap, take } from 'rxjs';

export interface AppUser {
  uid: string;
  email: string | null;
  role: 'user' | 'admin';
  createdAt: any;
  barangay: string;
  settings?: {
    language: 'english' | 'filipino';
    textSize: 'small' | 'medium' | 'large';
    theme: 'light' | 'dark';
    notifications: { email: boolean; announcement: boolean; upvote: boolean; };
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  public user$: Observable<AppUser | null>;

  constructor(private auth: Auth, private firestore: Firestore) {
    this.user$ = authState(this.auth).pipe(
      switchMap((firebaseUser: FirebaseUser | null) => {
        if (firebaseUser) {
          const userDoc = doc(this.firestore, `users/${firebaseUser.uid}`);
          return docData(userDoc) as Observable<AppUser>;
        } else {
          return of(null);
        }
      })
    );
  }

  async register(email: string, password: string, role: 'user' | 'admin' = 'user', barangay: string = ''): Promise<void> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    const userRef = doc(this.firestore, `users/${credential.user.uid}`);
    await setDoc(userRef, {
      uid: credential.user.uid,
      email: credential.user.email,
      role,
      barangay,
      createdAt: new Date(),
      settings: {
        language: 'english',
        textSize: 'medium',
        theme: 'light',
        notifications: { email: true, announcement: true, upvote: true }
      }
    });
  }

  async login(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);

    // Check if user is suspended
    const userDoc = doc(this.firestore, `users/${credential.user.uid}`);
    const userData = await docData(userDoc).pipe(take(1)).toPromise() as AppUser & { suspended?: boolean };

    if (userData?.suspended === true) {
      await signOut(this.auth); // Immediately sign out
      throw new Error('Your account has been suspended. Please contact the administrator.');
    }
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  async resetPassword(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email);
  }

  async updateSettings(uid: string, settings: AppUser['settings']): Promise<void> {
    const userRef = doc(this.firestore, `users/${uid}`);
    await updateDoc(userRef, { settings });
  }

  getCurrentUserSync(): AppUser | null {
    let currentUser: AppUser | null = null;
    this.user$.pipe(take(1)).subscribe(user => currentUser = user);
    return currentUser;
  }
}
