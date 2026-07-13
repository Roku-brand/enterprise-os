import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { agents, projectAgents, projects, reports } from "../../../db/schema";
import { configuredOwnerEmail, getChatGPTUser } from "../../chatgpt-auth";

const projectStatuses = new Set(["未着手", "進行中", "保留", "完了"]);
const reportStatuses = new Set(["要対応", "進行中", "完了"]);

type Entity = "agent" | "project" | "report";
type Payload = Record<string, unknown> & { entity?: Entity; id?: string };

function clean(value: unknown, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === "true";
}

function idList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clean(item, 80)).filter(Boolean))].slice(0, 50);
}

async function validAgentIds(db: Awaited<ReturnType<typeof getDb>>, ownerEmail: string, value: unknown) {
  const requested = idList(value);
  if (!requested.length) return [];
  const rows = await db.select({ id: agents.id }).from(agents).where(eq(agents.ownerEmail, ownerEmail));
  const allowed = new Set(rows.map((row) => row.id));
  return requested.filter((id) => allowed.has(id));
}

async function replaceProjectAgents(db: Awaited<ReturnType<typeof getDb>>, ownerEmail: string, projectId: string, value: unknown) {
  const agentIds = await validAgentIds(db, ownerEmail, value);
  await db.delete(projectAgents).where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.ownerEmail, ownerEmail)));
  if (agentIds.length) await db.insert(projectAgents).values(agentIds.map((agentId) => ({ ownerEmail, projectId, agentId })));
  return agentIds;
}

function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const migrationMissing = message.includes("no such table");
  return Response.json(
    { error: migrationMissing ? "データベースを準備しています。数分後に再読み込みしてください。" : "保存処理に失敗しました。" },
    { status: 500 },
  );
}

async function owner() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV === "development") return configuredOwnerEmail() || "preview@local";
  if (!user) return null;
  const expected = configuredOwnerEmail();
  if (expected && user.email.toLowerCase() !== expected) return null;
  return user.email.toLowerCase();
}

