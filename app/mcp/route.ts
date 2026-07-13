import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../db";
import { agents, projects, reports } from "../../db/schema";
import { authorizeMcpRequest, MCP_READ_SCOPE, MCP_WRITE_SCOPE, withMcpCors } from "../../lib/mcp-auth";

const readSecurity = [{ type: "oauth2", scopes: [MCP_READ_SCOPE] }];
const writeSecurity = [{ type: "oauth2", scopes: [MCP_WRITE_SCOPE] }];
const writeTools = new Set(["create_project", "save_agent", "create_department_report", "update_report_status"]);

const tools = [
  {
    name: "get_organization_dashboard", title: "組織の運用状況を取得",
    description: "登録済みの事業、AIエージェント、部署報告を取得します。未登録の数値や推測値は返しません。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, securitySchemes: readSecurity,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "list_organization_agents", title: "エージェント設定を取得",
    description: "保存されているAIエージェントの名前、役割、部署、人格、報告スタイル、稼働状態を取得します。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, securitySchemes: readSecurity,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "get_project_status", title: "事業プロジェクトを検索",
    description: "登録済みの事業名またはGitHub URLからプロジェクトを検索します。",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "事業名またはGitHub URLの一部" } }, required: ["query"], additionalProperties: false }, securitySchemes: readSecurity,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "create_project", title: "事業プロジェクトを登録",
    description: "新しい事業プロジェクトを永続保存します。架空の進捗率や売上は登録しません。",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "事業名" }, summary: { type: "string", description: "目的や提供価値" },
      repositoryUrl: { type: "string", description: "https://github.com/ で始まるURL。未連携なら省略" },
      status: { type: "string", enum: ["未着手", "進行中", "保留", "完了"] }, ownerAgentId: { type: "string", description: "担当AIのID。未設定なら省略" },
    }, required: ["name", "status"], additionalProperties: false }, securitySchemes: writeSecurity,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "save_agent", title: "AIエージェントを登録",
    description: "AIエージェントの名前、人格、役割、部署、報告スタイルを永続保存します。",
    inputSchema: { type: "object", properties: {
      name: { type: "string" }, role: { type: "string" }, department: { type: "string" }, persona: { type: "string" },
      reportingStyle: { type: "string" }, active: { type: "boolean" },
    }, required: ["name", "role", "department"], additionalProperties: false }, securitySchemes: writeSecurity,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "create_department_report", title: "部署報告を記録",
    description: "財務・法務・総務・経営企画・データ管理の報告を永続保存します。事実、判断、次の行動を本文に含めてください。",
    inputSchema: { type: "object", properties: {
      department: { type: "string", enum: ["財務", "法務", "総務", "経営企画", "データ管理"] },
      title: { type: "string" }, body: { type: "string" }, status: { type: "string", enum: ["要対応", "進行中", "完了"] },
      authorAgentId: { type: "string", description: "担当AIのID。未設定なら省略" },
    }, required: ["department", "title", "status"], additionalProperties: false }, securitySchemes: writeSecurity,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "update_report_status", title: "部署報告の状態を更新",
    description: "指定した部署報告の状態を、要対応・進行中・完了のいずれかへ更新します。",
    inputSchema: { type: "object", properties: { reportId: { type: "string" }, status: { type: "string", enum: ["要対応", "進行中", "完了"] } }, required: ["reportId", "status"], additionalProperties: false }, securitySchemes: writeSecurity,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

