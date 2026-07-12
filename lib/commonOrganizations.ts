// Common employers / institutes, pre-loaded so the "Currently at" field can
// suggest options even before any alumni have registered. Combined at runtime
// with whatever organisations already exist in the database.

export const commonOrganizations: string[] = [
  // Indian IT services
  'TCS', 'Infosys', 'Wipro', 'HCLTech', 'Tech Mahindra', 'Cognizant', 'Accenture',
  'Capgemini', 'LTIMindtree', 'Zoho', 'Freshworks',
  // Product / global tech
  'Google', 'Microsoft', 'Amazon', 'Meta', 'Apple', 'Adobe', 'Nvidia', 'Salesforce',
  'Uber', 'Flipkart', 'Swiggy', 'Zomato', 'PhonePe', 'Razorpay', 'CRED', 'Paytm',
  // Consulting / finance
  'Deloitte', 'PwC', 'EY', 'KPMG', 'McKinsey & Company', 'BCG', 'Bain & Company',
  'Goldman Sachs', 'JPMorgan Chase', 'Morgan Stanley',
  // Core / R&D
  'ISRO', 'DRDO', 'BHEL', 'L&T', 'Tata Motors', 'Mahindra', 'Qualcomm', 'Texas Instruments',
  // Healthcare
  'Apollo Hospitals', 'Fortis Healthcare', 'AIIMS', 'CMC Vellore',
  // Higher study / research
  'Pursuing Masters', 'Pursuing MBA', 'Pursuing PhD', 'Preparing for UPSC',
  'Preparing for GATE', 'Own Startup',
];
