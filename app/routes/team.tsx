import { useState } from "react";
import { data, Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/team";
import { asc, eq } from "drizzle-orm";
import { teamMembers, teams, users } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { randomInviteCode } from "~/lib/auth";
import { BUSINESS_STATUS_LABELS, MAIL_ORDER_STATUS_LABELS, SALES_CHANNEL_OPTIONS } from "~/lib/constants";
import { teamScore, MAX_TEAM_SCORE } from "~/lib/score";
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
  const { user, db } = await requireUser(request, context);

  const [membership] = await db
    .select({ team: teams, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  if (!membership) return { team: null };

  const members = await db
    .select({ userId: users.id, name: users.name, studentNumber: users.studentNumber, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, membership.team.id))
    .orderBy(asc(teamMembers.createdAt));

  return {
    team: {
      id: membership.team.id,
      name: membership.team.name,
      inviteCode: membership.team.inviteCode,
      itemName: membership.team.itemName,
      salesChannel: membership.team.salesChannel,
      businessStatus: membership.team.businessStatus,
      mailOrderStatus: membership.team.mailOrderStatus,
      memo: membership.team.memo,
      myRole: membership.role,
      myUserId: user.id,
      score: teamScore(membership.team),
      members,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { user, db } = await requireUser(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const [current] = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    if (name.length < 2) return data({ error: "팀명을 2자 이상 입력해 주세요." }, { status: 400 });
    if (current) return data({ error: "이미 팀이 있어요. 먼저 탈퇴한 뒤 만들 수 있어요." }, { status: 400 });

    // 초대코드 중복 방지
    let code = randomInviteCode();
    for (let i = 0; i < 5; i++) {
      const [dup] = await db.select({ id: teams.id }).from(teams).where(eq(teams.inviteCode, code)).limit(1);
      if (!dup) break;
      code = randomInviteCode();
    }

    const [team] = await db.insert(teams).values({ name, inviteCode: code }).returning();
    await db.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: "leader" });
    return redirect("/team");
  }

  if (intent === "join") {
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    if (!code) return data({ error: "초대코드를 입력해 주세요." }, { status: 400 });
    if (current) return data({ error: "이미 팀이 있어요. 먼저 탈퇴한 뒤 참여할 수 있어요." }, { status: 400 });

    const [team] = await db.select().from(teams).where(eq(teams.inviteCode, code)).limit(1);
    if (!team) return data({ error: "초대코드를 찾을 수 없어요. 팀장에게 코드를 확인해 주세요." }, { status: 400 });

    const inserted = await db
      .insert(teamMembers)
      .values({ teamId: team.id, userId: user.id, role: "member" })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return data({ error: "이미 이 팀에 속해 있어요." }, { status: 400 });
    return redirect("/team");
  }

  if (intent === "update") {
    if (!current) return data({ error: "팀이 없어요." }, { status: 400 });
    const name = String(form.get("name") ?? "").trim();
    const itemName = String(form.get("itemName") ?? "").trim();
    const salesChannel = String(form.get("salesChannel") ?? "").trim();
    const businessStatus = String(form.get("businessStatus") ?? "none");
    const mailOrderStatus = String(form.get("mailOrderStatus") ?? "none");
    const memo = String(form.get("memo") ?? "").trim();

    if (name.length < 2) return data({ error: "팀명을 2자 이상 입력해 주세요." }, { status: 400 });
    if (!["none", "applied", "done"].includes(businessStatus) || !["none", "applied", "done"].includes(mailOrderStatus)) {
      return data({ error: "상태 값이 올바르지 않아요." }, { status: 400 });
    }

    await db
      .update(teams)
      .set({
        name,
        itemName: itemName || null,
        salesChannel: salesChannel || null,
        businessStatus,
        mailOrderStatus,
        memo: memo || null,
        updatedAt: new Date(),
      })
      .where(eq(teams.id, current.teamId));
    return redirect("/team");
  }

  if (intent === "leave") {
    if (!current) return data({ error: "팀이 없어요." }, { status: 400 });

    await db.delete(teamMembers).where(eq(teamMembers.userId, user.id));

    if (current.role === "leader") {
      const remaining = await db
        .select({ id: teamMembers.id, userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, current.teamId))
        .orderBy(asc(teamMembers.createdAt))
        .limit(1);
      if (remaining.length === 0) {
        await db.delete(teams).where(eq(teams.id, current.teamId));
      } else {
        await db.update(teamMembers).set({ role: "leader" }).where(eq(teamMembers.id, remaining[0].id));
      }
    }
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
      <PageHeader
        title="내 팀"
        right={
          <Badge tone="indigo">
            {team.score} / {MAX_TEAM_SCORE}점
          </Badge>
        }
      />
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
              <span className="member-list__id num">{m.studentNumber}</span>
              {m.role === "leader" && <Badge tone="indigo">팀장</Badge>}
              {m.userId === team.myUserId && <Badge tone="gray">나</Badge>}
            </li>
          ))}
        </ul>
      </Card>

      {/* 팀 정보 수정 (팀원 누구나) */}
      <Card>
        <SectionTitle>팀 정보 업데이트</SectionTitle>
        <p className="small muted">리더보드에 반영돼요! 팀원 누구나 업데이트할 수 있어요.</p>
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
