// Common Indian colleges, pre-loaded so suggestions exist even before
// any alumni have registered. This list gets combined with whatever
// colleges are already in the database.

export const commonColleges: string[] = [
  // IITs
  'IIT Madras', 'IIT Delhi', 'IIT Bombay', 'IIT Kanpur', 'IIT Kharagpur',
  'IIT Roorkee', 'IIT Guwahati', 'IIT Hyderabad', 'IIT Indore', 'IIT Mandi',
  'IIT BHU Varanasi', 'IIT Gandhinagar', 'IIT Ropar', 'IIT Patna',
  'IIT Bhubaneswar', 'IIT Jodhpur', 'IIT (ISM) Dhanbad', 'IIT Palakkad',
  'IIT Tirupati', 'IIT Bhilai', 'IIT Goa', 'IIT Jammu', 'IIT Dharwad',

  // NITs
  'NIT Trichy', 'NIT Warangal', 'NIT Surathkal', 'NIT Rourkela',
  'NIT Calicut', 'NIT Durgapur', 'NIT Kurukshetra', 'NIT Allahabad (MNNIT)',
  'NIT Bhopal (MANIT)', 'NIT Nagpur (VNIT)', 'NIT Jaipur (MNIT)',
  'NIT Jamshedpur', 'NIT Silchar', 'NIT Hamirpur', 'NIT Jalandhar',
  'NIT Patna', 'NIT Raipur', 'NIT Agartala', 'NIT Srinagar', 'NIT Surat (SVNIT)',
  'NIT Delhi', 'NIT Goa', 'NIT Manipur', 'NIT Meghalaya', 'NIT Mizoram',
  'NIT Nagaland', 'NIT Puducherry', 'NIT Sikkim', 'NIT Uttarakhand',
  'NIT Andhra Pradesh', 'NIT Arunachal Pradesh',

  // IIITs
  'IIIT Hyderabad', 'IIIT Bangalore', 'IIIT Delhi', 'IIIT Allahabad',
  'IIIT Gwalior', 'IIIT Kancheepuram', 'IIIT Kota', 'IIIT Lucknow',
  'IIIT Nagpur', 'IIIT Pune', 'IIIT Vadodara', 'IIIT Guwahati', 'IIIT Bhopal',

  // IISERs + NISER
  'IISER Pune', 'IISER Kolkata', 'IISER Mohali', 'IISER Bhopal',
  'IISER Thiruvananthapuram', 'IISER Tirupati', 'IISER Berhampur',
  'NISER Bhubaneswar',

  // Well-known private/deemed universities
  'VIT Vellore', 'VIT Chennai', 'VIT Bhopal', 'VIT AP',
  'Amrita Vishwa Vidyapeetham Coimbatore', 'Amrita Vishwa Vidyapeetham Chennai',
  'Amrita Vishwa Vidyapeetham Bengaluru', 'Amrita Vishwa Vidyapeetham Amritapuri',
  'SRM Institute of Science and Technology Chennai', 'SRM Amaravati',
  'Manipal Institute of Technology', 'BITS Pilani', 'BITS Goa', 'BITS Hyderabad',
  'Thapar Institute of Engineering and Technology',
  'PSG College of Technology', 'Anna University',
  'Shiv Nadar University', 'Ashoka University', 'Krea University',
  'FLAME University', 'OP Jindal Global University',

  // Medical
  'AIIMS Delhi', 'AIIMS Rishikesh', 'AIIMS Bhopal', 'AIIMS Jodhpur',
  'AIIMS Patna', 'AIIMS Raipur', 'AIIMS Bhubaneswar', 'CMC Vellore',
  'JIPMER Puducherry', 'Maulana Azad Medical College Delhi',
  'Kasturba Medical College Manipal', 'St. Johns Medical College Bangalore',

  // Law
  'National Law School of India University Bangalore', 'NALSAR Hyderabad',
  'National Law University Delhi', 'Jindal Global Law School',
  'West Bengal National University of Juridical Sciences',

  // Others
  'Delhi University', 'Jawaharlal Nehru University', 'Jadavpur University',
  'University of Hyderabad', 'Christ University Bangalore',
  'Loyola College Chennai', 'St. Stephens College Delhi',
  'Presidency University Kolkata', 'Fergusson College Pune',

  // Tamil Nadu private engineering colleges
  'SSN College of Engineering Chennai', 'Sri Sivasubramaniya Nadar College of Engineering',
  'Thiagarajar College of Engineering Madurai', 'Kumaraguru College of Technology Coimbatore',
  'Coimbatore Institute of Technology', 'PSNA College of Engineering and Technology Dindigul',
  'Mepco Schlenk Engineering College Sivakasi', 'Sri Krishna College of Engineering and Technology Coimbatore',
  'Rajalakshmi Engineering College Chennai', 'Sri Sairam Engineering College Chennai',
  'Panimalar Engineering College Chennai', 'Velammal Engineering College Chennai',
  'Saveetha Engineering College Chennai', 'Easwari Engineering College Chennai',
  'St. Josephs College of Engineering Chennai', 'Hindustan Institute of Technology and Science Chennai',
  'Karunya Institute of Technology and Sciences Coimbatore', 'KPR Institute of Engineering and Technology Coimbatore',
  'Kongu Engineering College Erode', 'Kalasalingam Academy of Research and Education Krishnankoil',
  'Bannari Amman Institute of Technology Sathyamangalam', 'PSG Institute of Technology and Applied Research Coimbatore', 'Sri Eshwar College of Engineering Coimbatore',

  // Tamil Nadu private medical/dental colleges
  'Sri Ramachandra Institute of Higher Education and Research Chennai',
  'SRM Medical College Hospital and Research Centre',
  'Saveetha Medical College Chennai', 'Saveetha Dental College Chennai',
  'Meenakshi Medical College Kanchipuram', 'Chettinad Academy of Research and Education Chennai',
  'Karpaga Vinayaga Institute of Medical Sciences', 'Tagore Medical College Chennai',
  'PSG Institute of Medical Sciences and Research Coimbatore',
  'Vinayaka Missions Kirupananda Variyar Medical College Salem',
  'Rajah Muthiah Medical College Annamalai University',

  // Tamil Nadu arts, science, law and other private institutions
  'Sri Ramakrishna College of Arts and Science Coimbatore',
  'PSGR Krishnammal College for Women Coimbatore',
  'Madras Christian College Chennai', 'Stella Maris College Chennai',
  'Women s Christian College Chennai', 'American College Madurai',
  'Fatima College Madurai', 'Lady Doak College Madurai',
  'Sri Meenakshi Government Arts College for Women Madurai',
  'PSG College of Arts and Science Coimbatore',
  'VIT School of Law Chennai', 'School of Excellence in Law Chennai',
  'Tamil Nadu Dr. Ambedkar Law University Chennai',
  'Vellore Institute of Technology School of Law',
  'Sathyabama Institute of Science and Technology Chennai',
  'B.S. Abdur Rahman Crescent Institute Chennai',
  'Dr. M.G.R. Educational and Research Institute Chennai',
  'Vel Tech Rangarajan Dr. Sagunthala R&D Institute Chennai',
];
