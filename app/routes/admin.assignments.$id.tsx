import { Link } from "react-router";
import type { Route } from "./+types/admin.assignments.$id";
import { eq } from "drizzle-orm";
import { assignments, submissionFiles, submissions, teamMembers, teams, users } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { fmtKST } from "~/lib/time";
import { IconArrowLeft } from "~/components/icons";
import { Badge, Card, EmptyState, formatBytes } from "~/components/ui";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, params.id!)).limit(1);
  if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

  const rows = await db
    .select({
      submission: submissions,
      userName: users.name,
      teamName: teams.name,
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .leftJoin(teams, eq(submissions.teamId, teams.id))
    .where(eq(submissions.assignmentId, assignment.id));

  const files = await db.select().from(submissionFiles);
  const filesBySubmission = new Map<string, typeof files>();
  for (const f of files) {
    const list = filesBySubmission.get(f.submissionId) ?? [];
    list.push(f);
    filesBySubmission.set(f.submissionId, list);
  }

  // 미제출 목록
  let missing: { label: string }[] = [];
  if (assignment.unit === "team") {
    const allTeams = await db.select({ id: teams.id, name: teams.name }).from(teams);
    const submittedTeamIds = new Set(rows.map((r) => r.submission.teamId).filter(Boolean));
    missing = allTeams
      .filter((t) => !submittedTeamIds.has(t.id))
      .map((t) => ({ label: `${t.name} 팀` }));
  } else {
    const memberships = await db.select({ teamId: teamMembers.teamId }).from(teamMembers);
    const teamByUser = new Map<string, string>();
    for (const m of memberships) teamByUser.set(m.teamId, m.teamId);
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
    const submittedUserIds = new Set(rows.map((r) => r.submission.userId));
    missing = allUsers
      .filter((u) => !submittedUserIds.has(u.id))
      .map((u) => ({ label: u.name }));
  }

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      unit: assignment.unit,
      dueAt: assignment.dueAt.toISOString(),
    },
    submissions: rows
      .map((r) => ({
        id: r.submission.id,
        content: r.submission.content,
        link: r.submission.link,
        userName: r.userName,
        teamName: r.teamName,
        updatedAt: r.submission.updatedAt.toISOString(),
        files: (filesBySubmission.get(r.submission.id) ?? []).map((f) => ({
          id: f.id,
          filename: f.filename,
          size: f.size,
        })),
      }))
      .sort((a, b) => (a.teamName ?? a.userName).localeCompare(b.teamName ?? b.userName, "ko")),
    missing,
  };
}

export default function AdminAssignmentDetailRoute({ loaderData }: Route.ComponentProps) {
  const a = loaderData.assignment;

  return (
    <div className="stack-xl">
      <div>
        <Link to="/admin/assignments" className="back-link">
          <IconArrowLeft />
          과제 관리
        </Link>
        <div className="cluster">
          <h1 className="page-head__title page-head__title--sm">{a.title}</h1>
          <Badge tone={a.unit === "team" ? "indigo" : "gray"}>
            {a.unit === "team" ? "팀 과제" : "개인 과제"}
          </Badge>
          <Badge tone="gray">제출 {loaderData.submissions.length}건</Badge>
        </div>
        <p className="page-head__sub num">
          마감{" "}
          {fmtKST(new Date(a.dueAt), {
            year: "numeric",
            month: "numeric",
            day: "numeric",
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>

      {loaderData.missing.length > 0 ? (
        <Card>
          <h2 className="small text-danger">미제출 ({loaderData.missing.length})</h2>
          <p className="small muted mt-2">{loaderData.missing.map((m) => m.label).join(" · ")}</p>
        </Card>
      ) : (
        <Card>
          <h2 className="small text-success">전원 제출 완료 🎉</h2>
        </Card>
      )}

      {loaderData.submissions.length === 0 ? (
        <EmptyState>아직 제출물이 없어요.</EmptyState>
      ) : (
        <div className="stack-md">
          {loaderData.submissions.map((s) => (
            <Card key={s.id}>
              <div className="cluster cluster--between">
                <div className="cluster minw-0">
                  <strong className="card__title">
                    {a.unit === "team" ? `${s.teamName ?? "팀명없음"} 팀` : s.userName}
                  </strong>
                  {a.unit === "team" ? <span className="small faint">제출자: {s.userName}</span> : null}
                </div>
                <span className="small faint num">
                  {fmtKST(new Date(s.updatedAt), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              {s.content ? (
                <p className="notice notice--neutral notice-body">
                  {s.content}
                </p>
              ) : null}
              {s.link ? (
                <p className="small mt-2">
                  🔗{" "}
                  <a href={s.link} target="_blank" rel="noreferrer" className="link-url">
                    {s.link}
                  </a>
                </p>
              ) : null}
              {s.files.length > 0 ? (
                <ul className="stack-sm mt-2 bare-list">
                  {s.files.map((f) => (
                    <li key={f.id} className="item-link">
                      <span className="small ellipsis minw-0">
                        📄{" "}
                        <a href={`/admin/files/${f.id}`} target="_blank" rel="noreferrer" className="card__link">
                          {f.filename}
                        </a>{" "}
                        <span className="faint">({formatBytes(f.size)})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
