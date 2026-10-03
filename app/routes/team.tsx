import { useEffect, useRef, useState } from "react";
import { data, Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/team";
import { TeamDocuments, TeamRoster } from "~/modules/teams/index.server";
import { requireAppContext } from "~/lib/context.server";
import {
  BUSINESS_STATUS_LABELS,
  MAIL_ORDER_STATUS_LABELS,
  MAX_DOC_MB,
  SALES_CHANNEL_ETC,
  SALES_CHANNEL_OPTIONS,
  TEAM_DOC_KINDS,
  TEAM_DOC_LABELS,
  matchSalesChannelOption,
  type TeamDocKind,
} from "~/lib/constants";
import { fmtKST } from "~/lib/time";
import { IconCopy } from "~/components/icons";
import {
  Badge,
  Card,
  ErrorText,
  Field,
  MilestoneBadge,
  PageHeader,
  SectionTitle,
  formatBytes,
} from "~/components/ui";
import type { TeamDocumentItem } from "~/modules/teams/types";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const team = await TeamRoster.getMyTeam(ctx);
  const docs = team ? await TeamDocuments.listForTeam(ctx) : [];
  return { team, docs };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await requireAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "");
    const res = await TeamRoster.create(ctx, name);
    if (!res.ok) return data({ error: res.message }, { status: 400 });
    return redirect("/team");
  }

  if (intent === "join") {
    const code = String(form.get("code") ?? "");
    const res = await TeamRoster.joinByCode(ctx, code);
    if (!res.ok) return data({ error: res.message }, { status: 400 });
    return redirect("/team");
  }

  if (intent === "update") {
    const name = String(form.get("name") ?? "");
    const itemName = String(form.get("itemName") ?? "");
    const salesChannel = String(form.get("salesChannel") ?? "");
    const salesChannelLink = String(form.get("salesChannelLink") ?? "");
    const businessStatus = String(form.get("businessStatus") ?? "none");
    const mailOrderStatus = String(form.get("mailOrderStatus") ?? "none");
    const memo = String(form.get("memo") ?? "");

    const res = await TeamRoster.updateProfile(ctx, {
      name,
      itemName,
      salesChannel,
      salesChannelLink,
      businessStatus,
      mailOrderStatus,
      memo,
    });
    if (!res.ok) return data({ error: res.message }, { status: 400 });
    return redirect("/team");
  }

  if (intent === "uploadDoc") {
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file");
    const res = await TeamDocuments.upload(ctx, kind, file instanceof File ? file : null);
    if (!res.ok) return data({ error: res.message }, { status: 400 });
    return redirect("/team");
  }

  if (intent === "deleteDoc") {
    const kind = String(form.get("kind") ?? "");
    const res = await TeamDocuments.deleteDocument(ctx, kind);
    if (!res.ok) return data({ error: res.message }, { status: 400 });
    return redirect("/team");
  }

  if (intent === "leave") {
    const res = await TeamRoster.leave(ctx);
    if (!res.ok) return data({ error: res.message }, { status: 400 });
    return redirect("/team");
  }

  return data({ error: "알 수 없는 요청이에요." }, { status: 400 });
}

/**
 * 판매 채널 자체 드롭다운.
 * - 옵션 클릭으로 선택 (네이티브 select/datalist의 겹침·OS 팝업 문제 회피)
 * - "기타"는 텍스트 입력으로 직접 타이핑
 * - 온라인 채널은 판매 링크 입력칸을 함께 보여준다
 */
