// The backend listens on 6969 (see server/ecosystem.config.json). The old
// localhost:4000 default silently broke local dev when VITE_API_URL was unset.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:6969';

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// For mutating calls: a non-2xx response returns a JSON error body (e.g. 401
// "Authentication required", 409 "Already upvoted", 500 "Submission failed").
// res.json() resolves fine on those, so without this guard callers treat a
// rejected write as success and silently drop the user's data. Throwing here
// makes each caller's existing try/catch fire and surface the real failure.
async function handleResponse(res: Response) {
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* non-JSON body; keep statusText */ }
    throw new Error(message);
  }
  return res.json();
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
      return handleResponse(res);
    }

    const res = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify(report),
    });
    return handleResponse(res);
  },

  async upvoteReport(reportId: string, userId: string, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}/upvote`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ userId }),
    });
    return handleResponse(res);
  },

  async verifyReport(reportId: string, userId: string, isValid: boolean, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}/verify`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ userId, isValid }),
    });
    return handleResponse(res);
  },

  // Resolution lifecycle: vote 'working' (work has started) or 'fixed' (resolved).
  // Server applies consensus (2 working → in_progress, 3 fixed → resolved).
  async resolveReport(reportId: string, vote: 'working' | 'fixed', token?: string | null) {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}/resolve`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ vote }),
    });
    return handleResponse(res);
  },

  // Draft a formal complaint/escalation for a report (AI or template).
  async getComplaint(reportId: string, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}/complaint`, {
      method: 'POST',
      headers: authHeaders(token || null),
    });
    return handleResponse(res);
  },

  // AI photo analysis — suggest category + severity from an image. Returns
  // { suggestion: null } (not an error) when no vision model is configured.
  async analyzeReportImage(image: File, token?: string | null) {
    const form = new FormData();
    form.append('image', image);
    const res = await fetch(`${API_BASE}/api/reports/analyze-image`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    return handleResponse(res);
  },

  // Duplicate detection — nearby open/in-progress reports (spatial).
  async getNearbyReports(lat: number, lng: number, category?: string, radius = 75) {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(radius) });
    if (category) params.set('category', category);
    const res = await fetch(`${API_BASE}/api/reports/nearby?${params}`);
    const data = await res.json();
    return data.nearby || [];
  },

  // In-app notifications (Track 4).
  async getNotifications(token?: string | null) {
    const res = await fetch(`${API_BASE}/api/notifications`, { headers: authHeaders(token || null) });
    return handleResponse(res); // { unread, notifications }
  },

  async markNotificationsRead(ids?: number[], token?: string | null) {
    const res = await fetch(`${API_BASE}/api/notifications/read`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify(ids && ids.length ? { ids } : {}),
    });
    return handleResponse(res);
  },

  // The signed-in user's own reports, with status timeline (Track 4).
  async getMyReports(token?: string | null) {
    const res = await fetch(`${API_BASE}/api/reports/mine`, { headers: authHeaders(token || null) });
    const data = await handleResponse(res) as { reports?: unknown[] };
    return data.reports || [];
  },

  // Area civic-health metrics for the Liveability dashboard (Track 4).
  async getCivicHealth() {
    const res = await fetch(`${API_BASE}/api/civic-health`);
    return handleResponse(res); // { summary, best, worst }
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
    return handleResponse(res);
  },

  async getUserByClerkId(clerkId: string, token?: string | null) {
    // This endpoint requires authentication server-side; always send the token.
    const res = await fetch(`${API_BASE}/api/users/clerk/${encodeURIComponent(clerkId)}`, {
      headers: authHeaders(token || null),
    });
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
    return handleResponse(res);
  },

  async flagMLA(mlaId: number, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/mlas/${mlaId}/flag`, {
      method: 'POST',
      headers: authHeaders(token || null),
    });
    return handleResponse(res);
  },

  async flagMLAByName(name: string, constituency?: string, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/mlas/flag-by-name`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ name, constituency }),
    });
    return handleResponse(res);
  },

  async getMLAs() {
    const res = await fetch(`${API_BASE}/api/mlas`);
    const data = await res.json();
    return data.mlas || [];
  },

  async getVolunteersByConstituency(constituency: string, token?: string | null) {
    // Requires authentication server-side; always send the token.
    const res = await fetch(
      `${API_BASE}/api/users/volunteers/constituency/${encodeURIComponent(constituency)}`,
      { headers: authHeaders(token || null) },
    );
    const data = await res.json();
    return data.volunteers || [];
  },

  async submitVolunteerData(type: string, data: Record<string, unknown>, submittedBy: string, submitterEmail?: string | null, token?: string | null) {
    const res = await fetch(`${API_BASE}/api/volunteer/submit`, {
      method: 'POST',
      headers: authHeaders(token || null),
      body: JSON.stringify({ type, data, submittedBy, submitterEmail }),
    });
    return handleResponse(res);
  },

  // NOTE: The legacy UUID-based createUser/updateUser methods were removed along
  // with their server routes (they allowed IDOR). Profile access now goes through
  // syncClerkUser / getUserByClerkId / updateUserByClerkId.

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
    return handleResponse(res);
  },
};
