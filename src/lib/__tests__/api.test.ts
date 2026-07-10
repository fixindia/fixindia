import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../api';

// Mock global fetch so no network is required.
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('getReports hits GET /api/reports and returns issues', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ issues: [{ id: 'a' }] }));
    const out = await api.getReports();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/reports');
    expect(init?.method).toBeUndefined(); // GET by default
    expect(out).toEqual([{ id: 'a' }]);
  });

  it('getMapContext builds the right query string', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ issues: [] }));
    await api.getMapContext({ west: 1, south: 2, east: 3, north: 4 });
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/map/context?');
    expect(url).toContain('west=1');
    expect(url).toContain('north=4');
  });

  it('submitReport (no image) sends JSON POST with Authorization header when token given', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.submitReport(
      { title: 'Pothole', category: 'Pothole', latitude: 12.9, longitude: 77.5 },
      'tok-123',
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/reports');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok-123');
    expect(init?.headers?.['Content-Type']).toBe('application/json');
  });

  it('submitReport with image uses FormData and omits Content-Type (browser sets boundary)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await api.submitReport(
      { title: 'Pothole', category: 'Pothole', latitude: 12.9, longitude: 77.5, image: file },
      'tok-abc',
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/reports');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok-abc');
    // When uploading a file we must NOT pin Content-Type so the browser sets the
    // multipart boundary itself.
    expect(init?.headers?.['Content-Type']).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('upvoteReport sends POST with body and auth header', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.upvoteReport('r-1', 'user_x', 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/reports/r-1/upvote');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('verifyReport sends POST with isValid in the body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.verifyReport('r-1', 'user_x', true, 'tok');
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body)).toMatchObject({ isValid: true });
  });

  it('getCitizenLeaderboard hits GET /api/leaderboard/citizens', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ citizens: [{ id: 'u' }] }));
    const out = await api.getCitizenLeaderboard();
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:6969/api/leaderboard/citizens');
    expect(out).toEqual([{ id: 'u' }]);
  });

  it('getShameLeaderboard hits GET /api/leaderboard/shame', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ mlas: [{ id: 1 }] }));
    const out = await api.getShameLeaderboard();
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:6969/api/leaderboard/shame');
    expect(out).toEqual([{ id: 1 }]);
  });

  it('getTrendingNews hits GET /api/news/trending', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ news: [{ id: 'n' }] }));
    const out = await api.getTrendingNews();
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:6969/api/news/trending');
    expect(out).toEqual([{ id: 'n' }]);
  });

  it('syncClerkUser sends POST /api/users/sync with auth header', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.syncClerkUser({ clerkId: 'user_x', displayName: 'A' }, 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/users/sync');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('getUserByClerkId always sends the token (endpoint requires auth)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ user: { id: 'u' } }));
    await api.getUserByClerkId('user_x', 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/users/clerk/user_x');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('updateUserByClerkId sends PUT with auth header', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.updateUserByClerkId('user_x', { jobTitle: 'Eng' }, 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/users/clerk/user_x');
    expect(init?.method).toBe('PUT');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('flagMLA sends POST with no body and auth header', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.flagMLA(5, 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/mlas/5/flag');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('flagMLAByName sends POST with name+constituency JSON body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.flagMLAByName('John', 'Central', 'tok');
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body)).toMatchObject({ name: 'John', constituency: 'Central' });
  });

  it('getMLAs hits GET /api/mlas', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ mlas: [{ id: 1 }] }));
    const out = await api.getMLAs();
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:6969/api/mlas');
    expect(out).toEqual([{ id: 1 }]);
  });

  it('getVolunteersByConstituency encodes the constituency and sends token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ volunteers: [] }));
    await api.getVolunteersByConstituency('Central/Ward', 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/users/volunteers/constituency/Central%2FWard');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('submitVolunteerData sends POST /api/volunteer/submit with auth', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true, submissionId: 's' }));
    await api.submitVolunteerData('report', { title: 'x' }, 'user_x', null, 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/volunteer/submit');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('getVolunteerPending sends token header', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ submissions: [] }));
    await api.getVolunteerPending('tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/volunteer/pending');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('verifyVolunteerSubmission sends POST with verifierId + approved', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    await api.verifyVolunteerSubmission('sub-1', true, 'user_x', 'notes', 'tok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:6969/api/volunteer/verify/sub-1');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body)).toMatchObject({ verifierId: 'user_x', approved: true });
  });
});
