import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
admin.initializeApp();

/**
 * Callable function to delete a user's Firebase Authentication account
 * This can only be done server-side using Admin SDK
 *
 * Requires: Caller must be an admin
 * Parameters: { uid: string } - The user ID to delete
 */
export const deleteUserAuth = functions.https.onCall(async (data, context) => {
  // Verify the caller is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  // Get the caller's user document to verify admin status
  const callerUid = context.auth.uid;
  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  const callerData = callerDoc.data();

  // Verify caller is an admin
  if (!callerData || callerData.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can delete users');
  }

  // Get the target user's UID from the request
  const { uid } = data;
  if (!uid || typeof uid !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'uid is required');
  }

  // Prevent self-deletion
  if (uid === callerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot delete yourself');
  }

  // Get target user's document to verify permissions
  const targetDoc = await admin.firestore().collection('users').doc(uid).get();
  const targetData = targetDoc.data();

  if (!targetData) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  // Check if caller is a barangay admin (has barangay assigned)
  const isMainAdmin = !callerData.barangay || callerData.barangay === '';

  if (!isMainAdmin) {
    // Barangay admins can only delete users in their barangay
    if (targetData.barangay !== callerData.barangay) {
      throw new functions.https.HttpsError('permission-denied', 'You can only delete users in your barangay');
    }
    // Barangay admins cannot delete other admins
    if (targetData.role === 'admin') {
      throw new functions.https.HttpsError('permission-denied', 'Barangay admins cannot delete other admins');
    }
  }

  try {
    // Delete the user's authentication account
    await admin.auth().deleteUser(uid);

    // Optionally delete their Firestore document as well
    await admin.firestore().collection('users').doc(uid).delete();

    return { success: true, message: 'User deleted successfully' };
  } catch (error: any) {
    console.error('Error deleting user:', error);
    throw new functions.https.HttpsError('internal', `Failed to delete user: ${error.message}`);
  }
});
