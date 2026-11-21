import { isoDaysFromNow } from './rng';
import type { Patient } from './types';

/**
 * PHASE 12 MOCK DATA — the five canonical demo patients.
 * Every module (records, labs, pharmacy, appointments, notifications,
 * dashboard) reuses exactly these people so the demo reads as one
 * coherent practice instead of hundreds of generated strangers. Dates
 * are relative to "now" so today-driven cards stay populated. The
 * `Patient` shape still mirrors the future list DTO, so API integration
 * swaps the data source without touching any component.
 */

export const FEMALE_NAMES: readonly string[] = ['Amira', 'Layla', 'Mona', 'Salma', 'Nour'];

export const MALE_NAMES: readonly string[] = ['Omar', 'Khaled', 'Ahmed', 'Youssef', 'Karim'];

/** The signed-in doctor first; four colleagues for filters and handovers. */
export const DOCTORS: readonly string[] = [
  'Dr. Amelia Chen',
  'Dr. Omar Khalil',
  'Dr. Salma Ibrahim',
  'Dr. Youssef Nabil',
  'Dr. Amira Hassan',
];

export const MOCK_PATIENTS: readonly Patient[] = [
  {
    id: 'PT-1001',
    mrn: '4411-27',
    name: 'Khaled Nassar',
    dateOfBirth: '1974-03-18',
    age: 52,
    gender: 'male',
    bloodType: 'O+',
    phone: '+20 100 214 3387',
    photoUrl: null,
    lastVisit: isoDaysFromNow(0, 9, 0),
    nextAppointment: isoDaysFromNow(0, 15, 0),
    assignedDoctor: 'Dr. Amelia Chen',
    status: 'follow-up',
    riskLevel: 'medium',
    chronicConditions: ['Hypertension', 'Type 2 diabetes'],
    allergies: [],
    hasSevereAllergy: false,
    registeredAt: isoDaysFromNow(-730, 12, 0),
  },
  {
    id: 'PT-1002',
    mrn: '4436-58',
    name: 'Mona Adel',
    dateOfBirth: '1997-08-04',
    age: 29,
    gender: 'female',
    bloodType: 'A+',
    phone: '+20 111 830 2245',
    photoUrl: null,
    lastVisit: isoDaysFromNow(0, 9, 45),
    nextAppointment: null,
    assignedDoctor: 'Dr. Amelia Chen',
    status: 'active',
    riskLevel: 'low',
    chronicConditions: ['Asthma'],
    allergies: ['Penicillin'],
    hasSevereAllergy: true,
    registeredAt: isoDaysFromNow(-9, 12, 0),
  },
  {
    id: 'PT-1003',
    mrn: '4468-12',
    name: 'Amira Saleh',
    dateOfBirth: '1992-01-27',
    age: 34,
    gender: 'female',
    bloodType: 'B+',
    phone: '+20 122 574 9911',
    photoUrl: null,
    lastVisit: isoDaysFromNow(-14, 10, 30),
    nextAppointment: isoDaysFromNow(0, 10, 30),
    assignedDoctor: 'Dr. Amelia Chen',
    status: 'under-treatment',
    riskLevel: 'medium',
    chronicConditions: ['Hypothyroidism'],
    allergies: [],
    hasSevereAllergy: false,
    registeredAt: isoDaysFromNow(-365, 12, 0),
  },
  {
    id: 'PT-1004',
    mrn: '4472-90',
    name: 'Omar Farouk',
    dateOfBirth: '1965-11-09',
    age: 61,
    gender: 'male',
    bloodType: 'AB+',
    phone: '+20 101 662 7408',
    photoUrl: null,
    lastVisit: isoDaysFromNow(-2, 11, 15),
    nextAppointment: isoDaysFromNow(0, 11, 15),
    assignedDoctor: 'Dr. Amelia Chen',
    status: 'critical',
    riskLevel: 'critical',
    chronicConditions: ['Chronic kidney disease', 'Hypertension', 'Type 2 diabetes'],
    allergies: ['Iodine contrast'],
    hasSevereAllergy: true,
    registeredAt: isoDaysFromNow(-1095, 12, 0),
  },
  {
    id: 'PT-1005',
    mrn: '4485-33',
    name: 'Layla Mansour',
    dateOfBirth: '1981-06-21',
    age: 45,
    gender: 'female',
    bloodType: 'O-',
    phone: '+20 112 447 5620',
    photoUrl: null,
    lastVisit: isoDaysFromNow(-60, 13, 0),
    nextAppointment: isoDaysFromNow(0, 13, 0),
    assignedDoctor: 'Dr. Omar Khalil',
    status: 'active',
    riskLevel: 'high',
    chronicConditions: ['Coronary artery disease'],
    allergies: ['Sulfa drugs'],
    hasSevereAllergy: false,
    registeredAt: isoDaysFromNow(-540, 12, 0),
  },
];
