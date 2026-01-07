/**
 * AWS Bedrock Client for Browser
 * 
 * This module provides a browser-compatible client for calling Claude via AWS Bedrock.
 * Uses AWS Signature V4 signing for authentication.
 */

// AWS Credentials from environment
const getCredentials = () => ({
  accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID || '',
  secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || '',
  region: import.meta.env.VITE_AWS_REGION || 'eu-north-1',
});

// Claude model ID for Bedrock
const CLAUDE_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';

/**
 * AWS Signature V4 signing implementation for browser
 */
async function signRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
  credentials: ReturnType<typeof getCredentials>
): Promise<Record<string, string>> {
  const { accessKeyId, secretAccessKey, region } = credentials;
  
  const urlObj = new URL(url);
  const host = urlObj.host;
  const path = urlObj.pathname;
  const service = 'bedrock-runtime';
  
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  
  // Canonical request
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalHeaders = `content-type:${headers['Content-Type']}\nhost:${host}\nx-amz-date:${amzDate}\n`;
  
  const encoder = new TextEncoder();
  const payloadHash = await crypto.subtle.digest('SHA-256', encoder.encode(body));
  const payloadHashHex = Array.from(new Uint8Array(payloadHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const canonicalRequest = [
    method,
    path,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join('\n');
  
  // String to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  
  const canonicalRequestHash = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest));
  const canonicalRequestHashHex = Array.from(new Uint8Array(canonicalRequestHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHashHex
  ].join('\n');
  
  // Signing key
  const getSignatureKey = async (key: string, dateStamp: string, region: string, service: string) => {
    const kDate = await hmacSha256(`AWS4${key}`, dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, service);
    const kSigning = await hmacSha256(kService, 'aws4_request');
    return kSigning;
  };
  
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacSha256Hex(signingKey, stringToSign);
  
  // Authorization header
  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  return {
    ...headers,
    'X-Amz-Date': amzDate,
    'Authorization': authorization,
  };
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const result = await hmacSha256(key, data);
  return Array.from(new Uint8Array(result))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BedrockResponse {
  content: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Send a message to Claude via AWS Bedrock
 */
export async function sendToClaudeBedrock(
  message: string,
  history: BedrockMessage[] = [],
  systemPrompt?: string
): Promise<BedrockResponse> {
  const credentials = getCredentials();
  
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    throw new Error('AWS credentials not configured. Please set VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY.');
  }
  
  const region = credentials.region;
  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${CLAUDE_MODEL_ID}/invoke`;
  
  // Build messages array
  const messages = [
    ...history,
    { role: 'user' as const, content: message }
  ];
  
  // Build request body
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    messages: messages.map(m => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }]
    })),
    ...(systemPrompt && { system: systemPrompt })
  };
  
  const body = JSON.stringify(requestBody);
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  try {
    const signedHeaders = await signRequest('POST', endpoint, headers, body, credentials);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: signedHeaders,
      body
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Bedrock] API Error:', response.status, errorText);
      throw new Error(`Bedrock API error: ${response.status} - ${errorText}`);
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
    
    return {
      content,
      usage: data.usage
    };
  } catch (error) {
    console.error('[Bedrock] Request failed:', error);
    throw error;
  }
}

/**
 * Check if Bedrock credentials are configured
 */
export function isBedrockConfigured(): boolean {
  const credentials = getCredentials();
  return !!(credentials.accessKeyId && credentials.secretAccessKey);
}

/**
 * Get the configured AWS region
 */
export function getBedrockRegion(): string {
  return getCredentials().region;
}

