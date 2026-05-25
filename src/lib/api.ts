const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export const api = {
  async getReports() {
    const res = await fetch(`${API_BASE}/api/reports`);
    const data = await res.json();
    return data.issues || [];
  },

  async getMapContext(bounds: { west: number; south: number; east: number; north: number }) {
    const params = new URLSearchParams({
      west: bounds.west.toString(),
      south: bounds.south.toString(),
      east: bounds.east.toString(),
      north: bounds.north.toString(),
    });
    const res = await fetch(`${API_BASE}/api/map/context?${params}`);
    const data = await res.json();
    return data.issues || [];
  },

  async submitReport(report: {
    title: string;
    category: string;
    customCategory?: string;
    latitude: number;
    longitude: number;
    severity?: string;
    creatorId?: string;
    image?: File;
  }, token?: string | null) {
    if (report.image) {
      const formData = new FormData();
      formData.append('title', report.title);
      formData.append('category', report.category);
      if (report.customCategory) formData.append('customCategory', report.customCategory);
      formData.append('latitude', report.latitude.toString());
      formData.append('longitude', report.longitude.toString());
      if (report.severity) formData.append('severity', report.severity);
      if (report.creatorId) formData.append('creatorId', report.creatorId);
      formData.append('image', report.image);

      const res = await fetch(`${API_BASE}/api/reports`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });
      return res.json();
    }

    const res = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify(report),
    });
    return res.json();
  },

  async upvoteReport(reportId: string, userId: string, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}/upvote`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ userId }),
    });
    return res.json();
  },

  async verifyReport(reportId: string, userId: string, isValid: boolean, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}/verify`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ userId, isValid }),
    });
    return res.json();
  },

  async getCitizenLeaderboard() {
    const res = await fetch(`${API_BASE}/api/leaderboard/citizens`);
    const data = await res.json();
    return data.citizens || [];
  },

  async getShameLeaderboard() {
    const res = await fetch(`${API_BASE}/api/leaderboard/shame`);
    const data = await res.json();
    return data.mlas || [];
  },

  async getTrendingNews() {
    const res = await fetch(`${API_BASE}/api/news/trending`);
    const data = await res.json();
    return data.news || [];
  },

  // ─── Clerk User Sync ────────────────────────
  async syncClerkUser(profile: {
    clerkId: string;
    displayName: string;
    avatarUrl?: string;
    email?: string;
  }, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/users/sync`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify(profile),
    });
    return res.json();
  },

  async getUserByClerkId(clerkId: string) {
    const res = await fetch(`${API_BASE}/api/users/clerk/${clerkId}`);
    return res.json();
  },

  async updateUserByClerkId(clerkId: string, profile: {
    jobTitle?: string;
    socials?: Record<string, string>;
    homeConstituency?: string;
    homeCity?: string;
    homeState?: string;
  }, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/users/clerk/${clerkId}`, {
      method: 'PUT',
      headers: authHeaders(token || null),
      body: JSON.stringify(profile),
    });
    return res.json();
  },

  async flagMLA(mlaId: number, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/mlas/${mlaId}/flag`, {
      method: 'POST',
      headers: authHeaders(token || null),
    });
    return res.json();
  },

  async flagMLAByName(name: string, constituency?: string, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/mlas/flag-by-name`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ name, constituency }),
    });
    return res.json();
  },

  async getMLAs() {
    const res = await fetch(`${API_BASE}/api/mlas`);
    const data = await res.json();
    return data.mlas || [];
  },

  async getVolunteersByConstituency(constituency: string) {
    const res = await fetch(`${API_BASE}/api/users/volunteers/constituency/${constituency}`);
    const data = await res.json();
    return data.volunteers || [];
  },

  async submitVolunteerData(type: string, data: Record<string, unknown>, submittedBy: string, submitterEmail?: string | null, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/volunteer/submit`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ type, data, submittedBy, submitterEmail }),
    });
    return res.json();
  },

  async createUser(profile: { displayName?: string; jobTitle?: string; socials?: Record<string, string> }, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify(profile),
    });
    return res.json();
  },

  async updateUser(userId: string, profile: { displayName?: string; jobTitle?: string; socials?: Record<string, string>; avatarUrl?: string }, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/users/${userId}`, {
      method: 'PUT',
      headers: authHeaders(token || null),
      body: JSON.stringify(profile),
    });
    return res.json();
  },

  // ─── Volunteer System ────────────────────────
  async getVolunteerPending(token?: string | null) {
    const res = await fetch(`${API_BASE}/api/volunteer/pending`, {
      headers: authHeaders(token || null),
    });
    const data = await res.json();
    return data.submissions || [];
  },

  async verifyVolunteerSubmission(id: string, approved: boolean, verifierId: string, notes?: string, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/volunteer/verify/${id}`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ verifierId, approved, notes }),
    });
    return res.json();
  },
};
