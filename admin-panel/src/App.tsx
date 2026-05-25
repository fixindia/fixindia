/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment, react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Cpu, 
  CheckSquare, 
  Database, 
  Play, 
  RefreshCw, 
  AlertTriangle, 
  Shield, 
  HardDrive, 
  Terminal, 
  Settings, 
  Check, 
  X, 
  FileText,
  User,
  Plus,
  Trash2,
  Edit2
} from 'lucide-react';


// Setup API URL dynamically: defaults to production, fallback to localhost in dev
const DEFAULT_API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:6970'
  : 'https://cr.enjoyxd.eu.org';

interface AIModel {
  id: number;
  name: string;
  provider: string;
  model_string: string;
  api_key: string | null;
  api_key_env_var: string;
  api_endpoint: string | null;
  priority: number;
  is_enabled: boolean;
  is_free: boolean;
}

interface ScraperRun {
  id: number;
  scraper_type: string;
  status: 'running' | 'success' | 'failed';
  items_processed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface VolunteerSubmission {
  id: string;
  data_type: 'report' | 'news' | 'mla';
  raw_data: any;
  submitted_by: string;
  submitter_email: string | null;
  verification_count: number;
  required_verifications: number;
  created_at: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ai-models' | 'volunteer' | 'scrapers' | 'sql'>('dashboard');
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('admin_api_url') || DEFAULT_API_URL);
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('admin_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  
  // Dashboard Metrics state
  const [metrics, setMetrics] = useState<any>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  
  // AI Models state
  const [models, setModels] = useState<AIModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [editingModel, setEditingModel] = useState<Partial<AIModel> | null>(null);
  
  // Volunteer state
  const [submissions, setSubmissions] = useState<VolunteerSubmission[]>([]);
  const [volunteersLoading, setVolunteersLoading] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<VolunteerSubmission | null>(null);
  const [modulatingId, setModulatingId] = useState<string | null>(null);
  
  // Scrapers state
  const [scraperRuns, setScraperRuns] = useState<ScraperRun[]>([]);
  const [scrapersLoading, setScrapersLoading] = useState(false);
  const [triggeringScraper, setTriggeringScraper] = useState<string | null>(null);
  
  // SQL Shell state
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM reports LIMIT 5;');
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // PM2 Process Status state
  const [pm2Processes, setPm2Processes] = useState<any[]>([]);
  const [pm2Loading, setPm2Loading] = useState(false);
  const [activePopover, setActivePopover] = useState<number | null>(null);

  // Common Headers configuration
  const getHeaders = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (adminKey) {
      headers['X-Admin-Key'] = adminKey;
    }
    return headers;
  };

  // Test connection and fetch initial stats
  const testConnection = async () => {
    setIsConnected(null);
    try {
      const res = await fetch(`${apiUrl}/health`);
      if (res.ok) {
        setIsConnected(true);
        return true;
      }
      setIsConnected(false);
      return false;
    } catch {
      setIsConnected(false);
      return false;
    }
  };

