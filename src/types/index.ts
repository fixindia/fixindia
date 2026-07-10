export type IssueStatus = 'pending_verification' | 'open' | 'in_progress' | 'resolved' | 'rejected';
export type IssueCategory = 'Pothole' | 'Broken Footpath' | 'Drainage' | 'Streetlight' | 'Other' | string;
export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface NewsArticle {
  id: string;
  source: string;
  title: string;
  url: string;
  date: string;
  snippet?: string;
  isTragic?: boolean; // Flag to indicate severe consequences like accidents
}

export interface Issue {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  category: IssueCategory;
  status: IssueStatus;
  severity: IssueSeverity;
  agency: string;
  ward: string;
  mla: string;
  sanctionedBudget: string;
  upvotes: number;
  verificationCount?: number;
  fixedCount?: number;
  workingCount?: number;
  customCategory?: string;
  isMine?: boolean;
  timestamp: string;
  newsContext?: NewsArticle[];
  zone?: string;
  parliament?: string;
  mp?: string;
  imageUrl?: string;
  sourceUrl?: string;
}

export interface StatusEvent {
  fromStatus?: string;
  toStatus: string;
  note?: string;
  createdAt: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body?: string;
  reportId?: string;
  isRead: boolean;
  createdAt: string;
}

export interface UserStats {
  id: string;
  name: string;
  jobTitle?: string;
  socials?: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
  };
  reportsPublished: number;
  reportsVerified: number;
  integrationsHelped: number;
  civicSenseScore: number;
  rank: number;
}

export interface MlaStats {
  id: string;
  name: string;
  ward: string;
  unresolvedCount: number;
  rank: number;
}

export interface VolunteerProfile {
  id: string;
  clerk_id: string;
  display_name: string;
  job_title?: string;
  socials?: Record<string, string>;
  avatar_url?: string;
  email?: string;
  role?: string;
  home_state?: string;
  home_city?: string;
  home_constituency?: string;
  reports_published?: number;
  reports_verified?: number;
  integrations_helped?: number;
  civic_sense_score?: number;
  created_at?: string;
}

export interface MLA {
  id: number;
  name: string;
  party?: string;
  constituency: string;
  city: string;
  state: string;
  contact?: string;
  email?: string;
  is_incorrect?: boolean;
  latitude?: number | string;
  longitude?: number | string;
}

