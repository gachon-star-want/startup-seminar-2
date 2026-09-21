import { useState } from "react";
import { data, Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/team";
import { TeamRoster } from "~/modules/teams/index.server";
import { requireAppContext } from "~/lib/context.server";
import { BUSINESS_STATUS_LABELS, MAIL_ORDER_STATUS_LABELS, SALES_CHANNEL_OPTIONS } from "~/lib/constants";
import { IconCopy } from "~/components/icons";
import {
  Badge,
  Card,
  ErrorText,
  Field,
  PageHeader,
  SectionTitle,
} from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireAppContext(request, context);
  const team = await TeamRoster.getMyTeam(ctx);
  return { team };
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
    const businessStatus = String(form.get("businessStatus") ?? "none");
    const mailOrderStatus = String(form.get("mailOrderStatus") ?? "none");
    const memo = String(form.get("memo") ?? "");

    const res = await TeamRoster.updateProfile(ctx, {
      name,
      itemName,
      salesChannel,
      businessStatus,
      mailOrderStatus,
      memo,
    });
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
          <Field label="판매 채널 (어디서 판매하나요?)" htmlFor="t-channel">
            <input
              id="t-channel"
              name="salesChannel"
              className="input"
              placeholder="자유롭게 입력하거나 추천에서 선택"
              list="channel-options"
              defaultValue={team.salesChannel ?? ""}
            />
            <datalist id="channel-options">
              {SALES_CHANNEL_OPTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>

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
    </div>
  );
}
