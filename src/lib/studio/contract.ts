// The studio tool contract — shared by the in-app agent loop, the HTTP tool
// API (/api/tools) and the MCP server (mcp/loso-mcp.mjs).
//
// HTTP:
//   GET  /api/tools                     -> { tools: ToolInfo[] }
//   POST /api/tools/call                -> ToolCallResult
//        body { projectId?: string, name: string, args: object }
//
// Tools marked `interactive` (ask_user, propose_storyboard) only exist inside
// the in-app chat; external agents ask their own user instead. Tools marked
// `confirm` (cut, render) pause the in-app agent for an Approve click; over
// HTTP/MCP they run directly because the outer agent owns approval.

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (object)
  needsProject: boolean;
  interactive?: boolean;
  confirm?: boolean;
}

export interface ToolContentText {
  type: "text";
  text: string;
}
export interface ToolContentImage {
  type: "image";
  mimeType: string;
  data: string; // base64
}

export interface ToolCallResult {
  content: Array<ToolContentText | ToolContentImage>;
  isError?: boolean;
}
