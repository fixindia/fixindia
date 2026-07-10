/* eslint-disable @typescript-eslint/no-explicit-any */
import sql from './db';

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

let cachedModels: AIModel[] = [];
let lastFetched = 0;

export function clearModelCache() {
  lastFetched = 0;
}

async function getActiveModels(): Promise<AIModel[]> {
  const now = Date.now();
  if (now - lastFetched < 60000 && cachedModels.length > 0) {
    return cachedModels;
  }

  try {
    const models = await sql`
      SELECT id, name, provider, model_string, api_key, api_key_env_var, api_endpoint, priority, is_enabled, is_free
      FROM ai_models
      WHERE is_enabled = TRUE
      ORDER BY priority ASC
    ` as unknown as AIModel[];
    
    cachedModels = models;
    lastFetched = now;
    return cachedModels;
  } catch (err) {
    console.error('Failed to fetch AI models from database, using hardcoded fallback:', err);
    return [
      {
        id: 1,
        name: 'Groq Llama 3.3 70B',
        provider: 'Groq',
        model_string: 'llama-3.3-70b-versatile',
        api_key: null,
        api_key_env_var: 'GROQ_API_KEYS',
        api_endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        priority: 1,
        is_enabled: true,
        is_free: true
      },
      {
        id: 2,
        name: 'OpenRouter Llama 3.3 70B',
        provider: 'OpenRouter',
        model_string: 'meta-llama/llama-3.3-70b-instruct:free',
        api_key: null,
        api_key_env_var: 'OPENROUTER_API_KEYS',
        api_endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        priority: 2,
        is_enabled: true,
        is_free: true
      }
    ];
  }
}

const keyRotationIndexes: Record<string, number> = {};

function getAPIKey(model: AIModel): string {
  // 1. Direct DB key if configured
  if (model.api_key) {
    return model.api_key;
  }

  // 2. Env variable (comma-separated rotation)
  const envVal = process.env[model.api_key_env_var] || '';
  const keys = envVal.split(',').filter(Boolean);
  if (keys.length === 0) {
    throw new Error(`API key environment variable ${model.api_key_env_var} is not configured`);
  }

  const rotKey = model.api_key_env_var;
  const idx = keyRotationIndexes[rotKey] || 0;
  const key = keys[idx % keys.length];
  keyRotationIndexes[rotKey] = idx + 1;
  return key;
}

export async function queryLLM(prompt: string, systemPrompt?: string): Promise<string> {
  const models = await getActiveModels();

  if (models.length === 0) {
    throw new Error('No active AI models configured');
  }

  for (const model of models) {
    try {
      console.log(`[LLM] Querying model: ${model.name} (${model.model_string}) via ${model.provider}...`);
      const apiKey = getAPIKey(model);
      const endpoint = model.api_endpoint || 'https://api.groq.com/openai/v1/chat/completions';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };

      if (model.provider === 'OpenRouter') {
        headers['HTTP-Referer'] = 'https://civicmap.in';
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        // Bound the request so a provider that accepts the connection but never
        // responds can't hang the scraper run (and any admin trigger) forever.
        // Matches the RSS scrapers' explicit timeouts; on timeout the per-model
        // try/catch falls through to the next provider.
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: model.model_string,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
      });

      if (res.ok) {
        const data = await res.json() as any;
        return data.choices[0].message.content;
      }

      console.warn(`[LLM] Model ${model.name} failed with status ${res.status}. Trying fallback...`);
    } catch (err) {
      console.warn(`[LLM] Model ${model.name} query failed:`, err);
    }
  }

  throw new Error('All configured LLM providers failed or returned errors');
}
