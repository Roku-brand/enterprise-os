import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../db";
import { agents, projectAgents, projects, reports } from "../../db/schema";
import { authorizeMcpRequest, MCP_READ_SCOPE, MCP_WRITE_SCOPE, withMcpCors } from "../../lib/mcp-auth";

const readSecurity = [{ type: "oauth2", scopes: [MCP_READ_SCOPE] }];
const writeSecurity = [{ type: "oauth2", scopes: [MCP_WRITE_SCOPE] }];
const writeTools = new Set(["create_project", "assign_agents_to_project", "save_agent", "create_department_report", "update_report_status"]);

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
    name: "prepare_repository_edit", title: "配属AIのリポジトリ編集権限を確認",
    description: "AIエージェントが対象事業へ配属され、GitHub編集を許可されているか確認し、接続済みGitHubで作業するためのコンテキストを返します。実際の編集前に必ず呼び出してください。",
    inputSchema: { type: "object", properties: {
      projectId: { type: "string", description: "対象プロジェクトのID" },
      agentId: { type: "string", description: "作業するAIエージェントのID" },
      task: { type: "string", description: "予定している編集内容" },
    }, required: ["projectId", "agentId", "task"], additionalProperties: false }, securitySchemes: readSecurity,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "create_project", title: "事業プロジェクトを登録",
    description: "新しい事業プロジェクトを永続保存します。架空の進捗率や売上は登録しません。",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "事業名" }, summary: { type: "string", description: "目的や提供価値" },
      repositoryUrl: { type: "string", description: "https://github.com/ で始まるURL。未連携なら省略" },
      status: { type: "string", enum: ["未着手", "進行中", "保留", "完了"] }, agentIds: { type: "array", items: { type: "string" }, description: "事業チームへ配属するAIのID一覧" },
    }, required: ["name", "status"], additionalProperties: false }, securitySchemes: writeSecurity,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "assign_agents_to_project", title: "AIを事業チームへ配属",
    description: "既存プロジェクトの事業チームを、指定したAIエージェントの一覧へ更新します。空の一覧で全員を解除します。",
    inputSchema: { type: "object", properties: {
      projectId: { type: "string", description: "配属先プロジェクトのID" },
      agentIds: { type: "array", items: { type: "string" }, description: "配属するAIエージェントのID一覧" },
    }, required: ["projectId", "agentIds"], additionalProperties: false }, securitySchemes: writeSecurity,
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
function idList(value: unknown) { return Array.isArray(value) ? [...new Set(value.map((item) => clean(item, 80)).filter(Boolean))].slice(0, 50) : []; }
function repositoryName(url: string) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function ownerEmail() {
  const value = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  if (!value) throw new Error("APP_OWNER_EMAIL is not configured.");
  return value;
}

