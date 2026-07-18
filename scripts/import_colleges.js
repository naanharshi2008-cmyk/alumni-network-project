const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually to get Supabase credentials
const envPath = path.join(__dirname, '..', '.env.local');
let supabaseUrl = '';
let supabaseAnonKey = '';

try {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const matchUrl = line.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+)$/);
      const matchKey = line.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*(.+)$/);
      if (matchUrl) supabaseUrl = matchUrl[1].trim();
      if (matchKey) supabaseAnonKey = matchKey[1].trim();
    }
  }
} catch (e) {
  console.error('Error reading .env.local:', e);
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Could not find Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Seed list of major Indian engineering colleges with state, district, and other details.
const SEED_COLLEGES = [
  // IITs
  { name: 'IIT Madras', state: 'Tamil Nadu', district: 'Chennai', university_name: 'IIT Madras', management_type: 'Government', established_year: 1959, is_engineering: true },
  { name: 'IIT Bombay', state: 'Maharashtra', district: 'Mumbai', university_name: 'IIT Bombay', management_type: 'Government', established_year: 1958, is_engineering: true },
  { name: 'IIT Delhi', state: 'Delhi', district: 'New Delhi', university_name: 'IIT Delhi', management_type: 'Government', established_year: 1961, is_engineering: true },
  { name: 'IIT Kanpur', state: 'Uttar Pradesh', district: 'Kanpur', university_name: 'IIT Kanpur', management_type: 'Government', established_year: 1959, is_engineering: true },
  { name: 'IIT Kharagpur', state: 'West Bengal', district: 'Kharagpur', university_name: 'IIT Kharagpur', management_type: 'Government', established_year: 1951, is_engineering: true },
  { name: 'IIT Roorkee', state: 'Uttarakhand', district: 'Roorkee', university_name: 'IIT Roorkee', management_type: 'Government', established_year: 1847, is_engineering: true },
  { name: 'IIT Hyderabad', state: 'Telangana', district: 'Sangareddy', university_name: 'IIT Hyderabad', management_type: 'Government', established_year: 2008, is_engineering: true },
  { name: 'IIT BHU Varanasi', state: 'Uttar Pradesh', district: 'Varanasi', university_name: 'Banaras Hindu University', management_type: 'Government', established_year: 1919, is_engineering: true },

  // NITs
  { name: 'NIT Trichy', state: 'Tamil Nadu', district: 'Tiruchirappalli', university_name: 'NIT Trichy', management_type: 'Government', established_year: 1964, is_engineering: true },
  { name: 'NIT Surathkal', state: 'Karnataka', district: 'Mangalore', university_name: 'NIT Surathkal', management_type: 'Government', established_year: 1960, is_engineering: true },
  { name: 'NIT Warangal', state: 'Telangana', district: 'Warangal', university_name: 'NIT Warangal', management_type: 'Government', established_year: 1959, is_engineering: true },
  { name: 'NIT Calicut', state: 'Kerala', district: 'Kozhikode', university_name: 'NIT Calicut', management_type: 'Government', established_year: 1961, is_engineering: true },
  { name: 'NIT Rourkela', state: 'Odisha', district: 'Rourkela', university_name: 'NIT Rourkela', management_type: 'Government', established_year: 1961, is_engineering: true },

  // IIITs
  { name: 'IIIT Hyderabad', state: 'Telangana', district: 'Hyderabad', university_name: 'IIIT Hyderabad', management_type: 'Private-PPP', established_year: 1998, is_engineering: true },
  { name: 'IIIT Bangalore', state: 'Karnataka', district: 'Bengaluru', university_name: 'IIIT Bangalore', management_type: 'Private-PPP', established_year: 1999, is_engineering: true },

  // BITS
  { name: 'BITS Pilani', state: 'Rajasthan', district: 'Jhunjhunu', university_name: 'BITS Pilani', management_type: 'Private', established_year: 1964, is_engineering: true },
  { name: 'BITS Goa', state: 'Goa', district: 'South Goa', university_name: 'BITS Pilani', management_type: 'Private', established_year: 2004, is_engineering: true },
  { name: 'BITS Hyderabad', state: 'Telangana', district: 'Hyderabad', university_name: 'BITS Pilani', management_type: 'Private', established_year: 2008, is_engineering: true },

  // Tamil Nadu Engineering Colleges (TNEA/Anna University Affiliated & Deemed)
  { name: 'Anna University (CEG Campus)', state: 'Tamil Nadu', district: 'Chennai', university_name: 'Anna University', management_type: 'Government', established_year: 1794, is_engineering: true },
  { name: 'Anna University (MIT Campus)', state: 'Tamil Nadu', district: 'Chennai', university_name: 'Anna University', management_type: 'Government', established_year: 1949, is_engineering: true },
  { name: 'Anna University (ACT Campus)', state: 'Tamil Nadu', district: 'Chennai', university_name: 'Anna University', management_type: 'Government', established_year: 1944, is_engineering: true },
  { name: 'PSG College of Technology', state: 'Tamil Nadu', district: 'Coimbatore', university_name: 'Anna University', management_type: 'Government-Aided', established_year: 1951, is_engineering: true },
  { name: 'PSG Institute of Technology and Applied Research', state: 'Tamil Nadu', district: 'Coimbatore', university_name: 'Anna University', management_type: 'Private', established_year: 2014, is_engineering: true },
  { name: 'SSN College of Engineering', state: 'Tamil Nadu', district: 'Chennai', university_name: 'Anna University', management_type: 'Private', established_year: 1996, is_engineering: true },
  { name: 'Thiagarajar College of Engineering', state: 'Tamil Nadu', district: 'Madurai', university_name: 'Anna University', management_type: 'Government-Aided', established_year: 1957, is_engineering: true },
  { name: 'Coimbatore Institute of Technology', state: 'Tamil Nadu', district: 'Coimbatore', university_name: 'Anna University', management_type: 'Government-Aided', established_year: 1956, is_engineering: true },
  { name: 'Kumaraguru College of Technology', state: 'Tamil Nadu', district: 'Coimbatore', university_name: 'Anna University', management_type: 'Private', established_year: 1984, is_engineering: true },
  { name: 'VIT Vellore', state: 'Tamil Nadu', district: 'Vellore', university_name: 'Vellore Institute of Technology', management_type: 'Private (Deemed)', established_year: 1984, is_engineering: true },
  { name: 'VIT Chennai', state: 'Tamil Nadu', district: 'Chennai', university_name: 'Vellore Institute of Technology', management_type: 'Private (Deemed)', established_year: 2010, is_engineering: true },
  { name: 'Amrita School of Engineering Coimbatore', state: 'Tamil Nadu', district: 'Coimbatore', university_name: 'Amrita Vishwa Vidyapeetham', management_type: 'Private (Deemed)', established_year: 1994, is_engineering: true },
  { name: 'Sri Krishna College of Engineering and Technology', state: 'Tamil Nadu', district: 'Coimbatore', university_name: 'Anna University', management_type: 'Private', established_year: 1998, is_engineering: true },
  { name: 'Mepco Schlenk Engineering College', state: 'Tamil Nadu', district: 'Sivakasi', university_name: 'Anna University', management_type: 'Private', established_year: 1984, is_engineering: true },
  { name: 'Kearney College (Fake Demo College)', state: 'Tamil Nadu', district: 'Tiruppur', university_name: 'Anna University', management_type: 'Private', established_year: 2018, is_engineering: true }
];

async function seed() {
  console.log(`Seeding ${SEED_COLLEGES.length} colleges into Supabase...`);
  
  for (const college of SEED_COLLEGES) {
    try {
      // Find if already exists
      const { data: existing } = await supabase
        .from('colleges')
        .select('id')
        .ilike('name', college.name)
        .maybeSingle();

      if (existing) {
        // Update existing college with additional details
        const { error: updateErr } = await supabase
          .from('colleges')
          .update({
            state: college.state,
            district: college.district,
            website: college.website || `https://www.google.com/search?q=${encodeURIComponent(college.name)}`,
            university_name: college.university_name,
            management_type: college.management_type,
            established_year: college.established_year,
            is_engineering: college.is_engineering
          })
          .eq('id', existing.id);
        
        if (updateErr) {
          console.error(`Failed to update ${college.name}:`, updateErr.message);
        } else {
          console.log(`Updated details for: ${college.name}`);
        }
      } else {
        // Insert new college
        const { error: insertErr } = await supabase
          .from('colleges')
          .insert({
            name: college.name,
            state: college.state,
            district: college.district,
            website: college.website || `https://www.google.com/search?q=${encodeURIComponent(college.name)}`,
            university_name: college.university_name,
            management_type: college.management_type,
            established_year: college.established_year,
            is_engineering: college.is_engineering,
            status: 'approved'
          });

        if (insertErr) {
          console.error(`Failed to insert ${college.name}:`, insertErr.message);
        } else {
          console.log(`Inserted new college: ${college.name}`);
        }
      }
    } catch (e) {
      console.error(`Error processing ${college.name}:`, e);
    }
  }

  console.log('Seeding completed!');
}

seed();
