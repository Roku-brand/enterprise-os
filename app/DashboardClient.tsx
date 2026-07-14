"use client";

import { useEffect, useMemo, useState } from "react";

type View = "home" | "projects" | "backoffice" | "agents";
type Entity = "project" | "agent" | "report";

type Project = {
  id: string; name: string; summary: string; repositoryUrl: string;
  status: string; ownerAgentId: string | null; agentIds: string[]; updatedAt: string;
};
type Agent = {
  id: string; name: string; role: string; department: string; persona: string;
  reportingStyle: string; active: boolean; repositoryWriteEnabled: boolean; updatedAt: string;
};
type Report = {
  id: string; department: string; title: string; body: string; status: string;
  authorAgentId: string | null; updatedAt: string;
};
type OrganizationData = { projects: Project[]; agents: Agent[]; reports: Report[] };
type ModalState = { entity: Entity; item?: Project | Agent | Report; department?: string } | null;

const departments = ["財務", "法務", "総務", "経営企画", "データ管理"];
const navItems: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "ホーム", icon: "⌂" },
  { id: "projects", label: "プロジェクト", icon: "▱" },
  { id: "backoffice", label: "バックオフィス", icon: "▦" },
  { id: "agents", label: "エージェント", icon: "✦" },
];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function agentName(agents: Agent[], id: string | null) {
  return agents.find((agent) => agent.id === id)?.name ?? "未設定";
}

function projectTeam(project: Project, agents: Agent[]) {
  const ids = project.agentIds?.length ? project.agentIds : project.ownerAgentId ? [project.ownerAgentId] : [];
  return ids.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is Agent => Boolean(agent));
}

