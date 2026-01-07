/**
 * AWS Bedrock Client for Browser
 * 
 * This module provides a browser-compatible client for calling Claude via AWS Bedrock.
 * Uses Bearer Token authentication (Long-term API Key from Bedrock console).
 */

// Get Bedrock API key from environment
const getBedrockApiKey = () => import.meta.env.VITE_AWS_BEDROCK_API_KEY || '';
const getBedrockRegion = () => import.meta.env.VITE_AWS_BEDROCK_REGION || 'us-east-1';

// Claude model ID for Bedrock
// Use Claude 3 Haiku for faster responses, or Sonnet for better quality
const CLAUDE_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

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
 * Uses Bearer Token authentication (Long-term API Key)
 */
export async function sendToClaudeBedrock(
  message: string,
  history: BedrockMessage[] = [],
  systemPrompt?: string
): Promise<BedrockResponse> {
  const apiKey = getBedrockApiKey();
  const region = getBedrockRegion();
  
  if (!apiKey) {
    throw new Error('Bedrock API key not configured. Please set VITE_AWS_BEDROCK_API_KEY in your .env.local file.');
  }
  
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
  
  // Use Bearer Token authentication
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Bedrock] API Error:', response.status, errorText);
      
      // Provide helpful error messages
      if (response.status === 403) {
        if (errorText.includes('scoped to correct service')) {
          throw new Error(`AWS Bedrock access denied. Please ensure:\n1. Your IAM user has bedrock:InvokeModel permission\n2. Claude models are enabled in AWS Bedrock console (${region})\n3. Go to: https://console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess`);
        }
        throw new Error(`AWS Bedrock access denied (403). Check IAM permissions for bedrock:InvokeModel.`);
      }
      if (response.status === 404) {
        throw new Error(`Claude model not found. Enable Claude in AWS Bedrock console: https://console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess`);
      }
      
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
 * Check if Bedrock API key is configured
 */
export function isBedrockConfigured(): boolean {
  return !!getBedrockApiKey();
}

/**
 * Get the configured AWS Bedrock region
 */
export function getConfiguredBedrockRegion(): string {
  return getBedrockRegion();
}

