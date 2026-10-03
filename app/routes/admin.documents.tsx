import type { Route } from "./+types/admin.documents";
import { requireAdminAppContext } from "~/lib/context.server";
import { TeamDocuments } from "~/modules/teams/index.server";
import {
  BUSINESS_STATUS_LABELS,
  MAIL_ORDER_STATUS_LABELS,
} from "~/lib/constants";
import { fmtKST } from "~/lib/time";
import { MilestoneBadge, PageHeader, formatBytes } from "~/components/ui";
import { ZipDownloadButton } from "~/components/ZipDownloadButton";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAdminAppContext(request, context);
  return { rows: await TeamDocuments.getAdminOverview(ctx) };
}

const fmtDate = (d: Date) => fmtKST(d, { year: "numeric", month: "numeric", day: "numeric" });

/** 서류 1종 셀 — 제출됐으면 다운로드 링크, '완료' 표시인데 미제출이면 경고 */
function DocumentCell({
  status,
  labels,
  doc,
  basePath,
}: {
  status: string;
  labels: Record<string, string>;
  doc: { id: string; filename: string; size: number; uploadedAt: Date } | null;
  basePath: string;
}) {
  if (doc) {
    return (
      <>
        📄{" "}
        <a href={`${basePath}/${doc.id}`} className="item-link">
          {doc.filename}
        </a>{" "}
        <span className="faint num">({formatBytes(doc.size)})</span>
        <br />
        <span className="faint small num">{fmtDate(doc.uploadedAt)} 제출</span>
      </>
    );
  }
  if (status === "done") {
    return (
      <span className="text-danger small">
        ⚠️ 완료 표시 · 미제출
      </span>
    );
  }
  return <span className="faint small">미제출 ({labels[status] ?? status})</span>;
}

export default function AdminDocumentsRoute({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;
  const submittedTeams = rows.filter((r) => r.business || r.mailOrder).length;

  return (
    <div className="stack-xl">
      <PageHeader
        title="서류 제출 현황"
        sub="팀별 사업자등록증 · 통신판매업신고증 제출 현황이에요. '완료'로 표시했는데 서류가 없는 팀은 ⚠️로 표시돼요."
        right={
          <ZipDownloadButton
            manifestUrl="/admin/documents/files"
            suggestedName="팀별_사업서류.zip"
            label="📦 ZIP 다운로드"
            title="제출된 서류를 팀별로 묶은 ZIP으로 내려받아요 (브라우저에서 조립)"
          />
        }
      />

      <p className="small muted">
        전체 {rows.length}팀 중 서류를 제출한 팀 <strong>{submittedTeams}</strong>팀
      </p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>팀</th>
              <th>팀원</th>
              <th>사업자등록증</th>
              <th>통신판매업신고증</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId}>
                <td className="minw-0">
                  <span style={{ fontWeight: 700 }}>{r.teamName}팀</span>
                  <br />
                  <MilestoneBadge status={r.businessStatus} labels={BUSINESS_STATUS_LABELS} />{" "}
                  <MilestoneBadge status={r.mailOrderStatus} labels={MAIL_ORDER_STATUS_LABELS} />
                </td>
                <td className="small muted">{r.members.join(", ") || "1인 팀"}</td>
                <td className="small">
                  <DocumentCell
                    status={r.businessStatus}
                    labels={BUSINESS_STATUS_LABELS}
                    doc={r.business}
                    basePath="/admin/team-documents"
                  />
                </td>
                <td className="small">
                  <DocumentCell
                    status={r.mailOrderStatus}
                    labels={MAIL_ORDER_STATUS_LABELS}
                    doc={r.mailOrder}
                    basePath="/admin/team-documents"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