function corsHeaders() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version", "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate" }; }
function jsonRpc(id: unknown, result: unknown, status = 200) { return Response.json({ jsonrpc: "2.0", id, result }, { status, headers: corsHeaders() }); }
function rpcError(id: unknown, code: number, message: string, status = 200) { return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: corsHeaders() }); }
function textResult(text: string, structuredContent: unknown) { return { content: [{ type: "text", text }], structuredContent }; }
function clean(value: unknown, max = 4000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

function ownerEmail() {
  const value = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  if (!value) throw new Error("APP_OWNER_EMAIL is not configured.");
  return value;
}

async function toolResult(name: string, args: Record<string, unknown>) {
  const db = await getDb();
  const owner = ownerEmail();

  if (name === "get_organization_dashboard") {
    const [projectRows, agentRows, reportRows] = await Promise.all([
      db.select().from(projects).where(eq(projects.ownerEmail, owner)).orderBy(desc(projects.updatedAt)),
      db.select().from(agents).where(eq(agents.ownerEmail, owner)).orderBy(desc(agents.updatedAt)),
      db.select().from(reports).where(eq(reports.ownerEmail, owner)).orderBy(desc(reports.updatedAt)),
    ]);
    return textResult("登録済みの組織データを取得しました。未登録の数値は含みません。", { projects: projectRows, agents: agentRows, reports: reportRows });
  }
  if (name === "list_organization_agents") {
    const rows = await db.select().from(agents).where(eq(agents.ownerEmail, owner)).orderBy(desc(agents.updatedAt));
    return textResult(`${rows.length}件のエージェント設定を取得しました。`, { agents: rows });
  }
  if (name === "get_project_status") {
    const query = clean(args.query, 200);
    if (!query) return { isError: true, content: [{ type: "text", text: "検索語を入力してください。" }] };
    const rows = await db.select().from(projects).where(and(eq(projects.ownerEmail, owner), or(like(projects.name, `%${query}%`), like(projects.repositoryUrl, `%${query}%`)))).limit(20);
    return textResult(rows.length ? `${rows.length}件の事業が見つかりました。` : "一致する事業はありません。", { projects: rows });
  }
  if (name === "create_project") {
    const projectName = clean(args.name, 120);
    const status = clean(args.status, 20);
    const repositoryUrl = clean(args.repositoryUrl, 500);
    if (!projectName || !["未着手", "進行中", "保留", "完了"].includes(status)) return { isError: true, content: [{ type: "text", text: "事業名と有効な状態が必要です。" }] };
    if (repositoryUrl && !repositoryUrl.startsWith("https://github.com/")) return { isError: true, content: [{ type: "text", text: "GitHub URLは https://github.com/ から入力してください。" }] };
    const [row] = await db.insert(projects).values({ id: crypto.randomUUID(), ownerEmail: owner, name: projectName, summary: clean(args.summary), repositoryUrl, status, ownerAgentId: clean(args.ownerAgentId, 80) || null }).returning();
    return textResult("事業プロジェクトを登録しました。", { project: row });
  }
  if (name === "save_agent") {
    const agentName = clean(args.name, 80); const role = clean(args.role, 120); const department = clean(args.department, 80);
    if (!agentName || !role || !department) return { isError: true, content: [{ type: "text", text: "名前・役割・部署は必須です。" }] };
    const [row] = await db.insert(agents).values({ id: crypto.randomUUID(), ownerEmail: owner, name: agentName, role, department, persona: clean(args.persona), reportingStyle: clean(args.reportingStyle, 120) || "結論から簡潔に", active: args.active === undefined ? true : args.active === true }).returning();
    return textResult("AIエージェントを登録しました。", { agent: row });
  }
  if (name === "create_department_report") {
    const department = clean(args.department, 80); const title = clean(args.title, 160); const status = clean(args.status, 20);
    if (!department || !title || !["要対応", "進行中", "完了"].includes(status)) return { isError: true, content: [{ type: "text", text: "部署・件名・有効な状態が必要です。" }] };
    const [row] = await db.insert(reports).values({ id: crypto.randomUUID(), ownerEmail: owner, department, title, body: clean(args.body), status, authorAgentId: clean(args.authorAgentId, 80) || null }).returning();
    return textResult("部署報告を記録しました。", { report: row });
  }
  if (name === "update_report_status") {
    const reportId = clean(args.reportId, 80); const status = clean(args.status, 20);
    if (!reportId || !["要対応", "進行中", "完了"].includes(status)) return { isError: true, content: [{ type: "text", text: "報告IDと有効な状態が必要です。" }] };
    await db.update(reports).set({ status, updatedAt: new Date().toISOString() }).where(and(eq(reports.id, reportId), eq(reports.ownerEmail, owner)));
    return textResult("部署報告の状態を更新しました。", { reportId, status });
  }
  return null;
}

export async function POST(request: Request) {
  const readAuthorization = await authorizeMcpRequest(request, [MCP_READ_SCOPE]);
  if (!readAuthorization.ok) return withMcpCors(readAuthorization.response);

  let body: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try { body = await request.json(); } catch { return rpcError(null, -32700, "Parse error", 400); }
  const { id = null, method, params = {} } = body;
  if (method === "initialize") {
    const protocolVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    return jsonRpc(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "solo-ai-organization", title: "AI 組織 OS", version: "1.1.0" }, instructions: "登録済みの事実だけを扱い、未登録の売上・経費・視聴数・進捗率を推測しないでください。更新前には内容を復唱してください。" });
  }
  if (method === "notifications/initialized") return new Response(null, { status: 202, headers: corsHeaders() });
  if (method === "ping") return jsonRpc(id, {});
  if (method === "tools/list") return jsonRpc(id, { tools });
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (writeTools.has(name)) {
      const writeAuthorization = await authorizeMcpRequest(request, [MCP_WRITE_SCOPE]);
      if (!writeAuthorization.ok) return withMcpCors(writeAuthorization.response);
    }
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
    try {
      const result = await toolResult(name, args);
      return result ? jsonRpc(id, result) : rpcError(id, -32602, `Unknown tool: ${name}`);
    } catch {
      return rpcError(id, -32603, "組織データの処理に失敗しました。", 500);
    }
  }
  return rpcError(id, -32601, `Method not found: ${method ?? "unknown"}`);
}

export async function GET(request: Request) {
  const authorization = await authorizeMcpRequest(request, [MCP_READ_SCOPE]);
  if (!authorization.ok) return withMcpCors(authorization.response);
  return Response.json({ name: "AI 組織 OS MCP Server", version: "1.1.0", status: "ready", tools: tools.map((tool) => tool.name) }, { headers: corsHeaders() });
}
export function OPTIONS() { return new Response(null, { status: 204, headers: corsHeaders() }); }
export async function DELETE(request: Request) {
  const authorization = await authorizeMcpRequest(request, [MCP_READ_SCOPE]);
  if (!authorization.ok) return withMcpCors(authorization.response);
  return new Response(null, { status: 204, headers: corsHeaders() });
}