function Empty({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><span>＋</span><h3>{title}</h3><p>{body}</p><button className="primary-btn" onClick={onAction}>{action}</button></div>;
}

function HomeView({ data, open }: { data: OrganizationData; open: (state: ModalState) => void }) {
  const recentReports = data.reports.slice(0, 5);
  const activeProjects = data.projects.filter((project) => project.status !== "完了").slice(0, 5);
  const activeAgents = data.agents.filter((agent) => agent.active);

  return <div className="workspace-stack">
    {data.projects.length === 0 && data.agents.length === 0 && data.reports.length === 0 && <section className="onboarding-panel">
      <div><small>はじめに</small><h2>実データを登録して、組織を動かす</h2><p>架空の数値は表示していません。現在の事業・担当AI・部署報告を登録すると、ここが日々の運用画面になります。</p></div>
      <div className="onboarding-actions">
        <button onClick={() => open({ entity: "project" })}><b>1</b><span><strong>事業を登録</strong><small>GitHubリポジトリと状態を管理</small></span></button>
        <button onClick={() => open({ entity: "agent" })}><b>2</b><span><strong>AIを登録</strong><small>名前・役割・人格を設定</small></span></button>
        <button onClick={() => open({ entity: "report" })}><b>3</b><span><strong>報告を記録</strong><small>判断事項と進捗を残す</small></span></button>
      </div>
    </section>}

    <section className="home-columns">
      <article className="panel operational-panel">
        <div className="panel-heading"><div><small>DEPARTMENT REPORTS</small><h2>部署からの報告</h2></div><button className="outline-btn" onClick={() => open({ entity: "report" })}>＋ 報告を追加</button></div>
        {recentReports.length ? <div className="report-feed">{recentReports.map((report) => <button key={report.id} onClick={() => open({ entity: "report", item: report })}>
          <span className={`state-dot state-${report.status}`}/><span><b>{report.department} · {report.title}</b><small>{report.body || "本文なし"}</small></span><em>{report.status}<small>{formatDate(report.updatedAt)}</small></em>
        </button>)}</div> : <Empty title="まだ報告はありません" body="財務・法務・総務などの判断事項を記録できます。" action="最初の報告を追加" onAction={() => open({ entity: "report" })}/>}
      </article>

      <article className="panel operational-panel">
        <div className="panel-heading"><div><small>ACTIVE PROJECTS</small><h2>進行中の事業</h2></div><button className="outline-btn" onClick={() => open({ entity: "project" })}>＋ 事業を追加</button></div>
        {activeProjects.length ? <div className="compact-list">{activeProjects.map((project) => <button key={project.id} onClick={() => open({ entity: "project", item: project })}>
          <span><b>{project.name}</b><small>{projectTeam(project, data.agents).length ? `${projectTeam(project, data.agents).length}名のAIチーム` : project.summary || "説明未登録"}</small></span><em className={`status-tag status-${project.status}`}>{project.status}</em>
        </button>)}</div> : <Empty title="進行中の事業はありません" body="実際に運営している事業とGitHubリポジトリを登録してください。" action="事業を追加" onAction={() => open({ entity: "project" })}/>}
      </article>
    </section>

    <section className="panel org-live">
      <div className="panel-heading"><div><small>ORGANIZATION</small><h2>組織図</h2></div><span className="truth-label">登録済みデータのみ表示</span></div>
      <div className="owner-node"><b>CEO</b><small>あなた</small></div>
      {activeAgents.length ? <div className="org-agent-grid">{activeAgents.map((agent) => <button key={agent.id} onClick={() => open({ entity: "agent", item: agent })}><span>{agent.name.slice(0, 1)}</span><b>{agent.name}</b><small>{agent.role}</small><em>{agent.department}</em></button>)}</div> : <p className="inline-empty">稼働するAIエージェントはまだ登録されていません。</p>}
    </section>
  </div>;
}

function ProjectsView({ data, open, remove }: { data: OrganizationData; open: (state: ModalState) => void; remove: (entity: Entity, id: string) => void }) {
  return <section className="view-section"><div className="section-intro"><div><p>BUSINESS PORTFOLIO</p><h2>事業プロジェクト</h2><span>実際の事業とGitHubリポジトリを一元管理します。</span></div><button className="primary-btn" onClick={() => open({ entity: "project" })}>＋ 新規プロジェクト</button></div>
    {data.projects.length ? <div className="record-grid">{data.projects.map((project) => <article className="record-card" key={project.id}>
      <div className="record-top"><span className="record-icon">{project.name.slice(0, 1)}</span><span className={`status-tag status-${project.status}`}>{project.status}</span></div>
      <h3>{project.name}</h3><p>{project.summary || "説明はまだ登録されていません。"}</p>
      <div className="project-team"><small>事業チーム</small>{projectTeam(project, data.agents).length ? <div>{projectTeam(project, data.agents).map((agent) => <span key={agent.id} title={`${agent.role}・${agent.department}`}><b>{agent.name.slice(0, 1)}</b>{agent.name}</span>)}</div> : <p>AIエージェント未配属</p>}</div>
      <dl><div><dt>配属人数</dt><dd>{projectTeam(project, data.agents).length}名</dd></div><div><dt>最終更新</dt><dd>{formatDate(project.updatedAt)}</dd></div></dl>
      {project.repositoryUrl ? <a className="repo-link" href={project.repositoryUrl} target="_blank" rel="noreferrer">GitHubを開く ↗</a> : <span className="repo-missing">GitHub未連携</span>}
      <div className="card-actions"><button className="outline-btn" onClick={() => open({ entity: "project", item: project })}>編集</button><button className="danger-btn" onClick={() => remove("project", project.id)}>削除</button></div>
    </article>)}</div> : <Empty title="事業が登録されていません" body="売上などの架空データは置かず、登録した事業だけを表示します。" action="最初の事業を追加" onAction={() => open({ entity: "project" })}/>}
  </section>;
}

function BackOfficeView({ data, open, remove }: { data: OrganizationData; open: (state: ModalState) => void; remove: (entity: Entity, id: string) => void }) {
  return <section className="view-section"><div className="section-intro"><div><p>SHARED OPERATIONS</p><h2>総合バックオフィス</h2><span>部署ごとの報告・論点・対応状況を記録します。</span></div><button className="primary-btn" onClick={() => open({ entity: "report" })}>＋ 報告を追加</button></div>
    <div className="department-grid">{departments.map((department) => {
      const rows = data.reports.filter((report) => report.department === department);
      return <article className="department-card" key={department}><div className="department-head"><div><span>{department.slice(0, 1)}</span><h3>{department}</h3></div><button onClick={() => open({ entity: "report", department })}>＋ 追加</button></div>
        {rows.length ? <div className="department-reports">{rows.slice(0, 4).map((report) => <div key={report.id}><button onClick={() => open({ entity: "report", item: report })}><b>{report.title}</b><small>{report.body || "本文なし"}</small></button><span>{report.status}</span><button aria-label="削除" onClick={() => remove("report", report.id)}>×</button></div>)}</div> : <p className="department-empty">報告はまだありません。</p>}
      </article>;
    })}</div>
  </section>;
}

function AgentsView({ data, open, remove }: { data: OrganizationData; open: (state: ModalState) => void; remove: (entity: Entity, id: string) => void }) {
  return <section className="view-section"><div className="section-intro"><div><p>AI WORKFORCE</p><h2>エージェント設定</h2><span>名前・役割・人格・報告スタイルを実運用に合わせて保存します。</span></div><button className="primary-btn" onClick={() => open({ entity: "agent" })}>＋ エージェントを追加</button></div>
    {data.agents.length ? <div className="record-grid agent-record-grid">{data.agents.map((agent) => <article className="record-card agent-record" key={agent.id}>
      <div className="agent-identity"><span>{agent.name.slice(0, 1)}</span><div><small>{agent.department}</small><h3>{agent.name}</h3><b>{agent.role}</b></div><em className={agent.active ? "active-label" : "paused-label"}>{agent.active ? "稼働" : "停止"}</em></div>
      <p>{agent.persona || "人格・行動原則は未設定です。"}</p><dl><div><dt>配属先</dt><dd>{data.projects.filter((project) => projectTeam(project, [agent]).length).map((project) => project.name).join("、") || "未配属"}</dd></div><div><dt>GitHub</dt><dd className={agent.repositoryWriteEnabled ? "permission-on" : "permission-off"}>{agent.repositoryWriteEnabled ? "編集許可" : "参照のみ"}</dd></div><div><dt>報告スタイル</dt><dd>{agent.reportingStyle}</dd></div></dl>
      <div className="card-actions"><button className="outline-btn" onClick={() => open({ entity: "agent", item: agent })}>設定を編集</button><button className="danger-btn" onClick={() => remove("agent", agent.id)}>削除</button></div>
    </article>)}</div> : <Empty title="AIエージェントがいません" body="実際に使う役割だけを登録し、不要な架空メンバーは表示しません。" action="最初のAIを追加" onAction={() => open({ entity: "agent" })}/>}
  </section>;
}

function EntityModal({ state, data, close, saved }: { state: NonNullable<ModalState>; data: OrganizationData; close: () => void; saved: () => void }) {
  const item = state.item as Record<string, unknown> | undefined;
  const [form, setForm] = useState<Record<string, unknown>>(() => ({
    ...(item ?? {}), entity: state.entity,
    department: item?.department ?? state.department ?? (state.entity === "agent" ? "経営企画" : "財務"),
    status: item?.status ?? (state.entity === "project" ? "未着手" : "要対応"),
    reportingStyle: item?.reportingStyle ?? "結論から簡潔に",
    active: item?.active ?? true,
    agentIds: item?.agentIds ?? (item?.ownerAgentId ? [item.ownerAgentId] : []),
    projectIds: state.entity === "agent" && item?.id ? data.projects.filter((project) => projectTeam(project, data.agents).some((agent) => agent.id === item.id)).map((project) => project.id) : [],
    repositoryWriteEnabled: item?.repositoryWriteEnabled ?? false,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));
  const selectedAgentIds = Array.isArray(form.agentIds) ? form.agentIds.filter((id): id is string => typeof id === "string") : [];
  const selectedProjectIds = Array.isArray(form.projectIds) ? form.projectIds.filter((id): id is string => typeof id === "string") : [];
  const toggleAgent = (id: string) => set("agentIds", selectedAgentIds.includes(id) ? selectedAgentIds.filter((current) => current !== id) : [...selectedAgentIds, id]);
  const toggleProject = (id: string) => set("projectIds", selectedProjectIds.includes(id) ? selectedProjectIds.filter((current) => current !== id) : [...selectedProjectIds, id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/organization", { method: item ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "保存できませんでした。"); setBusy(false); return; }
    await saved(); close();
  }

  const title = state.entity === "project" ? "事業プロジェクト" : state.entity === "agent" ? "AIエージェント" : "部署報告";
  return <div className="modal-backdrop" onMouseDown={close}><form className="entity-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={close}>×</button><small className="modal-kicker">{item ? "EDIT" : "CREATE"}</small><h2>{title}{item ? "を編集" : "を追加"}</h2>
    {state.entity === "project" && <>
      <label>プロジェクト名<input required value={String(form.name ?? "")} onChange={(e) => set("name", e.target.value)}/></label>
      <label>説明<textarea value={String(form.summary ?? "")} onChange={(e) => set("summary", e.target.value)} placeholder="目的、提供価値、現在の論点"/></label>
      <label>GitHub URL<input value={String(form.repositoryUrl ?? "")} onChange={(e) => set("repositoryUrl", e.target.value)} placeholder="https://github.com/owner/repository"/></label>
      <div className="form-row"><label>状態<select value={String(form.status)} onChange={(e) => set("status", e.target.value)}>{["未着手", "進行中", "保留", "完了"].map((value) => <option key={value}>{value}</option>)}</select></label><div className="team-count"><small>配属人数</small><b>{selectedAgentIds.length}名</b></div></div>
      <fieldset className="agent-picker"><legend>事業チームに配属するAI</legend>{data.agents.length ? <div>{data.agents.map((agent) => <label key={agent.id} className={selectedAgentIds.includes(agent.id) ? "selected" : ""}><input type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)}/><span>{agent.name.slice(0, 1)}</span><b>{agent.name}<small>{agent.role} · {agent.department}</small></b></label>)}</div> : <p>先に「エージェント」からAIを登録してください。</p>}</fieldset>
    </>}
    {state.entity === "agent" && <>
      <div className="form-row"><label>名前<input required value={String(form.name ?? "")} onChange={(e) => set("name", e.target.value)}/></label><label>所属部署<select value={String(form.department)} onChange={(e) => set("department", e.target.value)}>{[...departments, "プロダクト", "事業チーム"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
      <fieldset className="project-picker"><legend>所属する事業（複数選択可）</legend>{data.projects.length ? <div>{data.projects.map((project) => <label key={project.id} className={selectedProjectIds.includes(project.id) ? "selected" : ""}><input type="checkbox" checked={selectedProjectIds.includes(project.id)} onChange={() => toggleProject(project.id)}/><span>{project.name.slice(0, 1)}</span><b>{project.name}<small>{project.repositoryUrl ? "GitHub連携済み" : "GitHub未連携"}</small></b></label>)}</div> : <p>先に「プロジェクト」から事業を登録してください。</p>}</fieldset>
      <label>役割<input required value={String(form.role ?? "")} onChange={(e) => set("role", e.target.value)} placeholder="例：CFOエージェント"/></label>
      <label>人格・行動原則<textarea value={String(form.persona ?? "")} onChange={(e) => set("persona", e.target.value)} placeholder="判断基準、口調、避ける行動"/></label>
      <label>報告スタイル<select value={String(form.reportingStyle)} onChange={(e) => set("reportingStyle", e.target.value)}><option>結論から簡潔に</option><option>根拠とリスクを添える</option><option>対話しながら提案する</option><option>選択肢を比較して示す</option></select></label>
      <label className="check-label"><input type="checkbox" checked={Boolean(form.active)} onChange={(e) => set("active", e.target.checked)}/>稼働中として表示する</label>
      <label className="check-label permission-check"><input type="checkbox" checked={Boolean(form.repositoryWriteEnabled)} onChange={(e) => set("repositoryWriteEnabled", e.target.checked)}/>配属先のGitHubリポジトリ編集を許可する</label>
      {Boolean(form.repositoryWriteEnabled) && <p className="permission-note">ChatGPTは配属先と権限を確認してから、接続済みGitHubを通じて編集します。</p>}
    </>}
    {state.entity === "report" && <>
      <div className="form-row"><label>部署<select value={String(form.department)} onChange={(e) => set("department", e.target.value)}>{departments.map((value) => <option key={value}>{value}</option>)}</select></label><label>状態<select value={String(form.status)} onChange={(e) => set("status", e.target.value)}>{["要対応", "進行中", "完了"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
      <label>件名<input required value={String(form.title ?? "")} onChange={(e) => set("title", e.target.value)} placeholder="意思決定や対応事項が分かる件名"/></label>
      <label>報告内容<textarea value={String(form.body ?? "")} onChange={(e) => set("body", e.target.value)} placeholder="事実、判断、次のアクション"/></label>
      <label>担当AI<select value={String(form.authorAgentId ?? "")} onChange={(e) => set("authorAgentId", e.target.value)}><option value="">未設定</option>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
    </>}
    {error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="outline-btn" onClick={close}>キャンセル</button><button className="primary-btn" disabled={busy}>{busy ? "保存中…" : "保存する"}</button></div>
  </form></div>;
}

export default function DashboardClient({ ownerName }: { ownerName: string }) {
  const [view, setView] = useState<View>("home");
  const [data, setData] = useState<OrganizationData | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const endpoint = typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`;
  const today = useMemo(() => new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(new Date()), []);

  async function load() {
    const response = await fetch("/api/organization", { cache: "no-store" });
    const result = await response.json() as OrganizationData & { error?: string };
    if (!response.ok) { setError(result.error ?? "データを読み込めませんでした。"); return; }
    setData(result); setError("");
  }
  useEffect(() => {
    let active = true;
    fetch("/api/organization", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as OrganizationData & { error?: string } }))
      .then(({ response, result }) => {
        if (!active) return;
        if (!response.ok) setError(result.error ?? "データを読み込めませんでした。");
        else { setData(result); setError(""); }
      })
      .catch(() => { if (active) setError("データを読み込めませんでした。"); });
    return () => { active = false; };
  }, []);

  async function remove(entity: Entity, id: string) {
    if (!window.confirm("このデータを削除しますか？")) return;
    const response = await fetch(`/api/organization?entity=${entity}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { setError("削除できませんでした。"); return; }
    await load();
  }

  const titles: Record<View, string> = { home: "組織ホーム", projects: "プロジェクト", backoffice: "バックオフィス", agents: "エージェント" };
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span>組</span><div><b>AI 組織 OS</b><small>OPERATIONS</small></div></div><nav>{navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span><b>{item.label}</b></button>)}</nav><div className="sidebar-foot"><div className="owner-avatar">{ownerName.slice(0, 1)}</div><div><b>{ownerName}</b><small>組織オーナー</small></div><a href="/signout-with-chatgpt?return_to=/" aria-label="サインアウト">↗</a></div></aside>
    <main className="main"><header><div><h1>{titles[view]}</h1><p>登録された事実だけで、次の行動を決める。</p></div><div className="header-actions"><span>{today}</span><button className="command" onClick={() => setConnectorOpen(true)}>✦ <span>ChatGPT接続</span></button></div></header>
      <div className="content">{error && <div className="error-banner">{error}<button onClick={() => void load()}>再読み込み</button></div>}{!data ? <div className="loading-state">組織データを読み込んでいます…</div> : <>{view === "home" && <HomeView data={data} open={setModal}/>} {view === "projects" && <ProjectsView data={data} open={setModal} remove={remove}/>} {view === "backoffice" && <BackOfficeView data={data} open={setModal} remove={remove}/>} {view === "agents" && <AgentsView data={data} open={setModal} remove={remove}/>}</>}</div>
      <footer><span>AI 組織 OS</span><span>データ保存 <b>● 有効</b></span></footer>
    </main>
    {modal && data && <EntityModal key={`${modal.entity}-${(modal.item as { id?: string })?.id ?? "new"}-${modal.department ?? ""}`} state={modal} data={data} close={() => setModal(null)} saved={load}/>}
    {connectorOpen && <div className="modal-backdrop" onMouseDown={() => setConnectorOpen(false)}><section className="entity-modal connector-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setConnectorOpen(false)}>×</button><small className="modal-kicker">CHATGPT CONNECTOR</small><h2>ChatGPTから実データを扱う</h2><p className="connector-lead">登録したプロジェクト、エージェント、部署報告をChatGPTから確認・追加できます。</p><div className="endpoint-box"><small>MCP SERVER URL</small><code>{endpoint}</code></div><div className="tool-preview"><b>利用例</b><span>「現在の事業と未完了の報告をまとめて」</span><span>「新しい事業プロジェクトを登録して」</span><span>「財務部門の報告を記録して」</span></div><button className="primary-btn full-btn" onClick={() => setConnectorOpen(false)}>閉じる</button></section></div>}
  </div>;
}
