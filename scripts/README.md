# Baguio City Barangays Seeding Script

This script populates Firebase Firestore with all 128 barangays of Baguio City, including their coordinates and streets from OpenStreetMap.

## Prerequisites

1. **Firebase Service Account Key**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select your project
   - Go to **Project Settings** > **Service Accounts**
   - Click **Generate New Private Key**
   - Save the file as `serviceAccountKey.json` in the project root (same level as `package.json`)

2. **Node.js** (v18 or later recommended)

## Setup

```bash
# Navigate to scripts folder
cd scripts

# Install dependencies
npm install
```

## Running the Script

```bash
# From the scripts folder
npm run seed:barangays

# Or using npx from project root
npx ts-node scripts/seed-barangays.ts
```

## What the Script Does

1. **Connects to Firestore** using Firebase Admin SDK with your service account credentials

2. **Checks existing barangays** to avoid duplicates - if a barangay already exists, it will be skipped

3. **For each of the 128 Baguio City barangays**:
   - Fetches streets within ~1.5km radius from OpenStreetMap Overpass API
   - Attempts to fetch barangay boundary polygon from Nominatim API
   - Creates a Firestore document with:
     - `name` - Barangay name
     - `lat`, `lng` - Center coordinates
     - `streets` - Array of streets with their coordinates
     - `pollutionTypes` - Default pollution categories
     - `adminIds` - Empty array (for assigning barangay admins later)
     - `boundary` - Polygon coordinates (if available)
     - `createdAt` - Timestamp

4. **Rate limiting** - The script respects API rate limits (1 request per second for Nominatim)

## Sample Output

```
🌱 Starting Baguio City Barangays Seeding...

📍 Total barangays to process: 128

📊 Existing barangays in database: 0

[1/128] 🔍 Fetching streets for Abanao-Zandueta-Kayong-Chugum-Otek (AZKCO)...
[1/128] ✅ Added Abanao-Zandueta-Kayong-Chugum-Otek (AZKCO) with 15 streets (ID: abc123)
...

==================================================
📊 SEEDING COMPLETE
==================================================
✅ Added: 128
⏭️  Skipped: 0
❌ Errors: 0
📍 Total in database: 128

🎉 Seeding completed successfully!
```

## Notes

- The script is idempotent - running it multiple times will skip already existing barangays
- Street data quality depends on OpenStreetMap coverage for that area
- Some barangays may have few streets if the area isn't well-mapped in OSM
- The script takes approximately 3-4 minutes to complete due to rate limiting

## Troubleshooting

### Error: Cannot find module 'firebase-admin'
```bash
npm install
```

### Error loading service account
Make sure `serviceAccountKey.json` exists in the project root.

### API rate limit errors
The script includes built-in delays. If you still get rate-limited, increase the delay values in the script.
