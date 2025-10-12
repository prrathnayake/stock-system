export const APP_NAME = 'Stock Management System';

export const ORGANIZATION_TYPES = [
  { id: 'retail', label: 'Retail & eCommerce', description: 'Customer-facing businesses managing product sales.' },
  { id: 'service', label: 'Service & Repair', description: 'Teams coordinating repairs, field service or maintenance.' },
  { id: 'manufacturing', label: 'Manufacturing', description: 'Production-focused operations handling component inventory.' },
  { id: 'distribution', label: 'Distribution & Wholesale', description: 'Organizations moving goods between warehouses and partners.' },
  { id: 'education', label: 'Education', description: 'Schools, universities or training facilities managing assets.' },
  { id: 'healthcare', label: 'Healthcare', description: 'Clinics, labs and hospitals tracking clinical supplies.' },
  { id: 'nonprofit', label: 'Non-profit', description: 'Mission-driven groups coordinating donated goods.' },
  { id: 'technology', label: 'Technology', description: 'IT, SaaS and hardware teams stocking devices and parts.' },
  { id: 'other', label: 'Other', description: 'Use when none of the categories above apply.' }
];

export const PASSWORD_REQUIREMENTS = 'Use at least 10 characters including uppercase, lowercase, number and symbol characters.';
export const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/;
