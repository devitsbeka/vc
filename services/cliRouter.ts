// services/cliRouter.ts
import { CLITool, sidecarManager } from './sidecar';
import { sendMessageToGemini } from './gemini';
import { ClaudeProvider } from '../types';
import { isWebMode, getInvoke, getListen } from './webCompat';
import { sendToClaudeBedrock, isBedrockConfigured } from './bedrockClient';

interface CLIMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CLIResponse {
  content: string;
  code?: string;
}

// 进度回调函数类型
export type ProgressCallback = (update: string) => void;
export type TerminalCallback = (output: string) => void;
export type TerminalCreateCallback = (name: string, pid: number, terminalId?: string) => string;

/**
 * CLI 路由器 - 根据选择的工具调用对应的 CLI
 */
export class CLIRouter {
  private projectDir: string | null = null;
  private permissionMode: 'bypassPermissions' | 'acceptEdits' | 'default' = 'bypassPermissions';
  private allowedTools: string[] = [];
  private model: string = 'sonnet';
  private provider: ClaudeProvider = 'anthropic';  // Provider for Claude (anthropic or bedrock)
  private bedrockRegion: string = 'us-east-1';     // AWS region for Bedrock
  private bedrockProfile: string = '';              // AWS profile for Bedrock
  private agent: string | null = null;  // Agent to use (e.g., 'Explore', 'Plan', custom agents)
  private sessionStats = {
    totalCost: 0,
    totalTokens: 0,
    totalTurns: 0
  };
  private progressCallback: ProgressCallback | null = null;
  private terminalCallback: TerminalCallback | null = null;
  private terminalCreateCallback: TerminalCreateCallback | null = null;
  private pendingDevServerToolId: string | null = null;
  private currentTerminalId: string | null = null;

  // Parallel task execution support (Phase 2.3)
  private taskId: string | null = null;
  private abortController: AbortController | null = null;
  private isAborted: boolean = false;

  /**
   * 设置项目目录
   */
  setProjectDir(dir: string) {
    this.projectDir = dir;
    console.log('[CLIRouter] Project directory set to:', dir);
  }

  /**
   * 设置权限模式
   */
  setPermissionMode(mode: 'bypassPermissions' | 'acceptEdits' | 'default') {
    this.permissionMode = mode;
    console.log('[CLIRouter] Permission mode set to:', mode);
  }

  /**
   * 设置允许的工具列表
   */
  setAllowedTools(tools: string[]) {
    this.allowedTools = tools;
    console.log('[CLIRouter] Allowed tools set to:', tools);
  }

  /**
   * 设置模型
   */
  setModel(model: string) {
    this.model = model;
    console.log('[CLIRouter] Model set to:', model);
  }

  /**
   * 获取当前模型
   */
  getModel(): string {
    return this.model;
  }

  /**
   * 设置 Provider
   */
  setProvider(provider: ClaudeProvider) {
    this.provider = provider;
    console.log('[CLIRouter] Provider set to:', provider);
  }

  /**
   * 获取当前 Provider
   */
  getProvider(): ClaudeProvider {
    return this.provider;
  }

  /**
   * 设置 Bedrock Region
   */
  setBedrockRegion(region: string) {
    this.bedrockRegion = region;
    console.log('[CLIRouter] Bedrock region set to:', region);
  }

  /**
   * 获取当前 Bedrock Region
   */
  getBedrockRegion(): string {
    return this.bedrockRegion;
  }

  /**
   * 设置 Bedrock Profile
   */
  setBedrockProfile(profile: string) {
    this.bedrockProfile = profile;
    console.log('[CLIRouter] Bedrock profile set to:', profile);
  }

  /**
   * 获取当前 Bedrock Profile
   */
  getBedrockProfile(): string {
    return this.bedrockProfile;
  }

  /**
   * 设置 Agent
   */
  setAgent(agent: string | null) {
    this.agent = agent;
    console.log('[CLIRouter] Agent set to:', agent);
  }

  /**
   * 获取当前 Agent
   */
  getAgent(): string | null {
    return this.agent;
  }

  /**
   * 获取当前权限模式
   */
  getPermissionMode(): string {
    return this.permissionMode;
  }

  /**
   * 获取会话统计
   */
  getSessionStats() {
    return this.sessionStats;
  }

