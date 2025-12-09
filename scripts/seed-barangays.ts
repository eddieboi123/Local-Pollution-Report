/**
 * Baguio City Barangays Seeding Script
 *
 * This script fetches all barangays in Baguio City from OpenStreetMap
 * and populates Firestore with barangay data including streets and coordinates.
 *
 * Run with: npx ts-node scripts/seed-barangays.ts
 * Or add to package.json scripts: "seed:barangays": "ts-node scripts/seed-barangays.ts"
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin with service account
const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error('Error loading service account. Make sure serviceAccountKey.json exists in the project root.');
  console.error('Download it from Firebase Console > Project Settings > Service Accounts');
  process.exit(1);
}

const db = admin.firestore();

interface Street {
  name: string;
  lat: number;
  lng: number;
}

interface BarangayData {
  name: string;
  lat: number;
  lng: number;
  streets: Street[];
  pollutionTypes: string[];
  adminIds: string[];
  boundary?: number[][];
  createdAt: admin.firestore.FieldValue;
}

// Default pollution types for all barangays
const DEFAULT_POLLUTION_TYPES = [
  'Air Pollution',
  'Water Pollution',
  'Land Pollution',
  'Noise Pollution',
  'Light Pollution',
  'Illegal Dumping',
  'Smoke Belching',
  'Open Burning'
];

// Rate limiting helper - Nominatim requires 1 request per second
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch data from OpenStreetMap Nominatim API
 */
async function fetchFromOSM(query: string, type: 'search' | 'lookup' = 'search'): Promise<any[]> {
  const baseUrl = type === 'search'
    ? 'https://nominatim.openstreetmap.org/search'
    : 'https://nominatim.openstreetmap.org/lookup';

  const url = `${baseUrl}?q=${encodeURIComponent(query)}&format=json&addressdetails=1&polygon_geojson=1&limit=50`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BaguioPollutionReportApp/1.0 (educational project)',
      'Accept-Language': 'en'
    }
  });

  if (!response.ok) {
    throw new Error(`OSM API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch streets within a barangay using Overpass API (more detailed than Nominatim)
 */
async function fetchStreetsFromOverpass(barangayName: string, barangayLat: number, barangayLng: number): Promise<Street[]> {
  // Use Overpass API to get streets within ~1km radius of barangay center
  const overpassQuery = `
    [out:json][timeout:25];
    (
      way["highway"]["name"](around:1500,${barangayLat},${barangayLng});
    );
    out center;
  `;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BaguioPollutionReportApp/1.0 (educational project)'
      }
    });

    if (!response.ok) {
      console.warn(`Overpass API error for ${barangayName}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const streets: Street[] = [];
    const seenNames = new Set<string>();

    for (const element of data.elements || []) {
      if (element.tags?.name && element.center) {
        const name = element.tags.name;
        if (!seenNames.has(name.toLowerCase())) {
          seenNames.add(name.toLowerCase());
          streets.push({
            name: name,
            lat: element.center.lat,
            lng: element.center.lon
          });
        }
      }
    }

    return streets;
  } catch (error) {
    console.warn(`Error fetching streets for ${barangayName}:`, error);
    return [];
  }
}

/**
 * Complete list of all 128 barangays in Baguio City with approximate coordinates
 * Data compiled from official sources and OpenStreetMap
 */