  const fetchMetrics = async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/metrics`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (e) {
      console.error('Failed to fetch metrics:', e);
    } finally {
      setMetricsLoading(false);
    }
  };

  const fetchAIModels = async () => {
    setModelsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/ai-models`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setModels(data.models);
      }
    } catch (e) {
      console.error('Failed to fetch AI models:', e);
    } finally {
      setModelsLoading(false);
    }
  };

  const fetchVolunteerSubmissions = async () => {
    setVolunteersLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/volunteer/pending`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSubmissions(data.submissions);
      }
    } catch (e) {
      console.error('Failed to fetch volunteer submissions:', e);
    } finally {
      setVolunteersLoading(false);
    }
  };

  const fetchScraperRuns = async () => {
    setScrapersLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/scrapers`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setScraperRuns(data.runs);
      }
    } catch (e) {
      console.error('Failed to fetch scraper runs:', e);
    } finally {
      setScrapersLoading(false);
    }
  };

  const fetchPM2Processes = async () => {
    setPm2Loading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/pm2/list`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPm2Processes(data.processes || []);
      }
    } catch (e) {
      console.error('Failed to fetch PM2 processes:', e);
    } finally {
      setPm2Loading(false);
    }
  };

  const handlePM2Action = async (name: string, action: string) => {
    if (!confirm(`Are you sure you want to ${action} process '${name}'?`)) return;
    try {
      const res = await fetch(`${apiUrl}/api/admin/pm2/action/${action}/${name}`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.message);
        fetchPM2Processes();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error || 'Action failed'}`);
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`);
    }
  };

  useEffect(() => {
    testConnection().then(ok => {
      if (ok) {
        fetchMetrics();
        fetchPM2Processes();
      }
    });
  }, [apiUrl, adminKey]);

  useEffect(() => {
    if (isConnected) {
      if (activeTab === 'dashboard') {
        fetchMetrics();
        fetchPM2Processes();
      }
      if (activeTab === 'ai-models') fetchAIModels();
      if (activeTab === 'volunteer') fetchVolunteerSubmissions();
      if (activeTab === 'scrapers') fetchScraperRuns();
    }
  }, [activeTab, isConnected]);

  // Save Settings handler
  const handleSaveSettings = () => {
    localStorage.setItem('admin_api_url', apiUrl);
    localStorage.setItem('admin_key', adminKey);
    setShowSettings(false);
    testConnection();
  };

  // AI Config handlers
  const handleSaveModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingModel) return;

    const url = editingModel.id 
      ? `${apiUrl}/api/admin/ai-models/${editingModel.id}` 
      : `${apiUrl}/api/admin/ai-models`;
    
    const method = editingModel.id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: getHeaders(),
        body: JSON.stringify({
          name: editingModel.name,
          provider: editingModel.provider,
          modelString: editingModel.model_string,
          apiKey: editingModel.api_key || null,
          apiKeyEnvVar: editingModel.api_key_env_var,
          apiEndpoint: editingModel.api_endpoint || null,
          priority: Number(editingModel.priority || 1),
          isEnabled: editingModel.is_enabled !== false,
          isFree: editingModel.is_free !== false,
        })
      });

      if (res.ok) {
        setEditingModel(null);
        fetchAIModels();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error || 'Failed to save model'}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    }
  };

  const handleDeleteModel = async (id: number) => {
    if (!confirm('Are you sure you want to delete this AI Model configuration?')) return;

    try {
      const res = await fetch(`${apiUrl}/api/admin/ai-models/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });

      if (res.ok) {
        fetchAIModels();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Volunteer Queue actions
  const handleVerifySubmission = async (id: string, action: 'approve' | 'reject') => {
    setModulatingId(id);
    try {
      const res = await fetch(`${apiUrl}/api/admin/volunteer/${action}/${id}`, {
        method: 'POST',
        headers: getHeaders(),
      });

      if (res.ok) {
        setSubmissions(prev => prev.filter(s => s.id !== id));
        setSelectedSubmission(null);
        fetchMetrics();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error || 'Failed to moderate submission'}`);
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`);
    } finally {
      setModulatingId(null);
    }
  };

  // Scraper Manual Trigger
  const handleTriggerScraper = async (type: string) => {
    setTriggeringScraper(type);
    try {
      const res = await fetch(`${apiUrl}/api/admin/scrapers/run/${type}`, {
        method: 'POST',
        headers: getHeaders(),
      });

      if (res.ok) {
        alert(`Manual run for scraper '${type}' has been queued successfully.`);
        // Refresh runs list after short delay
        setTimeout(fetchScraperRuns, 1000);
      } else {
        const data = await res.json();
        alert(`Error: ${data.error || 'Failed to start scraper'}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    } finally {
      setTriggeringScraper(null);
    }
  };

  // SQL shell runner
  const handleRunSQL = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sqlQuery.trim()) return;

    setSqlLoading(true);
    setSqlError(null);
    setSqlResult(null);

    try {
      const res = await fetch(`${apiUrl}/api/admin/db/query`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ query: sqlQuery }),
      });

      const data = await res.json();
      if (res.ok) {
        setSqlResult(data);
      } else {
        setSqlError(data.error || 'Unknown error occurred running query');
      }
    } catch (err: any) {
      setSqlError(`Network error: ${err.message}`);
    } finally {
      setSqlLoading(false);
    }
  };

  // Export SQL rows to CSV
  const handleExportCSV = () => {
    if (!sqlResult || !sqlResult.rows || sqlResult.rows.length === 0) return;

    const rows = sqlResult.rows;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row: any) => 
        headers.map(fieldName => {
          const val = row[fieldName];
          const valStr = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
          // Escape quotes
          return `"${valStr.replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `fixindia_query_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b0f19] text-[#f3f4f6]">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-[#0f172a] border-r border-[#1e293b] flex flex-col justify-between">
        <div>
          {/* Logo */}
          <div className="p-6 border-b border-[#1e293b] flex items-center space-x-3">
            <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center text-slate-900 font-bold shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              FI
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">FixIndia Admin</h1>
              <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Enterprise Console</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard size={18} />
              <span>Metrics Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('ai-models')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'ai-models'
                  ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <Cpu size={18} />
              <span>AI Model Config</span>
            </button>

            <button
              onClick={() => setActiveTab('volunteer')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'volunteer'
                  ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <CheckSquare size={18} />
                {metrics?.counts?.pendingVerifications > 0 && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full"></span>
                )}
              </div>
              <span className="flex-1 text-left">Volunteer Queue</span>
              {metrics?.counts?.pendingVerifications > 0 && (
                <span className="bg-rose-500/10 text-rose-400 text-xs px-2 py-0.5 rounded-full font-bold">
                  {metrics.counts.pendingVerifications}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('scrapers')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'scrapers'
                  ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <RefreshCw size={18} />
              <span>Scrapers Panel</span>
            </button>

            <button
              onClick={() => setActiveTab('sql')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'sql'
                  ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <Database size={18} />
              <span>Database SQL Shell</span>
            </button>
          </nav>
        </div>

        {/* Footer Settings & Status */}
        <div className="p-4 border-t border-[#1e293b]">
          <div className="glass p-3 rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">API Connection:</span>
              {isConnected === null ? (
                <span className="text-amber-400 flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></span>
                  <span>Checking</span>
                </span>
              ) : isConnected ? (
                <span className="text-emerald-400 flex items-center space-x-1 font-semibold">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
                  <span>Secure</span>
                </span>
              ) : (
                <span className="text-rose-400 flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 bg-rose-400 rounded-full"></span>
                  <span>Offline</span>
                </span>
              )}
            </div>
            
            {metrics?.adminEmail && (
              <div className="flex items-center space-x-1.5 text-slate-400 truncate">
                <User size={12} className="text-emerald-400 flex-shrink-0" />
                <span className="truncate" title={metrics.adminEmail}>{metrics.adminEmail}</span>
              </div>
            )}

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-full flex items-center justify-center space-x-2 py-1.5 bg-slate-800/50 hover:bg-slate-800 text-slate-300 rounded-lg transition-colors border border-[#334155]"
            >
              <Settings size={12} />
              <span>Connection Settings</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#070a13]">
        {/* Top Header */}
        <header className="h-16 border-b border-[#1e293b] flex items-center justify-between px-8 bg-[#0f172a]">
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-bold text-white capitalize">
              {activeTab.replace('-', ' ')}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            <div className="bg-[#1e293b] px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-300 flex items-center space-x-2 border border-[#334155]">
              <Shield size={12} className="text-emerald-400" />
              <span>Cloudflare Access Mode</span>
            </div>
          </div>
        </header>

        {/* Dynamic Pages */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Settings Modal (Overlay) */}
          {showSettings && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="glass max-w-md w-full p-6 rounded-2xl border border-[#334155] shadow-2xl">
                <h3 className="text-lg font-bold text-white mb-4">Connection Configurations</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Admin API Endpoint</label>
                    <input
                      type="text"
                      value={apiUrl}
                      onChange={e => setApiUrl(e.target.value)}
                      className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Admin Security Token (Dev Fallback)</label>
                    <input
                      type="password"
                      value={adminKey}
                      onChange={e => setAdminKey(e.target.value)}
                      placeholder="e.g. your-hex-admin-key"
                      className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/20">
                    <span>Active endpoint will save to your browser's LocalStorage.</span>
                  </div>
                  <div className="flex space-x-3 pt-2">
                    <button
                      onClick={() => setShowSettings(false)}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveSettings}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-2 rounded-lg text-sm transition-all"
                    >
                      Save Configuration
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PAGE: Dashboard */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              {metricsLoading ? (
                <div className="flex items-center justify-center py-20 text-slate-400 space-x-2">
                  <RefreshCw size={20} className="animate-spin" />
                  <span>Loading dashboard statistics...</span>
                </div>
              ) : metrics ? (
                <>
                  {/* Stats Cards Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="glass p-6 rounded-2xl">
                      <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Registered Citizens</span>
                      <div className="mt-2 text-3xl font-extrabold text-white">{metrics.counts.users}</div>
                      <div className="mt-1 text-xs text-emerald-400 font-medium">Auto-synced via Clerk Auth</div>
                    </div>
                    
                    <div className="glass p-6 rounded-2xl">
                      <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Total Reports Submitted</span>
                      <div className="mt-2 text-3xl font-extrabold text-white">{metrics.counts.reports}</div>
                      <div className="mt-1 text-xs text-slate-400 flex items-center space-x-2">
                        <span className="text-emerald-400 font-semibold">{metrics.reportStatusBreakdown?.open || 0} active</span>
                        <span>•</span>
                        <span className="text-rose-400 font-semibold">{metrics.reportStatusBreakdown?.pending_verification || 0} pending</span>
                      </div>
                    </div>

                    <div className="glass p-6 rounded-2xl">
                      <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Scraped Civic News</span>
                      <div className="mt-2 text-3xl font-extrabold text-white">{metrics.counts.news}</div>
                      <div className="mt-1 text-xs text-emerald-400 font-medium">Confidence threshold &ge; 40</div>
                    </div>

                    <div className="glass p-6 rounded-2xl border border-rose-500/20">
                      <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Flagged MLAs</span>
                      <div className="mt-2 text-3xl font-extrabold text-rose-400">{metrics.counts.flaggedMlas} / {metrics.counts.mlas}</div>
                      <div className="mt-1 text-xs text-slate-400">Constituency detail error reports</div>
                    </div>
                  </div>

                  {/* PM2 PPS Application Set Status Monitor */}
                  <div className="glass p-6 rounded-2xl">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="font-bold text-white flex items-center space-x-2">
                        <Shield size={18} className="text-emerald-400" />
                        <span>PPS Monitor (PM2 Process Status)</span>
                      </h3>
                      <button
                        onClick={fetchPM2Processes}
                        type="button"
                        className="p-1 hover:bg-slate-800 text-slate-400 rounded transition-colors"
                      >
                        <RefreshCw size={14} className={pm2Loading ? 'animate-spin' : ''} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {pm2Processes.map((proc, index) => (
                        <div 
                          key={proc.name} 
                          className="relative bg-[#0b0f19] border border-[#1e293b] p-5 rounded-xl flex items-center justify-between"
                        >
                          <div className="flex items-center space-x-4">
                            <div className="relative">
                              <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center text-slate-300">
                                <Terminal size={18} />
                              </div>
                              <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0b0f19] ${
                                proc.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                              }`}></span>
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-white">{proc.name}</h4>
                              <div className="text-[10px] text-slate-400 flex items-center space-x-1.5 mt-0.5">
                                <span>PID: {proc.pm_id}</span>
                                <span>•</span>
                                <span className={proc.status === 'online' ? 'text-emerald-400 font-semibold' : 'text-rose-400'}>
                                  {proc.status}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <button
                              id={`pm2-trigger-${index}`}
                              type="button"
                              onClick={() => setActivePopover(activePopover === index ? null : index)}
                              className={`anchor-trigger-${index} px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                activePopover === index
                                  ? 'bg-emerald-500 text-slate-900 border-emerald-500'
                                  : 'bg-slate-800 text-slate-300 border-[#334155] hover:bg-slate-700'
                              }`}
                              style={{
                                // @ts-ignore
                                'anchorName': `--anchor-${index}`,
                                // @ts-ignore
                                '--anchor-name': `--anchor-${index}`
                              } as React.CSSProperties}
                            >
                              {activePopover === index ? 'Close Details' : 'View Snapshot'}
                            </button>
                            
                            {activePopover === index && (
                              <div 
                                className={`anchor-popover-${index} absolute z-55 w-72 p-5 bg-[#0f172a] border border-[#334155] rounded-xl shadow-2xl space-y-4`}
                                style={{
                                  // @ts-ignore
                                  'positionAnchor': `--anchor-${index}`,
                                  // @ts-ignore
                                  '--position-anchor': `--anchor-${index}`
                                } as React.CSSProperties}
                              >
                                <div className="absolute -top-2 left-6 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-b-8 border-b-[#0f172a]"></div>
                                <div className="absolute -top-[9px] left-6 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-b-8 border-b-[#334155] -z-10"></div>
                                
                                <div className="flex items-center justify-between border-b border-[#1e293b] pb-2">
                                  <span className="text-xs font-bold text-white uppercase tracking-wider">{proc.name} Status</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                                    proc.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                                  }`}>{proc.status}</span>
                                </div>

                                <div className="grid grid-cols-2 gap-2.5 text-xs font-sans">
                                  <div className="bg-[#0b0f19] p-2 rounded border border-[#1e293b]">
                                    <span className="text-slate-500 block text-[9px] uppercase font-semibold">Uptime</span>
                                    <span className="text-slate-200 font-medium font-mono">
                                      {Math.floor(proc.uptime / 3600)}h {Math.floor((proc.uptime % 3600) / 60)}m {proc.uptime % 60}s
                                    </span>
                                  </div>
                                  <div className="bg-[#0b0f19] p-2 rounded border border-[#1e293b]">
                                    <span className="text-slate-500 block text-[9px] uppercase font-semibold">Restarts</span>
                                    <span className="text-slate-200 font-medium font-mono">{proc.restarts} times</span>
                                  </div>
                                  <div className="bg-[#0b0f19] p-2 rounded border border-[#1e293b]">
                                    <span className="text-slate-500 block text-[9px] uppercase font-semibold">CPU Monit</span>
                                    <span className="text-slate-200 font-medium font-mono">{proc.cpu}%</span>
                                  </div>
                                  <div className="bg-[#0b0f19] p-2 rounded border border-[#1e293b]">
                                    <span className="text-slate-500 block text-[9px] uppercase font-semibold">Memory Alloc</span>
                                    <span className="text-slate-200 font-medium font-mono">{proc.memory} MB</span>
                                  </div>
                                </div>

                                <div className="flex space-x-2 pt-2 border-t border-[#1e293b]">
                                  {proc.status === 'online' ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handlePM2Action(proc.name, 'stop');
                                        setActivePopover(null);
                                      }}
                                      className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-1.5 rounded text-[11px] font-bold transition-colors"
                                    >
                                      Stop
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handlePM2Action(proc.name, 'start');
                                        setActivePopover(null);
                                      }}
                                      className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 py-1.5 rounded text-[11px] font-bold transition-colors"
                                    >
                                      Start
                                    </button>
                                  )}
                                  
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handlePM2Action(proc.name, 'restart');
                                      setActivePopover(null);
                                    }}
                                    className="flex-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 py-1.5 rounded text-[11px] font-bold transition-colors"
                                  >
                                    Restart
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Resource Gauges & Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Server status card */}
                    <div className="glass p-6 rounded-2xl lg:col-span-2 space-y-6">
                      <h3 className="font-bold text-white flex items-center space-x-2">
                        <HardDrive size={18} className="text-emerald-400" />
                        <span>Server Host Resources</span>
                      </h3>
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-[#0b0f19] p-4 rounded-xl border border-[#1e293b]">
                          <span className="text-xs text-slate-400 block mb-1">Heap Memory Usage</span>
                          <div className="text-xl font-bold text-white">{metrics.system.memory.heapUsed} MB</div>
                          <span className="text-[10px] text-slate-500">Max limit: {metrics.system.memory.heapTotal} MB</span>
                        </div>
                        <div className="bg-[#0b0f19] p-4 rounded-xl border border-[#1e293b]">
                          <span className="text-xs text-slate-400 block mb-1">RSS Allocation</span>
                          <div className="text-xl font-bold text-white">{metrics.system.memory.rss} MB</div>
                          <span className="text-[10px] text-slate-500">Overall process chunk</span>
                        </div>
                        <div className="bg-[#0b0f19] p-4 rounded-xl border border-[#1e293b]">
                          <span className="text-xs text-slate-400 block mb-1">Server Uptime</span>
                          <div className="text-xl font-bold text-white">{Math.floor(metrics.system.uptime / 3600)}h {Math.floor((metrics.system.uptime % 3600) / 60)}m</div>
                          <span className="text-[10px] text-slate-500">Node JS Process state</span>
                        </div>
                      </div>

                      <div className="text-xs text-slate-400 flex items-center justify-between border-t border-[#1e293b] pt-4">
                        <span>Node.js runtime: <strong className="text-white">{metrics.system.nodeVersion}</strong></span>
                        <span>Process engine: <strong className="text-white">Bun/V8 Daemon</strong></span>
                      </div>
                    </div>

                    {/* Report categories breakdown */}
                    <div className="glass p-6 rounded-2xl flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-white mb-4">Reports Status Distribution</h3>
                        <div className="space-y-3">
                          {Object.entries(metrics.reportStatusBreakdown || {}).map(([status, count]: [string, any]) => (
                            <div key={status} className="flex items-center justify-between">
                              <span className="text-sm text-slate-400 capitalize">{status.replace('_', ' ')}</span>
                              <span className="bg-slate-800 text-slate-200 text-xs font-bold px-2 py-0.5 rounded">
                                {count}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <div className="mt-6 pt-4 border-t border-[#1e293b] text-xs text-slate-400 text-center">
                        Verified reports publish automatically after 3 verifications.
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="glass p-10 text-center rounded-2xl border border-rose-500/20 max-w-lg mx-auto">
                  <AlertTriangle className="mx-auto text-rose-400 mb-4" size={40} />
                  <h3 className="text-lg font-bold text-white mb-2">Metrics Connection Failed</h3>
                  <p className="text-sm text-slate-400 mb-6">
                    Could not fetch metrics from active API server. Verify connection settings or check if server is running.
                  </p>
                  <button 
                    onClick={() => setShowSettings(true)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    Adjust Connection Settings
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PAGE: AI Model Config */}
          {activeTab === 'ai-models' && (
            <div className="space-y-8">
              <div className="flex justify-between items-center">
                <p className="text-sm text-slate-400 max-w-xl">
                  Configure multiple AI models in priorities. When the primary model fails or is throttled, the system will fall back transparently down the stack.
                </p>
                <button
                  onClick={() => setEditingModel({
                    name: '',
                    provider: 'Groq',
                    model_string: '',
                    api_key: '',
                    api_key_env_var: 'GROQ_API_KEYS',
                    api_endpoint: 'https://api.groq.com/openai/v1/chat/completions',
                    priority: models.length + 1,
                    is_enabled: true,
                    is_free: true
                  })}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-4 py-2 rounded-lg text-sm flex items-center space-x-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                >
                  <Plus size={16} />
                  <span>Register New Model</span>
                </button>
              </div>

              {/* Model Form (Modal or Inline) */}
              {editingModel && (
                <div className="glass p-6 rounded-2xl border border-emerald-500/20 space-y-4 max-w-2xl">
                  <h3 className="font-bold text-white text-lg">
                    {editingModel.id ? 'Edit AI Model Configuration' : 'Register New AI Model'}
                  </h3>
                  
                  <form onSubmit={handleSaveModel} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1">Friendly Name</label>
                        <input
                          type="text"
                          required
                          value={editingModel.name || ''}
                          onChange={e => setEditingModel(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g. Groq Llama 3.3 70B"
                          className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1">Provider</label>
                        <select
                          value={editingModel.provider || 'Groq'}
                          onChange={e => setEditingModel(prev => ({ ...prev, provider: e.target.value }))}
                          className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                        >
                          <option value="Groq">Groq</option>
                          <option value="OpenRouter">OpenRouter</option>
                          <option value="OpenAI">OpenAI</option>
                          <option value="Gemini">Gemini</option>
                          <option value="Anthropic">Anthropic</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1">Model String Identifier</label>
                        <input
                          type="text"
                          required
                          value={editingModel.model_string || ''}
                          onChange={e => setEditingModel(prev => ({ ...prev, model_string: e.target.value }))}
                          placeholder="e.g. llama-3.3-70b-versatile"
                          className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1">Priority Order (1 = Top)</label>
                        <input
                          type="number"
                          required
                          min="1"
                          value={editingModel.priority || 1}
                          onChange={e => setEditingModel(prev => ({ ...prev, priority: Number(e.target.value) }))}
                          className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs uppercase font-bold text-slate-400 mb-1">API Endpoint URL</label>
                      <input
                        type="text"
                        value={editingModel.api_endpoint || ''}
                        onChange={e => setEditingModel(prev => ({ ...prev, api_endpoint: e.target.value }))}
                        placeholder="e.g. https://api.groq.com/openai/v1/chat/completions"
                        className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1">API Key Environment Variable</label>
                        <input
                          type="text"
                          required
                          value={editingModel.api_key_env_var || ''}
                          onChange={e => setEditingModel(prev => ({ ...prev, api_key_env_var: e.target.value }))}
                          placeholder="e.g. GROQ_API_KEYS"
                          className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1">Direct Secret API Key (Optional)</label>
                        <input
                          type="password"
                          value={editingModel.api_key || ''}
                          onChange={e => setEditingModel(prev => ({ ...prev, api_key: e.target.value }))}
                          placeholder="Overrides Env Var if provided"
                          className="w-full bg-[#0b0f19] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-6 pt-2">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingModel.is_enabled !== false}
                          onChange={e => setEditingModel(prev => ({ ...prev, is_enabled: e.target.checked }))}
                          className="rounded text-emerald-500 focus:ring-emerald-500 bg-[#0b0f19] border-[#334155]"
                        />
                        <span className="text-sm font-medium text-slate-200">Active / Enabled</span>
                      </label>

                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingModel.is_free !== false}
                          onChange={e => setEditingModel(prev => ({ ...prev, is_free: e.target.checked }))}
                          className="rounded text-emerald-500 focus:ring-emerald-500 bg-[#0b0f19] border-[#334155]"
                        />
                        <span className="text-sm font-medium text-slate-200">Free Tier Model</span>
                      </label>
                    </div>

                    <div className="flex space-x-3 justify-end pt-4">
                      <button
                        type="button"
                        onClick={() => setEditingModel(null)}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-sm transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-6 py-2 rounded-lg text-sm transition-all"
                      >
                        Save Configuration
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Models List Grid */}
              {modelsLoading ? (
                <div className="flex justify-center items-center py-20 text-slate-400">
                  <RefreshCw className="animate-spin mr-2" size={18} />
                  <span>Loading AI Configurations...</span>
                </div>
              ) : models.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">
                  {models.map((model) => (
                    <div 
                      key={model.id} 
                      className={`glass p-6 rounded-2xl flex flex-col justify-between border ${
                        model.is_enabled ? 'border-[#1e293b]' : 'border-dashed border-slate-700/50 opacity-60'
                      }`}
                    >
                      <div className="space-y-4">
                        {/* Header */}
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <h4 className="font-bold text-white text-base">{model.name}</h4>
                              {model.is_free && (
                                <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase">
                                  Free
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400">{model.provider} Endpoint</span>
                          </div>

                          <div className="bg-slate-800 text-slate-300 font-bold text-xs px-2.5 py-1 rounded border border-[#334155]">
                            Priority {model.priority}
                          </div>
                        </div>

                        {/* Details */}
                        <div className="space-y-1.5 text-xs text-slate-400 font-mono">
                          <div>
                            <span className="text-slate-500">ID:</span> {model.model_string}
                          </div>
                          <div>
                            <span className="text-slate-500">Env Key:</span> {model.api_key_env_var}
                          </div>
                          {model.api_endpoint && (
                            <div className="truncate" title={model.api_endpoint}>
                              <span className="text-slate-500">Url:</span> {model.api_endpoint}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex justify-between items-center border-t border-[#1e293b] pt-4 mt-6">
                        <span className="text-xs flex items-center space-x-1">
                          {model.is_enabled ? (
                            <>
                              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
                              <span className="text-emerald-400 font-semibold">Active</span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 bg-rose-400 rounded-full"></span>
                              <span className="text-rose-400 font-medium">Disabled</span>
                            </>
                          )}
                        </span>

                        <div className="flex space-x-2">
                          <button
                            onClick={() => setEditingModel(model)}
                            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteModel(model.id)}
                            className="p-1.5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500">
                  No AI models configured. Click "Register New Model" to configure routing.
                </div>
              )}
            </div>
          )}

          {/* PAGE: Volunteer Queue */}
          {activeTab === 'volunteer' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Queue List */}
              <div className="lg:col-span-1 glass rounded-2xl flex flex-col overflow-hidden">
                <div className="p-4 border-b border-[#1e293b] bg-slate-900/50 flex justify-between items-center">
                  <h3 className="font-bold text-white text-sm">Pending Submissions</h3>
                  <button 
                    onClick={fetchVolunteerSubmissions} 
                    className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                  >
                    <RefreshCw size={14} className={volunteersLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto max-h-[calc(100vh-280px)] divide-y divide-[#1e293b]">
                  {volunteersLoading && submissions.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">Loading queue...</div>
                  ) : submissions.length > 0 ? (
                    submissions.map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => {
                          setSelectedSubmission(sub);
                        }}
                        className={`w-full p-4 text-left transition-colors flex flex-col space-y-1 ${
                          selectedSubmission?.id === sub.id ? 'bg-[#1e293b]/50' : 'hover:bg-slate-850/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                            sub.data_type === 'report' ? 'bg-[#1e293b] text-emerald-400 border border-emerald-500/20' :
                            sub.data_type === 'news' ? 'bg-[#1e293b] text-cyan-400 border border-cyan-500/20' :
                            'bg-[#1e293b] text-amber-400 border border-amber-500/20'
                          }`}>
                            {sub.data_type}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(sub.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-slate-200 truncate">
                          {sub.data_type === 'report' ? sub.raw_data?.title :
                           sub.data_type === 'news' ? sub.raw_data?.headline :
                           sub.raw_data?.name}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Submitted by user: <code className="text-slate-300">{sub.submitted_by.slice(0, 10)}...</code>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="p-8 text-center text-slate-500 text-sm">
                      Queue is empty! All citizen reports are processed.
                    </div>
                  )}
                </div>
              </div>

              {/* Submission Diff Details Panel */}
              <div className="lg:col-span-2 glass rounded-2xl p-6 flex flex-col justify-between border border-[#1e293b]">
                {selectedSubmission ? (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    <div>
                      {/* Header */}
                      <div className="flex items-start justify-between border-b border-[#1e293b] pb-4 mb-4">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs uppercase font-bold text-emerald-400 tracking-wider">
                              Submission Details
                            </span>
                            <span className="text-slate-500">•</span>
                            <span className="text-xs text-slate-400">ID: {selectedSubmission.id}</span>
                          </div>
                          <h3 className="text-lg font-bold text-white mt-1">
                            {selectedSubmission.data_type === 'report' ? selectedSubmission.raw_data?.title :
                             selectedSubmission.data_type === 'news' ? selectedSubmission.raw_data?.headline :
                             selectedSubmission.raw_data?.name}
                          </h3>
                        </div>
                        <div className="text-xs text-slate-400 text-right">
                          <div className="font-semibold text-white">
                            {selectedSubmission.verification_count} / {selectedSubmission.required_verifications}
                          </div>
                          <div>Verifications</div>
                        </div>
                      </div>

                      {/* Content Body */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Submission Metadata</h4>
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between bg-[#0b0f19] p-2.5 rounded-lg border border-[#1e293b]">
                              <span className="text-slate-500">Data Category:</span>
                              <span className="text-slate-200 capitalize font-medium">{selectedSubmission.data_type}</span>
                            </div>
                            <div className="flex justify-between bg-[#0b0f19] p-2.5 rounded-lg border border-[#1e293b]">
                              <span className="text-slate-500">Submitter ID:</span>
                              <span className="text-slate-200 font-mono select-all">{selectedSubmission.submitted_by}</span>
                            </div>
                            {selectedSubmission.submitter_email && (
                              <div className="flex justify-between bg-[#0b0f19] p-2.5 rounded-lg border border-[#1e293b]">
                                <span className="text-slate-500">Submitter Email:</span>
                                <span className="text-slate-200 select-all">{selectedSubmission.submitter_email}</span>
                              </div>
                            )}
                            <div className="flex justify-between bg-[#0b0f19] p-2.5 rounded-lg border border-[#1e293b]">
                              <span className="text-slate-500">Date Received:</span>
                              <span className="text-slate-200">
                                {new Date(selectedSubmission.created_at).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Raw JSON Payload</h4>
                          <div className="bg-[#0b0f19] border border-[#1e293b] rounded-xl p-4 font-mono text-[11px] overflow-auto max-h-[300px] text-emerald-400">
                            <pre>{JSON.stringify(selectedSubmission.raw_data, null, 2)}</pre>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Block */}
                    <div className="border-t border-[#1e293b] pt-6 mt-6">
                      <div className="flex justify-between items-center">
                        <div className="text-xs text-amber-400 flex items-center space-x-1.5">
                          <Shield size={14} />
                          <span>Admin actions publish instantly, bypassing the 3-volunteer limit.</span>
                        </div>
                        
                        <div className="flex space-x-3">
                          <button
                            disabled={modulatingId !== null}
                            onClick={() => handleVerifySubmission(selectedSubmission.id, 'reject')}
                            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold px-5 py-2.5 rounded-lg text-sm flex items-center space-x-2 transition-colors"
                          >
                            <X size={16} />
                            <span>Reject & Trash</span>
                          </button>
                          
                          <button
                            disabled={modulatingId !== null}
                            onClick={() => handleVerifySubmission(selectedSubmission.id, 'approve')}
                            className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-6 py-2.5 rounded-lg text-sm flex items-center space-x-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                          >
                            <Check size={16} />
                            <span>Approve & Publish</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-center py-20">
                    <FileText size={48} className="text-slate-600 mb-3" />
                    <p className="font-medium text-slate-400">No Submission Selected</p>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      Choose a pending data item from the left queue list to review and verify details.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PAGE: Scrapers Panel */}
          {activeTab === 'scrapers' && (
            <div className="space-y-8">
              {/* Manual Scraper Actions */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass p-6 rounded-2xl flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-bold text-white text-base">Civic News RSS Scraper</h4>
                      <span className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded font-mono">3 AM, 5 AM, 7 AM</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Scrapes whitelisted regional news outlets for civic issues, running geolocal AI algorithms to resolve lat/long.
                    </p>
                  </div>
                  <button
                    disabled={triggeringScraper !== null}
                    onClick={() => handleTriggerScraper('news')}
                    className="w-full mt-6 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold py-2 rounded-lg text-sm flex items-center justify-center space-x-2 transition-all"
                  >
                    {triggeringScraper === 'news' ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    <span>Trigger News Scraper</span>
                  </button>
                </div>

                <div className="glass p-6 rounded-2xl flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-bold text-white text-base">Multi-City MLA Scraper</h4>
                      <span className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded font-mono">Sun 4 AM IST</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Pulls municipal representative, political alignment, contact, and constituency boundary data from state sites and Wikipedia.
                    </p>
                  </div>
                  <button
                    disabled={triggeringScraper !== null}
                    onClick={() => handleTriggerScraper('mla')}
                    className="w-full mt-6 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold py-2 rounded-lg text-sm flex items-center justify-center space-x-2 transition-all"
                  >
                    {triggeringScraper === 'mla' ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    <span>Trigger MLA Scraper</span>
                  </button>
                </div>

                <div className="glass p-6 rounded-2xl flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-bold text-white text-base">Government Projects</h4>
                      <span className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded font-mono">Mon 6 AM IST</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Extracts public infrastructural projects, tenders, budgets, and wards from official municipal websites.
                    </p>
                  </div>
                  <button
                    disabled={triggeringScraper !== null}
                    onClick={() => handleTriggerScraper('projects')}
                    className="w-full mt-6 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold py-2 rounded-lg text-sm flex items-center justify-center space-x-2 transition-all"
                  >
                    {triggeringScraper === 'projects' ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    <span>Trigger Projects Scraper</span>
                  </button>
                </div>
              </div>

              {/* Scraper Runs History Table */}
              <div className="glass rounded-2xl overflow-hidden border border-[#1e293b]">
                <div className="p-4 border-b border-[#1e293b] bg-slate-900/50 flex justify-between items-center">
                  <h3 className="font-bold text-white text-sm">Scraping History & Logs</h3>
                  <button
                    onClick={fetchScraperRuns}
                    className="p-1 hover:bg-slate-800 text-slate-400 rounded transition-colors"
                  >
                    <RefreshCw size={14} className={scrapersLoading ? 'animate-spin' : ''} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-800/40 text-slate-400 border-b border-[#1e293b] font-semibold uppercase tracking-wider">
                        <th className="p-4">Scraper Name</th>
                        <th className="p-4">Run Status</th>
                        <th className="p-4">Items Processed</th>
                        <th className="p-4">Started At</th>
                        <th className="p-4">Completed At</th>
                        <th className="p-4">Notes / Error Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e293b]">
                      {scraperRuns.length > 0 ? (
                        scraperRuns.map((run) => (
                          <tr key={run.id} className="hover:bg-slate-900/20">
                            <td className="p-4 font-bold text-slate-200 capitalize">{run.scraper_type}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded font-semibold ${
                                run.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                                run.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                                'bg-amber-500/10 text-amber-400 animate-pulse'
                              }`}>
                                {run.status}
                              </span>
                            </td>
                            <td className="p-4 font-mono font-medium">{run.items_processed}</td>
                            <td className="p-4 text-slate-400">{new Date(run.started_at).toLocaleString()}</td>
                            <td className="p-4 text-slate-400">
                              {run.completed_at ? new Date(run.completed_at).toLocaleString() : 'Running...'}
                            </td>
                            <td className="p-4 text-rose-400 max-w-xs truncate font-mono" title={run.error_message || ''}>
                              {run.error_message || '-'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">
                            No scraping runs recorded in history yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PAGE: SQL Shell */}
          {activeTab === 'sql' && (
            <div className="space-y-6 flex flex-col h-[calc(100vh-170px)]">
              {/* Form Input Query */}
              <form onSubmit={handleRunSQL} className="space-y-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-slate-400 text-xs">
                    <Terminal size={14} className="text-emerald-400" />
                    <span>Raw PostgreSQL Editor (PostGIS Enabled)</span>
                  </div>
                  
                  <div className="flex space-x-2">
                    {sqlResult && (
                      <button
                        type="button"
                        onClick={handleExportCSV}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#334155] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                      >
                        Export to CSV
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={sqlLoading}
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold px-5 py-1.5 rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                    >
                      {sqlLoading ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                      <span>Execute Query</span>
                    </button>
                  </div>
                </div>

                <div className="border border-[#1e293b] rounded-xl overflow-hidden bg-[#070a13] focus-within:border-emerald-500">
                  <textarea
                    value={sqlQuery}
                    onChange={e => setSqlQuery(e.target.value)}
                    rows={4}
                    className="w-full bg-transparent p-4 font-mono text-sm text-emerald-400 focus:outline-none resize-y"
                    placeholder="SELECT * FROM reports LIMIT 10;"
                  />
                </div>
              </form>

              {/* Result Area */}
              <div className="flex-1 min-h-0 bg-[#0f172a] rounded-xl border border-[#1e293b] overflow-hidden flex flex-col">
                <div className="p-3 border-b border-[#1e293b] bg-slate-900/50 flex justify-between items-center text-xs text-slate-400">
                  <span>Terminal Result Console</span>
                  {sqlResult && (
                    <span className="font-semibold text-emerald-400">
                      Query OK ({sqlResult.rows?.length || 0} rows, affected: {sqlResult.affected})
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-auto p-4 font-mono text-[11px]">
                  {sqlLoading && (
                    <div className="flex justify-center items-center py-20 text-slate-400 space-x-2">
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Executing raw SQL query transaction...</span>
                    </div>
                  )}

                  {sqlError && (
                    <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-lg flex items-start space-x-2">
                      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-xs uppercase">SQL Execution Failure</div>
                        <p className="mt-1 font-mono text-xs">{sqlError}</p>
                      </div>
                    </div>
                  )}

                  {!sqlLoading && !sqlError && sqlResult && sqlResult.rows && sqlResult.rows.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="border-b border-[#334155] text-slate-400">
                            {Object.keys(sqlResult.rows[0]).map((key) => (
                              <th key={key} className="pb-2 pr-4 font-bold">{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1e293b]/50">
                          {sqlResult.rows.map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-slate-900/40">
                              {Object.keys(row).map((key) => {
                                const val = row[key];
                                const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
                                return (
                                  <td key={key} className="py-2 pr-4 text-slate-300 max-w-xs truncate" title={str}>
                                    {str}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : !sqlLoading && !sqlError && sqlResult ? (
                    <div className="text-slate-400 p-4">
                      Query returned success but no rows (e.g. DDL/DML mutation). Affected rows: {sqlResult.affected}
                    </div>
                  ) : (
                    <div className="text-slate-500 text-center py-20">
                      Query outputs will display here. Write SQL statement above and click run.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
