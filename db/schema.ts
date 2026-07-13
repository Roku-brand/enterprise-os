import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  department: text("department").notNull(),
  persona: text("persona").notNull().default(""),
  reportingStyle: text("reporting_style").notNull().default("結論から簡潔に"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [index("agents_owner_email_idx").on(table.ownerEmail)]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  summary: text("summary").notNull().default(""),
  repositoryUrl: text("repository_url").notNull().default(""),
  status: text("status").notNull().default("未着手"),
  ownerAgentId: text("owner_agent_id"),
  ...timestamps,
}, (table) => [index("projects_owner_email_idx").on(table.ownerEmail)]);

export const projectAgents = sqliteTable("project_agents", {
  ownerEmail: text("owner_email").notNull(),
  projectId: text("project_id").notNull(),
  agentId: text("agent_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.agentId] }),
  index("project_agents_owner_email_idx").on(table.ownerEmail),
  index("project_agents_agent_id_idx").on(table.agentId),
]);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  department: text("department").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  status: text("status").notNull().default("要対応"),
  authorAgentId: text("author_agent_id"),
  ...timestamps,
}, (table) => [index("reports_owner_email_idx").on(table.ownerEmail)]);
