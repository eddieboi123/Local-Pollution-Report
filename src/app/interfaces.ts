export interface AppUser {
  uid: string;
  email: string | null;
  role: 'user' | 'admin';
  createdAt: any;
  barangay: string;
  suspended?: boolean;  // User suspension status
  settings?: {
    language: 'english' | 'filipino';
    textSize: 'small' | 'medium' | 'large';
    theme: 'light' | 'dark';
    notifications: { email: boolean; announcement: boolean; upvote: boolean };
  };
}

export interface AdminResponse {
  text: string;
  date: string; // or Firebase Timestamp
}

export interface Announcement {
  id?: string;            // Firestore document ID
  title: string;
  subtitle: string;
  description: string;
  date: any;               // Firestore Timestamp
  location: string;
  barangayId?: string;     // optional: null/undefined for global announcements
  createdAt: any;          // optional for ordering
}

export interface Report {
  reporterId: string;
  reporterName: string;
  type: 'water' | 'air' | 'land';
  location: string;
  date: string;
  time: string;
  description: string;
  images: string[];
  status: 'Pending' | 'In Progress' | 'Done'; // ✅ include all statuses
  upvotes: number;
  adminResponse?: AdminResponse;
  createdAt: any;
  id?: string;
  barangayId?: string;  // Barangay where the report was submitted
}