async function toolResult(name: string, args: Record<string, unknown>) {
  const db = await getDb();
  const owner = ownerEmail();

  if (name === "get_organization_dashboard") {
    const [projectRows, agentRows, reportRows, assignmentRows] = await Promise.all([
      db.select().from(projects).where(eq(projects.ownerEmail, owner)).orderBy(desc(projects.updatedAt)),
      db.select().from(agents).where(eq(agents.ownerEmail, owner)).orderBy(desc(agents.updatedAt)),
      db.select().from(reports).where(eq(reports.ownerEmail, owner)).orderBy(desc(reports.updatedAt)),
      db.select().from(projectAgents).where(eq(projectAgents.ownerEmail, owner)),
    ]);
    const projectsWithTeams = projectRows.map((project) => ({ ...project, agentIds: assignmentRows.filter((row) => row.projectId === project.id).map((row) => row.agentId) }));
    return textResult("登録済みの組織データを取得しました。未登録の数値は含みません。", { projects: projectsWithTeams, agents: agentRows, reports: reportRows });
  }
  if (name === "list_organization_agents") {
    const rows = await db.select().from(agents).where(eq(agents.ownerEmail, owner)).orderBy(desc(agents.updatedAt));
    return textResult(`${rows.length}件のエージェント設定を取得しました。`, { agents: rows });
  }
  if (name === "get_project_status") {
    const query = clean(args.query, 200);
    if (!query) return { isError: true, content: [{ type: "text", text: "検索語を入力してください。" }] };
    const rows = await db.select().from(projects).where(and(eq(projects.ownerEmail, owner), or(like(projects.name, `%${query}%`), like(projects.repositoryUrl, `%${query}%`)))).limit(20);
    const ids = new Set(rows.map((row) => row.id));
    const assignments = rows.length ? await db.select().from(projectAgents).where(eq(projectAgents.ownerEmail, owner)) : [];
    const withTeams = rows.map((project) => ({ ...project, agentIds: assignments.filter((row) => ids.has(row.projectId) && row.projectId === project.id).map((row) => row.agentId) }));
    return textResult(rows.length ? `${rows.length}件の事業が見つかりました。` : "一致する事業はありません。", { projects: withTeams });
  }
  if (name === "prepare_repository_edit") {
    const projectId = clean(args.projectId, 80); const agentId = clean(args.agentId, 80); const task = clean(args.task, 1000);
    if (!projectId || !agentId || !task) return { isError: true, content: [{ type: "text", text: "プロジェクト、AIエージェント、編集内容を指定してください。" }] };
    const [projectRows, agentRows, assignmentRows] = await Promise.all([
      db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, owner))).limit(1),
      db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.ownerEmail, owner))).limit(1),
      db.select().from(projectAgents).where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId), eq(projectAgents.ownerEmail, owner))).limit(1),
    ]);
    const project = projectRows[0]; const agent = agentRows[0];
    if (!project || !agent) return { isError: true, content: [{ type: "text", text: "指定した事業またはAIエージェントが見つかりません。" }] };
    if (!assignmentRows.length) return { isError: true, content: [{ type: "text", text: `${agent.name}は${project.name}へ配属されていません。先に事業チームへ配属してください。` }] };
    if (!agent.active) return { isError: true, content: [{ type: "text", text: `${agent.name}は停止中です。` }] };
    if (!agent.repositoryWriteEnabled) return { isError: true, content: [{ type: "text", text: `${agent.name}にはGitHub編集権限がありません。エージェント設定で許可してください。` }] };
    const repository = repositoryName(project.repositoryUrl);
    if (!repository) return { isError: true, content: [{ type: "text", text: `${project.name}に有効なGitHubリポジトリURLが登録されていません。` }] };
    return textResult(`${agent.name}の配属とGitHub編集権限を確認しました。接続済みGitHubで変更内容を確認し、ブランチとPRを使って作業してください。`, {
      authorized: true, repository, repositoryUrl: project.repositoryUrl, project: { id: project.id, name: project.name },
      agent: { id: agent.id, name: agent.name, role: agent.role, persona: agent.persona, reportingStyle: agent.reportingStyle }, task,
      guardrails: ["既定ブランチへ直接変更せず、作業ブランチを使用する", "変更内容を確認してからコミットする", "機密情報をコードへ保存しない"],
    });
  }
  if (name === "create_project") {
    const projectName = clean(args.name, 120);
    const status = clean(args.status, 20);
    const repositoryUrl = clean(args.repositoryUrl, 500);
    if (!projectName || !["未着手", "進行中", "保留", "完了"].includes(status)) return { isError: true, content: [{ type: "text", text: "事業名と有効な状態が必要です。" }] };
    if (repositoryUrl && !repositoryUrl.startsWith("https://github.com/")) return { isError: true, content: [{ type: "text", text: "GitHub URLは https://github.com/ から入力してください。" }] };
    const availableAgents = await db.select({ id: agents.id }).from(agents).where(eq(agents.ownerEmail, owner));
    const availableIds = new Set(availableAgents.map((agent) => agent.id));
    const agentIds = idList(args.agentIds).filter((id) => availableIds.has(id));
    const projectId = crypto.randomUUID();
    const [row] = await db.insert(projects).values({ id: projectId, ownerEmail: owner, name: projectName, summary: clean(args.summary), repositoryUrl, status, ownerAgentId: agentIds[0] ?? null }).returning();
    if (agentIds.length) await db.insert(projectAgents).values(agentIds.map((agentId) => ({ ownerEmail: owner, projectId, agentId })));
    return textResult("事業プロジェクトを登録しました。", { project: { ...row, agentIds } });
  }
  if (name === "assign_agents_to_project") {
    const projectId = clean(args.projectId, 80);
    const projectRows = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, owner))).limit(1);
    if (!projectRows.length) return { isError: true, content: [{ type: "text", text: "指定した事業が見つかりません。" }] };
    const availableAgents = await db.select({ id: agents.id }).from(agents).where(eq(agents.ownerEmail, owner));
    const availableIds = new Set(availableAgents.map((agent) => agent.id));
    const agentIds = idList(args.agentIds).filter((id) => availableIds.has(id));
    await db.delete(projectAgents).where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.ownerEmail, owner)));
    if (agentIds.length) await db.insert(projectAgents).values(agentIds.map((agentId) => ({ ownerEmail: owner, projectId, agentId })));
    await db.update(projects).set({ ownerAgentId: agentIds[0] ?? null, updatedAt: new Date().toISOString() }).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, owner)));
    return textResult(`${agentIds.length}名のAIを事業チームへ配属しました。`, { projectId, agentIds });
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
