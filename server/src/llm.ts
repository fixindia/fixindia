/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment */
const GROQ_KEYS = (process.env.GROQ_API_KEYS || '').split(',').filter(Boolean);
const OPENROUTER_KEYS = (process.env.OPENROUTER_API_KEYS || '').split(',').filter(Boolean);

let groqIdx = 0;
let openrouterIdx = 0;

export function getGroqKey(): string {
  if (GROQ_KEYS.length === 0) throw new Error('No GROQ API keys configured');
  const key = GROQ_KEYS[groqIdx % GROQ_KEYS.length];
  groqIdx++;
  return key;
}

export function getOpenRouterKey(): string {
  if (OPENROUTER_KEYS.length === 0) throw new Error('No OpenRouter API keys configured');
  const key = OPENROUTER_KEYS[openrouterIdx % OPENROUTER_KEYS.length];
  openrouterIdx++;
  return key;
}

interface LLMResponse {
  content: string;
}

// Primary: Groq (free, fast) → Fallback: OpenRouter
export async function queryLLM(prompt: string, systemPrompt?: string): Promise<string> {
  // Try Groq first (Llama 3.3 70B - free)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getGroqKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
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
    console.warn(`Groq failed with ${res.status}, falling back to OpenRouter`);
  } catch (e) {
    console.warn('Groq request failed, trying OpenRouter:', e);
  }

  // Fallback: OpenRouter (free models)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getOpenRouterKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://civicmap.in',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
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
    throw new Error(`OpenRouter failed with ${res.status}`);
  } catch (e) {
    console.error('All LLM providers failed:', e);
    throw new Error('LLM service unavailable');
  }
}