function ChannelPicker({
  defaultValue,
  defaultLink,
}: {
  defaultValue: string | null;
  defaultLink: string | null;
}) {
  const matched = matchSalesChannelOption(defaultValue);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    () => matched?.label ?? (defaultValue?.trim() ? SALES_CHANNEL_ETC : null)
  );
  const [custom, setCustom] = useState(() => (matched ? "" : defaultValue?.trim() ?? ""));
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭으로 드롭다운 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const option = selected
    ? SALES_CHANNEL_OPTIONS.find((o) => o.label === selected) ?? null
    : null;
  const isEtc = selected === SALES_CHANNEL_ETC;

  return (
    <div className="field">
      <span className="label" id="channel-label">
        판매 채널 (어디서 판매하나요?)
      </span>
      <div className="dd" ref={rootRef}>
        <button
          type="button"
          className={`dd__toggle${open ? " is-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="channel-label"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={selected ? "" : "faint"}>
            {selected === null
              ? "선택하세요"
              : isEtc && custom.trim()
                ? custom.trim()
                : selected}
          </span>
          <span className="dd__chevron" aria-hidden>
            ▾
          </span>
        </button>
        {open ? (
          <ul className="dd__menu" role="listbox" aria-labelledby="channel-label">
            {SALES_CHANNEL_OPTIONS.map((o) => (
              <li key={o.label}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === o.label}
                  className={`dd__item${selected === o.label ? " is-selected" : ""}`}
                  onClick={() => {
                    setSelected(o.label);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {isEtc ? (
        <input
          name="salesChannel"
          className="input mt-2"
          placeholder="판매 채널을 직접 입력해 주세요"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      ) : (
        <input type="hidden" name="salesChannel" value={selected ?? ""} />
      )}
      {option?.online ? (
        <input
          name="salesChannelLink"
          type="url"
          className="input num mt-2"
          placeholder="판매 링크 (예: https://내쇼핑몰.com)"
          defaultValue={defaultLink ?? ""}
        />
      ) : null}
    </div>
  );
}

function StatusPicker({
  name,
  label,
  labels,
  current,
}: {
  name: string;
  label: string;
  labels: Record<string, string>;
  current: string;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {(["none", "applied", "done"] as const).map((v) => (
          <label key={v} className="seg__item">
            <input type="radio" name={name} value={v} defaultChecked={current === v} />
            <span>{labels[v]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={copied ? "copy-btn is-copied" : "copy-btn"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 클립보드 실패 시 무시
        }
      }}
    >
      {copied ? (
        "복사됨!"
      ) : (
        <>
          <IconCopy />
          복사
        </>
      )}
    </button>
  );
}

/** 서류 1종(사업자등록증 또는 통신판매업신고증)의 제출 슬롯 */
function DocumentSlot({ kind, doc }: { kind: TeamDocKind; doc: TeamDocumentItem | null }) {
  const label = TEAM_DOC_LABELS[kind];
  return (
    <Field label={label} hint={`PDF 또는 사진(jpg·png·webp·heic) · 최대 ${MAX_DOC_MB}MB`}>
      {doc ? (
        <p className="small">
          📄{" "}
          <a href={`/team-documents/${doc.id}`} className="item-link">
            {doc.filename}
          </a>{" "}
          <span className="faint num">({formatBytes(doc.size)})</span>
          <span className="faint small num">
            {" "}
            · {fmtKST(doc.uploadedAt, { month: "numeric", day: "numeric" })} 제출
          </span>
        </p>
      ) : (
        <p className="small faint">아직 제출하지 않았어요.</p>
      )}

      <Form method="post" encType="multipart/form-data" className="cluster mt-2">
        <input type="hidden" name="intent" value="uploadDoc" />
        <input type="hidden" name="kind" value={kind} />
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,image/*"
          className="input"
          style={{ maxWidth: "22rem" }}
        />
        <button type="submit" className="btn btn--primary btn--sm">
          {doc ? "교체하기" : "제출하기"}
        </button>
      </Form>

      {doc ? (
        <Form
          method="post"
          className="mt-2"
          onSubmit={(e) => {
            if (!confirm(`제출한 ${label}을(를) 삭제할까요?`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="deleteDoc" />
          <input type="hidden" name="kind" value={kind} />
          <button type="submit" className="btn btn--danger btn--sm">
            삭제
          </button>
        </Form>
      ) : null}
    </Field>
  );
}

export default function TeamRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const team = loaderData.team;

  if (!team) {
    return (
      <div className="stack-xl">
        <PageHeader title="내 팀" sub="팀을 만들거나 초대코드로 합류할 수 있어요" />
        <ErrorText>{actionData?.error}</ErrorText>
        <div className="grid-2">
          <Card>
            <SectionTitle>팀 만들기</SectionTitle>
            <p className="small muted">
              새 팀을 만들면 <strong>초대코드</strong>가 발급돼요. 팀원에게 코드를 공유하면 돼요.
              혼자 하는 팀도 OK!
            </p>
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="create" />
              <input name="name" className="input" placeholder="팀명 (예: 폴리곤)" required />
              <button type="submit" className="btn btn--primary btn--block mt-3">
                팀 만들기
              </button>
            </Form>
          </Card>
          <Card>
            <SectionTitle>초대코드로 합류</SectionTitle>
            <p className="small muted">팀장이 공유한 6자리 코드를 입력하세요.</p>
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="join" />
              <input
                name="code"
                className="input input--code num"
                placeholder="ABC123"
                maxLength={8}
                required
              />
              <button type="submit" className="btn btn--ghost btn--block mt-3">
                합류하기
              </button>
            </Form>
          </Card>
        </div>
      </div>
    );
  }

  const docByKind = new Map(loaderData.docs.map((d) => [d.kind, d]));
  const missingDocs: string[] = [];
  if (team.businessStatus === "done" && !docByKind.has("business")) {
    missingDocs.push(TEAM_DOC_LABELS.business);
  }
  if (team.mailOrderStatus === "done" && !docByKind.has("mail_order")) {
    missingDocs.push(TEAM_DOC_LABELS.mail_order);
  }

  return (
    <div className="stack-xl">
      <PageHeader title="내 팀" />
      <ErrorText>{actionData?.error}</ErrorText>

      {/* 팀 정보 + 멤버 */}
      <Card>
        <SectionTitle
          right={
            <Form method="post">
              <input type="hidden" name="intent" value="leave" />
              <button type="submit" className="btn btn--danger btn--sm">
                팀 나가기
              </button>
            </Form>
          }
        >
          {team.name}
        </SectionTitle>

        <div className="code-box">
          <div>
            <p className="code-box__label">초대코드 · 팀원에게 공유하세요</p>
            <span className="code-box__code num">{team.inviteCode}</span>
          </div>
          <CopyButton code={team.inviteCode} />
        </div>

        <ul className="member-list mt-4">
          {team.members.map((m) => (
            <li key={m.userId}>
              <span className="member-list__name">{m.name}</span>
              {m.role === "leader" && <Badge tone="indigo">팀장</Badge>}
              {m.userId === team.myUserId && <Badge tone="gray">나</Badge>}
            </li>
          ))}
        </ul>
      </Card>

      {/* 팀 정보 수정 (팀원 누구나) */}
      <Card>
        <SectionTitle>팀 정보 업데이트</SectionTitle>
        <p className="small muted">팀 정보는 리더보드에 표시돼요. 팀원 누구나 업데이트할 수 있어요.</p>
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="update" />

          <Field label="팀명" htmlFor="t-name">
            <input id="t-name" name="name" className="input" defaultValue={team.name} required />
          </Field>
          <Field label="아이템 (무엇을 판매하나요?)" htmlFor="t-item">
            <input
              id="t-item"
              name="itemName"
              className="input"
              placeholder="예: 반려견용 스마트 목줄"
              defaultValue={team.itemName ?? ""}
            />
          </Field>
          <ChannelPicker defaultValue={team.salesChannel} defaultLink={team.salesChannelLink} />

          <StatusPicker
            name="businessStatus"
            label="사업자 등록 여부"
            labels={BUSINESS_STATUS_LABELS}
            current={team.businessStatus}
          />
          <StatusPicker
            name="mailOrderStatus"
            label="통신판매업 신고 여부"
            labels={MAIL_ORDER_STATUS_LABELS}
            current={team.mailOrderStatus}
          />

          <Field label="비고 (자유롭게 기록)" htmlFor="t-memo">
            <textarea
              id="t-memo"
              name="memo"
              rows={3}
              className="input"
              placeholder="예: 9월 말 쿠팡 입점 예정, CS 채널 준비 중 등"
              defaultValue={team.memo ?? ""}
            />
          </Field>

          <button type="submit" className="btn btn--primary btn--block mt-4">
            저장하기
          </button>
        </Form>
      </Card>

      {/* 사업 서류 제출 (팀원 누구나) */}
      <Card>
        <SectionTitle>사업 서류 제출</SectionTitle>
        <p className="small muted">
          사업자등록증과 통신판매업신고증을 제출해 주세요. 팀원 누구나 제출할 수 있고, 다시
          올리면 기존 서류가 교체돼요.
        </p>

        {missingDocs.length > 0 ? (
          <p className="notice notice--warning small">
            ⚠️ {missingDocs.join("과 ")}을(를) 완료로 표시하셨는데 서류가 아직 제출되지
            않았어요. 사진이나 스캔본을 올려주세요.
          </p>
        ) : null}

        <div className="grid-2 mt-4">
          {TEAM_DOC_KINDS.map((kind) => (
            <DocumentSlot key={kind} kind={kind} doc={docByKind.get(kind) ?? null} />
          ))}
        </div>
      </Card>
    </div>
  );
}