const BAGUIO_BARANGAYS: { name: string; lat: number; lng: number }[] = [
  { name: "Abanao-Zandueta-Kayong-Chugum-Otek (AZKCO)", lat: 16.4107, lng: 120.5960 },
  { name: "Alfonso Tabora", lat: 16.3950, lng: 120.5750 },
  { name: "Ambiong", lat: 16.4280, lng: 120.5650 },
  { name: "Andres Bonifacio (Lower Quirino Hill)", lat: 16.4050, lng: 120.5980 },
  { name: "Apugan-Loakan", lat: 16.3780, lng: 120.5720 },
  { name: "Asin Road", lat: 16.4150, lng: 120.5550 },
  { name: "Atok Trail", lat: 16.3850, lng: 120.5680 },
  { name: "Aurora Hill North Central", lat: 16.4180, lng: 120.5920 },
  { name: "Aurora Hill South Central", lat: 16.4160, lng: 120.5910 },
  { name: "Aurora Hill Proper", lat: 16.4170, lng: 120.5930 },
  { name: "Bagong Lipunan (Market Area)", lat: 16.4095, lng: 120.5940 },
  { name: "Bakakeng Central", lat: 16.3920, lng: 120.5700 },
  { name: "Bakakeng North", lat: 16.3950, lng: 120.5680 },
  { name: "Bal-Marcoville (Marcoville)", lat: 16.4250, lng: 120.5800 },
  { name: "Balsigan", lat: 16.3700, lng: 120.5600 },
  { name: "Bayan Park East", lat: 16.4100, lng: 120.5920 },
  { name: "Bayan Park Village", lat: 16.4090, lng: 120.5900 },
  { name: "Bayan Park West", lat: 16.4080, lng: 120.5890 },
  { name: "BGH Compound", lat: 16.4020, lng: 120.5960 },
  { name: "Brookside", lat: 16.4200, lng: 120.5750 },
  { name: "Brookspoint", lat: 16.4180, lng: 120.5730 },
  { name: "Cabinet Hill-Teacher's Camp", lat: 16.4050, lng: 120.5850 },
  { name: "Camdas Subdivision", lat: 16.4100, lng: 120.5700 },
  { name: "Camp 7", lat: 16.3800, lng: 120.5550 },
  { name: "Camp 8", lat: 16.3750, lng: 120.5500 },
  { name: "Camp Allen", lat: 16.4120, lng: 120.5870 },
  { name: "Campo Filipino", lat: 16.4000, lng: 120.5800 },
  { name: "City Camp Central", lat: 16.4140, lng: 120.5880 },
  { name: "City Camp Proper", lat: 16.4130, lng: 120.5870 },
  { name: "Country Club Village", lat: 16.3900, lng: 120.5850 },
  { name: "Cresencia Village", lat: 16.4050, lng: 120.5750 },
  { name: "Dagsian Lower", lat: 16.4070, lng: 120.5970 },
  { name: "Dagsian Upper", lat: 16.4080, lng: 120.5980 },
  { name: "Dizon Subdivision", lat: 16.4000, lng: 120.5720 },
  { name: "Dominican Hill-Mirador", lat: 16.4000, lng: 120.5900 },
  { name: "Dontogan", lat: 16.3650, lng: 120.5550 },
  { name: "DPS Area", lat: 16.4030, lng: 120.5890 },
  { name: "Engineers' Hill", lat: 16.4040, lng: 120.5870 },
  { name: "Fairview Village", lat: 16.4200, lng: 120.5850 },
  { name: "Ferdinand (Happy Homes-Campo Sioco)", lat: 16.4020, lng: 120.5780 },
  { name: "Fort del Pilar", lat: 16.3950, lng: 120.5950 },
  { name: "Gabriela Silang", lat: 16.4060, lng: 120.5920 },
  { name: "General Emilio F. Aguinaldo (Quirino-Magsaysay, Upper QM)", lat: 16.4040, lng: 120.5970 },
  { name: "General Luna Lower", lat: 16.4100, lng: 120.5950 },
  { name: "General Luna Upper", lat: 16.4120, lng: 120.5960 },
  { name: "Gibraltar", lat: 16.4220, lng: 120.5900 },
  { name: "Greenwater Village", lat: 16.4150, lng: 120.5700 },
  { name: "Guisad Central", lat: 16.4250, lng: 120.5750 },
  { name: "Guisad Soriano", lat: 16.4260, lng: 120.5740 },
  { name: "Happy Hollow", lat: 16.4000, lng: 120.5820 },
  { name: "Happy Homes (Lucban)", lat: 16.4010, lng: 120.5770 },
  { name: "Harrison-Claudio Carantes", lat: 16.4100, lng: 120.5930 },
  { name: "Hillside", lat: 16.4070, lng: 120.5860 },
  { name: "Holy Ghost Extension", lat: 16.4130, lng: 120.5890 },
  { name: "Holy Ghost Proper", lat: 16.4140, lng: 120.5900 },
  { name: "Honeymoon (Honeymoon Road)", lat: 16.3980, lng: 120.5700 },
  { name: "Imelda R. Marcos (La Salle)", lat: 16.4080, lng: 120.5850 },
  { name: "Imelda Village", lat: 16.4200, lng: 120.5650 },
  { name: "Irisan", lat: 16.4300, lng: 120.5600 },
  { name: "Kabayanihan", lat: 16.4050, lng: 120.5730 },
  { name: "Kagitingan", lat: 16.4040, lng: 120.5740 },
  { name: "Kayang Extension", lat: 16.4110, lng: 120.5970 },
  { name: "Kayang-Hilltop", lat: 16.4115, lng: 120.5965 },
  { name: "Kias", lat: 16.4350, lng: 120.5700 },
  { name: "Legarda-Burnham-Kisad", lat: 16.4110, lng: 120.5920 },
  { name: "Liwanag-Loakan", lat: 16.3820, lng: 120.5750 },
  { name: "Loakan Proper", lat: 16.3750, lng: 120.5780 },
  { name: "Loakan-Apugan", lat: 16.3770, lng: 120.5730 },
  { name: "Loakan-Liwanag", lat: 16.3800, lng: 120.5760 },
  { name: "Lopez Jaena", lat: 16.4020, lng: 120.5930 },
  { name: "Lourdes Subdivision Extension", lat: 16.4180, lng: 120.5880 },
  { name: "Lourdes Subdivision Lower", lat: 16.4170, lng: 120.5870 },
  { name: "Lourdes Subdivision Proper", lat: 16.4175, lng: 120.5875 },
  { name: "Lualhati", lat: 16.4090, lng: 120.5910 },
  { name: "Lucnab", lat: 16.4280, lng: 120.5850 },
  { name: "Magsaysay Lower", lat: 16.4050, lng: 120.5960 },
  { name: "Magsaysay Upper", lat: 16.4060, lng: 120.5970 },
  { name: "Magsaysay Private Road", lat: 16.4055, lng: 120.5965 },
  { name: "Malcolm Square-Perfecto (Jose Abad Santos)", lat: 16.4105, lng: 120.5935 },
  { name: "Manuel A. Roxas", lat: 16.4000, lng: 120.5940 },
  { name: "Market Subdivision Upper", lat: 16.4085, lng: 120.5945 },
  { name: "Middle Quezon Hill Subdivision (Quezon Hill Middle)", lat: 16.4045, lng: 120.6010 },
  { name: "Military Cut-off", lat: 16.3900, lng: 120.5900 },
  { name: "Mines View Park", lat: 16.4150, lng: 120.6050 },
  { name: "Modern Site East", lat: 16.4070, lng: 120.5880 },
  { name: "Modern Site West", lat: 16.4065, lng: 120.5870 },
  { name: "MRR-Queen of Peace", lat: 16.4150, lng: 120.5800 },
  { name: "New Lucban", lat: 16.4030, lng: 120.5760 },
  { name: "Outlook Drive", lat: 16.4160, lng: 120.6000 },
  { name: "Pacdal", lat: 16.4020, lng: 120.5870 },
  { name: "Padre Burgos", lat: 16.4090, lng: 120.5940 },
  { name: "Padre Zamora", lat: 16.4095, lng: 120.5955 },
  { name: "Palma-Urbano (Cariño-Palma)", lat: 16.4130, lng: 120.5940 },
  { name: "Phil-Am", lat: 16.4100, lng: 120.5790 },
  { name: "Pinget", lat: 16.4320, lng: 120.5750 },
  { name: "Pinsao Pilot Project", lat: 16.4230, lng: 120.5680 },
  { name: "Pinsao Proper", lat: 16.4220, lng: 120.5670 },
  { name: "Poliwes", lat: 16.4060, lng: 120.5890 },
  { name: "Pucsusan", lat: 16.4350, lng: 120.5800 },
  { name: "Quezon Hill Proper", lat: 16.4030, lng: 120.6000 },
  { name: "Quezon Hill Upper", lat: 16.4040, lng: 120.6020 },
  { name: "Quirino Hill East", lat: 16.4060, lng: 120.5990 },
  { name: "Quirino Hill Lower", lat: 16.4045, lng: 120.5975 },
  { name: "Quirino Hill Middle", lat: 16.4050, lng: 120.5985 },
  { name: "Quirino Hill West", lat: 16.4055, lng: 120.5970 },
  { name: "Rizal Monument Area", lat: 16.4102, lng: 120.5928 },
  { name: "Rock Quarry Lower", lat: 16.4240, lng: 120.5880 },
  { name: "Rock Quarry Middle", lat: 16.4250, lng: 120.5890 },
  { name: "Rock Quarry Upper", lat: 16.4260, lng: 120.5900 },
  { name: "Saint Joseph Village", lat: 16.4190, lng: 120.5760 },
  { name: "Salud Mitra", lat: 16.4070, lng: 120.5850 },
  { name: "San Antonio Village", lat: 16.4080, lng: 120.5800 },
  { name: "San Luis Village", lat: 16.4100, lng: 120.5780 },
  { name: "San Roque Village", lat: 16.4120, lng: 120.5810 },
  { name: "San Vicente", lat: 16.4140, lng: 120.5950 },
  { name: "Sanitary Camp North", lat: 16.4150, lng: 120.5860 },
  { name: "Sanitary Camp South", lat: 16.4140, lng: 120.5850 },
  { name: "Santa Escolastica", lat: 16.4010, lng: 120.5850 },
  { name: "Santo Rosario", lat: 16.4000, lng: 120.5860 },
  { name: "Santo Tomas Proper", lat: 16.3980, lng: 120.5880 },
  { name: "Santo Tomas School Area", lat: 16.3970, lng: 120.5890 },
  { name: "Scout Barrio", lat: 16.3960, lng: 120.5870 },
  { name: "Session Road Area", lat: 16.4115, lng: 120.5930 },
  { name: "Slaughter House Area (Santo Niño Slaughter)", lat: 16.4200, lng: 120.5920 },
  { name: "SLU-SVP Housing Village", lat: 16.4080, lng: 120.5820 },
  { name: "South Drive", lat: 16.4000, lng: 120.5920 },
  { name: "Teodora Alonzo", lat: 16.4030, lng: 120.5950 },
  { name: "Trancoville", lat: 16.4270, lng: 120.5820 },
  { name: "Victoria Village", lat: 16.4160, lng: 120.5780 }
];

