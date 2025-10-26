import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * MCP Test Client for integration testing
 */
export class MCPTestClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
  }

  /**
   * Connect to the MCP server
   */
  async connect(serverPath: string): Promise<void> {
    this.transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
    });

    await this.client.connect(this.transport);
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.client.close();
      this.transport = null;
    }
  }

  /**
   * List all available tools
   */
  async listTools() {
    return this.client.listTools();
  }

  /**
   * Call a tool
   */
  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool({ name, arguments: args });
  }

  /**
   * Helper to extract text content from tool result
   */
  getTextContent(result: unknown): string {
    const res = result as { content?: Array<{ type?: string; text?: string }> };
    if (!res.content) return '';
    const textContent = res.content.find((c) => c.type === 'text');
    return textContent && 'text' in textContent ? textContent.text || '' : '';
  }

  /**
   * Check if tool call was successful
   * A tool call is considered successful if:
   * 1. It has content (meaning it returned a response)
   * 2. It doesn't contain error markers
   */
  isSuccess(result: unknown): boolean {
    const res = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

    // If explicitly marked as error, it's not a success
    if (res.isError) return false;

    // If no content, it's not a success
    if (!res.content || res.content.length === 0) return false;

    const text = this.getTextContent(result);

    // If text contains error markers, it's not a success
    if (text.includes('❌') || text.toLowerCase().includes('error:') || text.toLowerCase().includes('failed')) {
      return false;
    }

    // Otherwise, having content means success
    return text.length > 0;
  }

  /**
   * Check if tool call failed
   */
  isFailure(result: unknown): boolean {
    const text = this.getTextContent(result);
    return text.includes('❌') || text.includes('Failed');
  }
}