export async function GET() {
  const ownerEmail = await owner();
  if (!ownerEmail) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = await getDb();
    const [projectRows, agentRows, reportRows, assignmentRows] = await Promise.all([
      db.select().from(projects).where(eq(projects.ownerEmail, ownerEmail)).orderBy(desc(projects.updatedAt)),
      db.select().from(agents).where(eq(agents.ownerEmail, ownerEmail)).orderBy(desc(agents.updatedAt)),
      db.select().from(reports).where(eq(reports.ownerEmail, ownerEmail)).orderBy(desc(reports.updatedAt)),
      db.select().from(projectAgents).where(eq(projectAgents.ownerEmail, ownerEmail)),
    ]);
    const projectsWithTeams = projectRows.map((project) => ({
      ...project,
      agentIds: assignmentRows.filter((row) => row.projectId === project.id).map((row) => row.agentId),
    }));
    return Response.json({ projects: projectsWithTeams, agents: agentRows, reports: reportRows });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const ownerEmail = await owner();
  if (!ownerEmail) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = await request.json() as Payload;
    const id = crypto.randomUUID();
    const db = await getDb();

    if (payload.entity === "project") {
      const name = clean(payload.name, 120);
      const repositoryUrl = clean(payload.repositoryUrl, 500);
      if (!name) return Response.json({ error: "プロジェクト名は必須です。" }, { status: 400 });
      if (repositoryUrl && !repositoryUrl.startsWith("https://github.com/")) {
        return Response.json({ error: "GitHub URLは https://github.com/ から入力してください。" }, { status: 400 });
      }
      const status = clean(payload.status, 20);
      const selectedAgentIds = await validAgentIds(db, ownerEmail, payload.agentIds);
      const [row] = await db.insert(projects).values({
        id, ownerEmail, name, repositoryUrl, summary: clean(payload.summary),
        status: projectStatuses.has(status) ? status : "未着手",
        ownerAgentId: selectedAgentIds[0] ?? (clean(payload.ownerAgentId, 80) || null),
      }).returning();
      const agentIds = await replaceProjectAgents(db, ownerEmail, id, selectedAgentIds);
      return Response.json({ item: { ...row, agentIds } }, { status: 201 });
    }

    if (payload.entity === "agent") {
      const name = clean(payload.name, 80);
      const role = clean(payload.role, 120);
      const department = clean(payload.department, 80);
      if (!name || !role || !department) return Response.json({ error: "名前・役割・部署は必須です。" }, { status: 400 });
      const [row] = await db.insert(agents).values({
        id, ownerEmail, name, role, department,
        persona: clean(payload.persona),
        reportingStyle: clean(payload.reportingStyle, 120) || "結論から簡潔に",
        active: payload.active === undefined ? true : booleanValue(payload.active),
      }).returning();
      return Response.json({ item: row }, { status: 201 });
    }

    if (payload.entity === "report") {
      const department = clean(payload.department, 80);
      const title = clean(payload.title, 160);
      if (!department || !title) return Response.json({ error: "部署と件名は必須です。" }, { status: 400 });
      const status = clean(payload.status, 20);
      const [row] = await db.insert(reports).values({
        id, ownerEmail, department, title, body: clean(payload.body),
        status: reportStatuses.has(status) ? status : "要対応",
        authorAgentId: clean(payload.authorAgentId, 80) || null,
      }).returning();
      return Response.json({ item: row }, { status: 201 });
    }

    return Response.json({ error: "Unknown entity" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  const ownerEmail = await owner();
  if (!ownerEmail) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = await request.json() as Payload;
    const id = clean(payload.id, 80);
    if (!id) return Response.json({ error: "ID is required" }, { status: 400 });
    const db = await getDb();
    const updatedAt = new Date().toISOString();

    if (payload.entity === "project") {
      const name = clean(payload.name, 120);
      const repositoryUrl = clean(payload.repositoryUrl, 500);
      if (!name) return Response.json({ error: "プロジェクト名は必須です。" }, { status: 400 });
      if (repositoryUrl && !repositoryUrl.startsWith("https://github.com/")) return Response.json({ error: "GitHub URLを確認してください。" }, { status: 400 });
      const status = clean(payload.status, 20);
      const selectedAgentIds = await validAgentIds(db, ownerEmail, payload.agentIds);
      await db.update(projects).set({ name, repositoryUrl, summary: clean(payload.summary), status: projectStatuses.has(status) ? status : "未着手", ownerAgentId: selectedAgentIds[0] ?? null, updatedAt }).where(and(eq(projects.id, id), eq(projects.ownerEmail, ownerEmail)));
      await replaceProjectAgents(db, ownerEmail, id, selectedAgentIds);
    } else if (payload.entity === "agent") {
      const name = clean(payload.name, 80);
      const role = clean(payload.role, 120);
      const department = clean(payload.department, 80);
      if (!name || !role || !department) return Response.json({ error: "名前・役割・部署は必須です。" }, { status: 400 });
      await db.update(agents).set({ name, role, department, persona: clean(payload.persona), reportingStyle: clean(payload.reportingStyle, 120) || "結論から簡潔に", active: booleanValue(payload.active), updatedAt }).where(and(eq(agents.id, id), eq(agents.ownerEmail, ownerEmail)));
    } else if (payload.entity === "report") {
      const department = clean(payload.department, 80);
      const title = clean(payload.title, 160);
      const status = clean(payload.status, 20);
      if (!department || !title) return Response.json({ error: "部署と件名は必須です。" }, { status: 400 });
      await db.update(reports).set({ department, title, body: clean(payload.body), status: reportStatuses.has(status) ? status : "要対応", authorAgentId: clean(payload.authorAgentId, 80) || null, updatedAt }).where(and(eq(reports.id, id), eq(reports.ownerEmail, ownerEmail)));
    } else {
      return Response.json({ error: "Unknown entity" }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  const ownerEmail = await owner();
  if (!ownerEmail) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const entity = url.searchParams.get("entity") as Entity | null;
    const id = url.searchParams.get("id") ?? "";
    const db = await getDb();
    if (entity === "project") {
      await db.delete(projectAgents).where(and(eq(projectAgents.projectId, id), eq(projectAgents.ownerEmail, ownerEmail)));
      await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerEmail, ownerEmail)));
    } else if (entity === "agent") {
      await db.delete(projectAgents).where(and(eq(projectAgents.agentId, id), eq(projectAgents.ownerEmail, ownerEmail)));
      await db.delete(agents).where(and(eq(agents.id, id), eq(agents.ownerEmail, ownerEmail)));
    }
    else if (entity === "report") await db.delete(reports).where(and(eq(reports.id, id), eq(reports.ownerEmail, ownerEmail)));
    else return Response.json({ error: "Unknown entity" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