  /**
   * 重置会话统计
   */
  resetSessionStats() {
    this.sessionStats = {
      totalCost: 0,
      totalTokens: 0,
      totalTurns: 0
    };
  }

  // ============================================
  // Parallel Task Execution Methods (Phase 2.3)
  // ============================================

  /**
   * Set task ID for this CLI instance
   */
  setTaskId(taskId: string): void {
    this.taskId = taskId;
    console.log('[CLIRouter] Task ID set to:', taskId);
  }

  /**
   * Get task ID
   */
  getTaskId(): string | null {
    return this.taskId;
  }

  /**
   * Abort the current operation
   */
  abort(): void {
    this.isAborted = true;
    if (this.abortController) {
      this.abortController.abort();
      console.log('[CLIRouter] Aborted task:', this.taskId);
    }
  }

  /**
   * Check if aborted
   */
  isOperationAborted(): boolean {
    return this.isAborted;
  }

  /**
   * Reset abort state (for reuse)
   */
  resetAbort(): void {
    this.isAborted = false;
    this.abortController = new AbortController();
  }

  /**
   * Clone this CLI instance with current settings
   * Used for parallel task execution to isolate state
   */
  clone(): CLIRouter {
    const newRouter = new CLIRouter();

    // Copy all settings
    if (this.projectDir) {
      newRouter.setProjectDir(this.projectDir);
    }
    newRouter.setPermissionMode(this.permissionMode);
    newRouter.setAllowedTools([...this.allowedTools]);
    newRouter.setModel(this.model);
    newRouter.setProvider(this.provider);
    newRouter.setBedrockRegion(this.bedrockRegion);
    newRouter.setBedrockProfile(this.bedrockProfile);
    if (this.agent) {
      newRouter.setAgent(this.agent);
    }

    // Initialize abort controller for the new instance
    newRouter.resetAbort();

    console.log('[CLIRouter] Cloned instance for parallel execution');

    return newRouter;
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback: ProgressCallback | null) {
    this.progressCallback = callback;
  }

  /**
   * 设置终端输出回调
   */
  setTerminalCallback(callback: TerminalCallback | null) {
    this.terminalCallback = callback;
  }

  /**
   * 设置终端创建回调
   */
  setTerminalCreateCallback(callback: TerminalCreateCallback | null) {
    this.terminalCreateCallback = callback;
  }

  /**
   * 获取当前项目目录
   */
  getProjectDir(): string | null {
    return this.projectDir;
  }

  /**
   * 发送消息到指定的 CLI 工具
   */
  async sendMessage(
    tool: CLITool,
    message: string,
    history: CLIMessage[] = []
  ): Promise<CLIResponse> {
    if (!this.projectDir) {
      throw new Error('Project directory not set. Please select a project directory first.');
    }

    switch (tool) {
      case 'claude':
        return await this.sendToClaudeCLI(message, history);
      case 'gemini':
        return await this.sendToGeminiCLI(message, history);
      case 'codex':
        return await this.sendToCodexCLI(message, history);
      case 'kiro':
        return await this.sendToKiroCLI(message, history);
      default:
        throw new Error(`Unknown CLI tool: ${tool}`);
    }
  }

  /**
   * 获取应用上下文提示
   */
  private getAppContextPrompt(): string {
    return `You are working within a Tauri desktop application called "Gemini Code Studio" that integrates Claude Code CLI.

Available tools and capabilities:
- **File operations**: Read, Write, Edit files in the project directory
- **Bash command execution**: Run any shell commands (npm, pnpm, yarn, git, etc.)
- **Directory operations**: Create directories, browse files
- **Package management**: Install dependencies, run dev servers, build projects
- **Testing**: Run tests, linters, formatters

Project context:
- Working directory: ${this.projectDir}
- Current model: ${this.model}
- Permission mode: ${this.permissionMode} (files operations are auto-approved)

IMPORTANT INSTRUCTIONS:
1. When creating a new project (React, Vite, Next.js, etc.):
   - Create all necessary files (package.json, config files, source files)
   - Run \`pnpm install\` or \`npm install\` to install dependencies
   - Start the dev server using Bash tool with run_in_background: true
   - Inform the user that the server is running with the URL

2. When modifying existing projects:
   - Make the requested changes to files
   - If dependencies changed, run install command
   - If the dev server needs restart, inform the user

3. Always use Bash tool to:
   - Install dependencies after creating package.json
   - Run build commands
   - Execute tests
   - Run any CLI commands needed for the project

4. **CRITICAL - Starting development servers:**
   - For long-running commands like \`pnpm dev\`, \`npm run dev\`, \`yarn dev\`:
   - Use the Bash tool with run_in_background: true
   - Example: Bash tool with command="pnpm dev", run_in_background=true
   - The system will automatically manage the process in the background
   - Tell the user the server is running at the URL (usually http://localhost:5173 for Vite)
   - The output will be available in the Terminal tab

5. For Vite/React projects specifically:
   - Create project structure with src/, public/, index.html
   - Install vite, react, react-dom and other dependencies
   - Configure vite.config.ts/js
   - Run \`pnpm install\` first (NOT in background)
   - Then run \`pnpm dev\` with run_in_background=true

Remember: You have full access to Bash commands. Use them to complete the entire workflow, not just file creation. Long-running servers MUST use run_in_background=true.

---

User request: `;
  }

