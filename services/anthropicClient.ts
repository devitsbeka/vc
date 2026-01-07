/**
 * Anthropic API Client for Browser
 * 
 * Direct API calls to Anthropic's Claude API.
 * Works in browser (supports CORS).
 */

// Get Anthropic API key from environment
const getAnthropicApiKey = () => import.meta.env.VITE_ANTHROPIC_API_KEY || '';

// Claude model - using Claude 3.5 Sonnet for best coding capabilities
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicResponse {
  content: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Send a message to Claude via Anthropic API
 */
export async function sendToClaudeAnthropic(
  message: string,
  history: AnthropicMessage[] = [],
  systemPrompt?: string
): Promise<AnthropicResponse> {
  const apiKey = getAnthropicApiKey();
  
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Please set VITE_ANTHROPIC_API_KEY in your .env.local file.');
  }
  
  const endpoint = 'https://api.anthropic.com/v1/messages';
  
  // Build messages array
  const messages = [
    ...history.map(m => ({
      role: m.role,
      content: m.content
    })),
    { role: 'user' as const, content: message }
  ];
  
  // Build request body
  const requestBody: Record<string, unknown> = {
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    messages,
  };
  
  if (systemPrompt) {
    requestBody.system = systemPrompt;
  }
  
  const body = JSON.stringify(requestBody);
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  
  try {
    console.log('[Anthropic] Sending request to Claude...');
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Anthropic] API Error:', response.status, errorText);
      
      if (response.status === 401) {
        throw new Error('Invalid Anthropic API key. Please check your VITE_ANTHROPIC_API_KEY.');
      }
      if (response.status === 429) {
        throw new Error('Rate limited. Please wait a moment and try again.');
      }
      if (response.status === 400) {
        throw new Error(`Bad request: ${errorText}`);
      }
      
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Extract content from response
    let content = '';
    if (data.content && Array.isArray(data.content)) {
      content = data.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }
    
    console.log('[Anthropic] Response received, tokens:', data.usage);
    
    return {
      content,
      usage: data.usage
    };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Network error. Check your internet connection.');
    }
    throw error;
  }
}

/**
 * Check if Anthropic API key is configured
 */
export function isAnthropicConfigured(): boolean {
  return !!getAnthropicApiKey();
}