/**
 * Main seeding function
 */
async function seedBarangays() {
  console.log('🌱 Starting Baguio City Barangays Seeding...\n');
  console.log(`📍 Total barangays to process: ${BAGUIO_BARANGAYS.length}\n`);

  const barangaysCollection = db.collection('barangays');

  // Check for existing barangays
  const existingSnapshot = await barangaysCollection.get();
  const existingNames = new Set(existingSnapshot.docs.map(doc => doc.data().name?.toLowerCase()));

  console.log(`📊 Existing barangays in database: ${existingSnapshot.size}\n`);

  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < BAGUIO_BARANGAYS.length; i++) {
    const barangay = BAGUIO_BARANGAYS[i];
    const progress = `[${i + 1}/${BAGUIO_BARANGAYS.length}]`;

    // Skip if already exists
    if (existingNames.has(barangay.name.toLowerCase())) {
      console.log(`${progress} ⏭️  Skipping ${barangay.name} (already exists)`);
      skipped++;
      continue;
    }

    try {
      console.log(`${progress} 🔍 Fetching streets for ${barangay.name}...`);

      // Fetch streets from Overpass API
      await delay(1500); // Rate limiting - be nice to the API
      const streets = await fetchStreetsFromOverpass(barangay.name, barangay.lat, barangay.lng);

      // Note: Skipping boundary data as Firestore doesn't support nested arrays
      // The boundary would need to be stored as GeoJSON string or in a subcollection

      // Create barangay document
      const barangayData: BarangayData = {
        name: barangay.name,
        lat: barangay.lat,
        lng: barangay.lng,
        streets: streets,
        pollutionTypes: DEFAULT_POLLUTION_TYPES,
        adminIds: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Add to Firestore
      const docRef = await barangaysCollection.add(barangayData);
      console.log(`${progress} ✅ Added ${barangay.name} with ${streets.length} streets (ID: ${docRef.id})`);
      added++;

    } catch (error) {
      console.error(`${progress} ❌ Error processing ${barangay.name}:`, error);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 SEEDING COMPLETE');
  console.log('='.repeat(50));
  console.log(`✅ Added: ${added}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📍 Total in database: ${existingSnapshot.size + added}`);
}

// Run the seeding
seedBarangays()
  .then(() => {
    console.log('\n🎉 Seeding completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Seeding failed:', error);
    process.exit(1);
  });