  /**
   * 格式化流式事件为 Markdown
   */
  private formatStreamEvent(json: any): string | null {
    // System 事件（初始化信息）
    if (json.type === 'system') {
      if (json.subtype === 'init') {
        return `🎯 **系统初始化**\n- Session: ${json.session_id?.substring(0, 8)}...\n- Model: ${json.model}\n- Working dir: ${json.cwd}`;
      }
      return null; // 忽略其他系统事件
    }

    // Assistant 消息类型（Claude 的回复）
    if (json.type === 'assistant' && json.message) {
      const msg = json.message;

      if (msg.content && Array.isArray(msg.content)) {
        // 文本内容
        const textBlocks = msg.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text);

        if (textBlocks.length > 0) {
          return `💬 ${textBlocks.join('\n\n')}`;
        }

        // 工具调用
        const toolUses = msg.content.filter((block: any) => block.type === 'tool_use');
        if (toolUses.length > 0) {
          return toolUses.map((tool: any) => {
            const toolName = tool.name || 'unknown';
            const inputStr = tool.input ? JSON.stringify(tool.input, null, 2) : '';

            // 检查是否是 Bash 命令，并且是开发服务器命令
            if (toolName === 'Bash' && tool.input?.command) {
              const cmd = tool.input.command;
              if (this.isDevServerCommand(cmd)) {
                console.log('[CLIRouter] Detected dev server command:', cmd);
                console.log('[CLIRouter] Tool input:', tool.input);

                // 立即启动后台进程，不等待 Claude 的 Bash 结果
                // 这样即使 Bash 阻塞，我们的进程也已经在运行了
                this.startDevServerInBackground(cmd);

                // 同时标记这个工具调用ID，以便修改返回结果
                this.pendingDevServerToolId = tool.id;
              }
            }

            // 简化显示：只显示工具名和简短参数
            if (inputStr.length < 200) {
              return `🔧 **${toolName}**\n\`\`\`json\n${inputStr}\n\`\`\``;
            } else {
              // 参数太长，只显示工具名
              return `🔧 **${toolName}** (参数较长，已省略)`;
            }
          }).join('\n\n');
        }
      }
      return null;
    }

    // User 消息类型（包含工具结果）
    if (json.type === 'user' && json.message) {
      const msg = json.message;

      if (msg.content && Array.isArray(msg.content)) {
        const toolResults = msg.content.filter((block: any) => block.type === 'tool_result');
        if (toolResults.length > 0) {
          return toolResults.map((result: any) => {
            const content = result.content || '';
            const isError = result.is_error;
            const emoji = isError ? '❌' : '✅';
            const toolUseId = result.tool_use_id || '';

            // 检查是否是我们标记的 dev server 命令
            if (toolUseId === this.pendingDevServerToolId) {
              console.log('[CLIRouter] Intercepting dev server Bash result');
              this.pendingDevServerToolId = null; // 清除标记

              // 从 Bash 输出中提取命令信息
              // 通常格式是: "Command completed" 或包含进程信息
              // 我们需要重新启动这个命令为后台进程
              this.startDevServerInBackground(content);

              return `${emoji} **Starting dev server in background...**\n查看 Terminal 标签页以查看输出`;
            }

            // 如果有终端回调且这是 Bash 输出，发送到终端
            if (this.terminalCallback && this.isBashOutput(content)) {
              this.terminalCallback(content);
              // 对于长时间运行的命令，只在聊天中显示简短提示
              if (content.length > 100 && this.isLongRunningCommand(content)) {
                return `${emoji} **Bash output** (查看 Terminal 标签页)`;
              }
            }

            // 限制内容长度
            const displayContent = content.length > 300
              ? content.substring(0, 300) + '...'
              : content;

            return `${emoji} **Result:**\n\`\`\`\n${displayContent}\n\`\`\``;
          }).join('\n\n');
        }
      }
      return null;
    }

