# Firebase Functions - Delete User Authentication

This folder contains Firebase Cloud Functions for server-side operations that cannot be performed from the client.

## Setup Instructions

### 1. Install Dependencies

Navigate to the functions directory and install packages:

```bash
cd functions
npm install
```

### 2. Deploy to Firebase

Deploy the cloud functions to your Firebase project:

```bash
firebase deploy --only functions
```

This will deploy the `deleteUserAuth` function to Firebase.

### 3. Verify Deployment

After deployment, you should see output like:

```
✔  functions[deleteUserAuth(us-central1)] Successful create operation.
Function URL (deleteUserAuth(us-central1)): https://us-central1-local-pollution-report-app.cloudfunctions.net/deleteUserAuth
```

### 4. Test the Function

Once deployed, the admin dashboard's delete user button will:
1. Call the cloud function to delete the Firebase Authentication account
2. The cloud function also deletes the Firestore user document
3. Both operations are atomic and include permission checks

## Functions

### `deleteUserAuth`

**Purpose:** Deletes a user's Firebase Authentication account and Firestore document.

**Permissions:**
- Caller must be authenticated
- Caller must be an admin
- Main admins can delete any user
- Barangay admins can only delete users in their barangay (not other admins)
- Cannot delete yourself

**Parameters:**
```typescript
{
  uid: string  // The user ID to delete
}
```

**Returns:**
```typescript
{
  success: true,
  message: "User deleted successfully"
}
```

**Errors:**
- `unauthenticated` - User must be logged in
- `permission-denied` - User lacks admin privileges or tries to delete unauthorized user
- `invalid-argument` - Missing or invalid uid parameter
- `not-found` - User does not exist
- `internal` - Server error during deletion

## Local Development

To test functions locally using the Firebase Emulator Suite:

```bash
cd functions
npm run serve
```

This will start the Functions emulator at `http://localhost:5001`.

## File Structure

```
functions/
├── src/
│   └── index.ts          # Cloud functions code
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript configuration
└── .gitignore           # Git ignore rules
```

## Troubleshooting

### Function not found error

If you get "Function not found" error, ensure:
1. Functions are deployed: `firebase deploy --only functions`
2. Check Firebase Console > Functions to verify deployment
3. Ensure the function name matches: `deleteUserAuth`

### Permission denied errors

Verify:
1. Firestore security rules allow admin operations
2. User making the request has `role: 'admin'` in Firestore
3. For barangay admins, they're targeting users in their barangay

### Build errors

Run TypeScript compiler to check for errors:
```bash
cd functions
npm run build
```

## Notes

- **Firebase Blaze Plan Required:** Cloud Functions require the Blaze (pay-as-you-go) plan
- **Free Tier:** Includes 2M invocations/month for free
- **Cold Start:** First invocation may be slower due to cold start
- **Admin SDK:** Only cloud functions can use Firebase Admin SDK to delete auth accounts