    // 其他未知类型 - 返回 null，由调用方显示原始 JSON
    return null;
  }

  /**
   * 检查命令是否是开发服务器命令
   */
  private isDevServerCommand(command: string): boolean {
    const devServerPatterns = [
      /pnpm\s+dev/i,
      /npm\s+run\s+dev/i,
      /yarn\s+dev/i,
      /vite\b/i,
      /next\s+dev/i,
      /react-scripts\s+start/i
    ];

    return devServerPatterns.some(pattern => pattern.test(command));
  }

  /**
   * 在后台启动开发服务器
   */
  private async startDevServerInBackground(bashOutput: string): Promise<void> {
    try {
      console.log('[startDevServerInBackground] Bash output:', bashOutput);

      if (!this.terminalCreateCallback) {
        console.error('[startDevServerInBackground] No terminal create callback set!');
        return;
      }

      // 从项目目录启动 pnpm dev
      const { invoke } = await import('@tauri-apps/api/core');

      // 先预生成终端ID（使用时间戳和随机数）
      const terminalId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[startDevServerInBackground] Pre-generated terminal ID: ${terminalId}`);

      // 启动后台进程，传递终端ID（Rust会在获取PID后立即存储映射）
      const pid = await invoke<number>('start_background_process', {
        command: 'pnpm',
        args: ['dev'],
        cwd: this.projectDir!,
        terminalId: terminalId  // 传递预生成的ID
      });

      console.log(`[startDevServerInBackground] Process started with PID: ${pid}`);

      // 现在创建终端（此时进程已经在运行，并且映射已存储）
      // 传递预生成的terminalId，这样前后端使用的是同一个ID
      const terminalName = `pnpm dev (PID: ${pid})`;
      const createdTerminalId = this.terminalCreateCallback(terminalName, pid, terminalId);

      console.log(`[startDevServerInBackground] Created terminal: ${createdTerminalId}`);

      this.currentTerminalId = createdTerminalId;

      // 通知用户进程已启动
      if (this.progressCallback) {
        this.progressCallback(`🚀 **Dev server started in background** (PID: ${pid})\n\n查看 Terminal 标签页以查看输出`);
      }
    } catch (error) {
      console.error('[startDevServerInBackground] Failed:', error);
      if (this.progressCallback) {
        this.progressCallback(`❌ **Failed to start dev server in background**: ${error}`);
      }
    }
  }

  /**
   * 检查内容是否像 Bash 输出
   */
  private isBashOutput(content: string): boolean {
    // 检测典型的 Bash 输出特征
    const bashPatterns = [
      /VITE.*ready/i,
      /Local:.*http/i,
      /Network:.*http/i,
      /webpack.*compiled/i,
      /Starting development server/i,
      /Done in \d+ms/i,
      /Lockfile is up to date/i,
      /Already up to date/i
    ];

    return bashPatterns.some(pattern => pattern.test(content));
  }

  /**
   * 检查是否是长时间运行的命令输出
   */
  private isLongRunningCommand(content: string): boolean {
    const longRunningPatterns = [
      /ready in \d+ms/i,
      /Local:.*http/i,
      /dev server/i
    ];

    return longRunningPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Claude Code CLI 集成（使用 Tauri 后端的流式处理）
   * In web mode, uses AWS Bedrock API directly
   */
  private async sendToClaudeCLI(
    message: string,
    history: CLIMessage[]
  ): Promise<CLIResponse> {
    // Web mode: Use Bedrock API directly
    if (isWebMode()) {
      return this.sendToClaudeWeb(message, history);
    }

    try {
      const nodePath = await sidecarManager.getNodePath();
      const claudePath = await sidecarManager.getClaudePath();

      // Prepend app context to the message
      const enhancedMessage = this.getAppContextPrompt() + message;

      console.log('[Claude] Sending message:', enhancedMessage);
      console.log('[Claude] Using node:', nodePath);
      console.log('[Claude] Using claude:', claudePath);
      console.log('[Claude] Working directory:', this.projectDir);

      // Validate project directory exists and is accessible
      if (!this.projectDir || this.projectDir.trim() === '') {
        throw new Error('Project directory is not set or is empty');
      }

      // 动态导入 Tauri API
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // 构建命令参数（使用 -p 非交互模式 + stream-json + verbose 获得流式输出）
      const args = [
        '-p', enhancedMessage,  // -p 表示 prompt，非交互模式
        '--model', this.model,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', this.permissionMode,
        '--add-dir', this.projectDir!
      ];

      // Add provider flag if using Bedrock
      if (this.provider === 'bedrock') {
        args.push('--provider', 'bedrock');
        // Add Bedrock-specific environment variables will be handled by the backend
        console.log('[Claude] Using Bedrock provider, region:', this.bedrockRegion);
      }

      // Note: Claude CLI doesn't support --agent flag
      // Agent selection is for UI purposes only, not passed to CLI
      if (this.agent) {
        console.log('[Claude] Agent selected (UI only):', this.agent);
      }

      // Log the full command for debugging
      console.log('[Claude] Full command args:', JSON.stringify(args, null, 2));

      // 设置事件监听器来接收流式输出
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let completionResolver: ((value: boolean) => void) | null = null;

      console.log('[Claude] Setting up event listeners...');

      // 监听 stdout 流 - 必须在 invoke 之前设置
      const unlistenStdout = await listen<string>('claude-stream', (event) => {
        const data = event.payload;
        stdoutBuffer += data + '\n';
        console.log('[Claude] stream event received:', data.substring(0, 100));

        // 调用进度回调
        if (this.progressCallback && data.trim()) {
          try {
            const json = JSON.parse(data);
            console.log('[Claude] Parsed JSON type:', json.type, 'role:', json.role);

            // 格式化不同类型的事件
            const formatted = this.formatStreamEvent(json);
            console.log('[Claude] Formatted result:', formatted ? formatted.substring(0, 100) : 'null');

            if (formatted) {
              this.progressCallback(formatted);
            } else {
              // 对于无法格式化的事件，显示原始 JSON（用于调试）
              console.log('[Claude] Unable to format event, showing raw JSON');
              this.progressCallback(`📋 **Event:** ${json.type || 'unknown'}\n\`\`\`json\n${JSON.stringify(json, null, 2).substring(0, 500)}\n\`\`\``);
            }
          } catch (e) {
            // 不是 JSON，直接显示
            console.log('[Claude] Not JSON, displaying as text');
            if (data.length < 200) {
              this.progressCallback(data);
            }
          }
        }
      });

      console.log('[Claude] Stdout listener registered');

      // 监听 stderr 流
      const unlistenStderr = await listen<string>('claude-error', (event) => {
        const data = event.payload;
        stderrBuffer += data + '\n';
        console.error('[Claude] error event received:', data);

        if (this.progressCallback) {
          this.progressCallback(`❌ Error: ${data}`);
        }
      });

      console.log('[Claude] Stderr listener registered');

      // 监听完成事件
      const unlistenComplete = await listen<boolean>('claude-complete', (event) => {
        console.log('[Claude] Complete event received:', event.payload);
        if (completionResolver) {
          completionResolver(event.payload);
        }
      });

      console.log('[Claude] Complete listener registered');

      // 创建完成 Promise
      const completed = new Promise<boolean>((resolve) => {
        completionResolver = resolve;
      });

      console.log('[Claude] Invoking execute_claude_streaming...');

      // 调用 Rust 后端执行命令（不等待，因为它会立即返回）
      invoke('execute_claude_streaming', {
        nodePath,
        claudePath,
        args,
        cwd: this.projectDir!
      }).catch((error) => {
        console.error('[Claude] Invoke error:', error);
        if (completionResolver) {
          completionResolver(false);
        }
      });

      console.log('[Claude] Waiting for completion...');

      // 等待完成
      const success = await completed;

      console.log('[Claude] Execution completed:', success);

      // 清理监听器
      unlistenStdout();
      unlistenStderr();
      unlistenComplete();

      if (!success) {
        throw new Error(`Claude CLI failed: ${stderrBuffer || 'Unknown error'}`);
      }

      // 解析 JSON 输出的最后一行（最终结果）
      const lines = stdoutBuffer.trim().split('\n').filter(line => line.trim());
      const lastLine = lines[lines.length - 1];

      if (!lastLine) {
        throw new Error('No output received from Claude CLI');
      }

      let result: any;
      try {
        result = JSON.parse(lastLine);
      } catch (e) {
        console.error('[Claude] Failed to parse result:', lastLine);
        throw new Error('Failed to parse Claude CLI response');
      }

      console.log('[Claude] Parsed result:', JSON.stringify(result, null, 2));

      // Check for error subtypes
      if (result.subtype === 'error_during_execution') {
        const errorDetails = result.error || result.message || result.result || 'Unknown execution error';
        console.error('[Claude] Execution error details:', errorDetails);
        throw new Error(`Claude encountered an error during execution: ${errorDetails}`);
      }

      // Check if it's a direct error response
      if (result.is_error === true || result.type === 'error') {
        throw new Error(`Claude CLI error: ${result.error || result.message || result.result || 'Unknown error'}`);
      }

      // Update session statistics
      if (result.usage) {
        const inputTokens = result.usage.input_tokens || 0;
        const outputTokens = result.usage.output_tokens || 0;
        const cacheCreationTokens = result.usage.cache_creation_input_tokens || 0;
        const cacheReadTokens = result.usage.cache_read_input_tokens || 0;

        this.sessionStats.totalTokens += inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
        this.sessionStats.totalCost += result.total_cost_usd || 0;
        this.sessionStats.totalTurns += result.num_turns || 0;

        console.log('[Claude] Session stats updated:', this.sessionStats);
      }

      // Extract the actual response content
      const content = result.result || result.text || result.content || result.message || 'No response from Claude';

      // If content is still the raw JSON, something went wrong
      if (typeof content === 'object') {
        throw new Error(`Unexpected response format from Claude CLI. Check console for details.`);
      }

      return {
        content,
        code: this.extractCode(content)
      };
    } catch (error) {
      console.error('[Claude] Error:', error);
      throw new Error(`Claude CLI error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Claude Web Mode - Falls back to Gemini since AWS Bedrock doesn't support browser CORS
   */
  private async sendToClaudeWeb(
    message: string,
    history: CLIMessage[]
  ): Promise<CLIResponse> {
    console.log('[Claude Web] Web mode detected - using Gemini as backend (Bedrock has CORS restrictions)');

    // Notify user about the fallback
    if (this.progressCallback) {
      this.progressCallback('🔄 Web mode: Using Gemini API (Bedrock requires desktop app for direct access)...');
    }

    try {
      // Use Gemini as the backend for Claude in web mode
      // This provides the same code generation capabilities
      const response = await this.sendToGeminiCLI(message, history);

      if (this.progressCallback) {
        this.progressCallback('✅ Response received (via Gemini backend)');
      }

      return response;
    } catch (error) {
      console.error('[Claude Web] Gemini fallback error:', error);
      throw new Error(`Claude (web mode) error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Gemini CLI 集成（使用现有 API）
   */
  private async sendToGeminiCLI(
    message: string,
    history: CLIMessage[]
  ): Promise<CLIResponse> {
    // 将 CLIMessage[] 转换为 Gemini 历史格式
    const geminiHistory = history.map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }]
    }));

    const content = await sendMessageToGemini(message, geminiHistory);

    return {
      content,
      code: this.extractCode(content)
    };
  }

  /**
   * Codex CLI 集成（占位符）
   */
  private async sendToCodexCLI(
    message: string,
    history: CLIMessage[]
  ): Promise<CLIResponse> {
    if (isWebMode()) {
      throw new Error('Codex is not available in web mode. Please use Claude or Gemini.');
    }
    throw new Error('Codex CLI not implemented yet');
  }

  /**
   * 去除 ANSI 转义序列（终端控制符）
   */
  private stripAnsiCodes(str: string): string {
    // 匹配所有 ANSI 转义序列
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\|\x1b\[[\?]?[0-9;]*[hlmnpsu]/g, '')
              .replace(/\x1b\[\?25[lh]/g, '')  // 光标显示/隐藏
              .replace(/\x1b\[[\d;]*m/g, '')   // SGR (颜色等)
              .replace(/\x1b\[\d*[ABCDEFGJKST]/g, '')  // 光标移动
              .replace(/\x1b/g, '');  // 清除剩余的 ESC 字符
  }

  /**
   * Kiro CLI 集成
   */
  private async sendToKiroCLI(
    message: string,
    history: CLIMessage[]
  ): Promise<CLIResponse> {
    // Web mode: Kiro requires CLI
    if (isWebMode()) {
      throw new Error('Kiro is not available in web mode. Please use Claude or Gemini.');
    }

    try {
      // 动态导入 Tauri API
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // 获取 kiro-cli 路径
      const kiroPath = await invoke<string>('get_kiro_path');
      console.log('[Kiro] Using kiro-cli:', kiroPath);
      console.log('[Kiro] Working directory:', this.projectDir);

      // 构建命令参数
      // kiro-cli chat [OPTIONS] [INPUT]
      const args = [
        'chat',
        '--no-interactive',      // 非交互模式
        '--trust-all-tools',     // 允许工具执行
        message                   // prompt 作为最后一个参数
      ];

      console.log('[Kiro] Full command args:', JSON.stringify(args, null, 2));

      // 设置事件监听器来接收流式输出
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let completionResolver: ((value: boolean) => void) | null = null;

      console.log('[Kiro] Setting up event listeners...');

      // 监听 stdout 流 - 输出到聊天面板（终端样式）
      const unlistenStdout = await listen<string>('kiro-stream', (event) => {
        const rawData = event.payload;
        stdoutBuffer += rawData + '\n';
        console.log('[Kiro] stream event received:', rawData.substring(0, 100));

        // 保留原始数据（包含 ANSI 码），使用特殊前缀标记
        if (this.progressCallback && rawData.trim()) {
          // 使用 __TERMINAL__ 前缀标记这是终端输出
          this.progressCallback(`__TERMINAL__${rawData}`);
        }
      });

      // 监听 stderr 流 (kiro 可能把正常输出发到 stderr)
      const unlistenStderr = await listen<string>('kiro-error', (event) => {
        const rawData = event.payload;
        stderrBuffer += rawData + '\n';
        console.log('[Kiro] stderr event received:', rawData.substring(0, 100));

        // 保留原始数据（包含 ANSI 码），使用特殊前缀标记
        if (this.progressCallback && rawData.trim()) {
          // 使用 __TERMINAL__ 前缀标记这是终端输出
          this.progressCallback(`__TERMINAL__${rawData}`);
        }
      });

      // 监听完成事件
      const unlistenComplete = await listen<boolean>('kiro-complete', (event) => {
        console.log('[Kiro] Complete event received:', event.payload);
        if (completionResolver) {
          completionResolver(event.payload);
        }
      });

      // 创建完成 Promise
      const completed = new Promise<boolean>((resolve) => {
        completionResolver = resolve;
      });

      console.log('[Kiro] Invoking execute_kiro_streaming...');

      // 调用 Rust 后端执行命令
      invoke('execute_kiro_streaming', {
        kiroPath,
        args,
        cwd: this.projectDir!
      }).catch((error) => {
        console.error('[Kiro] Invoke error:', error);
        if (completionResolver) {
          completionResolver(false);
        }
      });

      console.log('[Kiro] Waiting for completion...');

      // 等待完成
      const success = await completed;

      console.log('[Kiro] Execution completed:', success);

      // 清理监听器
      unlistenStdout();
      unlistenStderr();
      unlistenComplete();

      if (!success) {
        throw new Error(`Kiro CLI failed: ${this.stripAnsiCodes(stderrBuffer) || 'Unknown error'}`);
      }

      // 合并 stdout 和 stderr（kiro 可能把输出发到 stderr）
      const combinedOutput = this.stripAnsiCodes((stdoutBuffer + stderrBuffer).trim());
      const content = combinedOutput || 'No response from Kiro';

      return {
        content,
        code: this.extractCode(content)
      };
    } catch (error) {
      console.error('[Kiro] Error:', error);
      throw new Error(`Kiro CLI error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 从响应中提取代码块
   */
  private extractCode(response: string): string | undefined {
    // 匹配 ```html ... ```
    const htmlMatch = response.match(/```html\n([\s\S]*?)\n```/);
    if (htmlMatch) return htmlMatch[1];

    // 匹配 ``` ... ```
    const genericMatch = response.match(/```\n([\s\S]*?)\n```/);
    if (genericMatch && genericMatch[1].trim().startsWith('<')) {
      return genericMatch[1];
    }

    return undefined;
  }
}

// 导出单例
export const cliRouter = new CLIRouter();
