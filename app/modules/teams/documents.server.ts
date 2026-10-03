import { and, eq } from "drizzle-orm";
import { teamDocuments, teamMembers, teams, users } from "~/db/schema";
import {
  MAX_DOC_MB,
  TEAM_DOC_LABELS,
  isAllowedDocFile,
  isTeamDocKind,
  type TeamDocKind,
} from "~/lib/constants";
import type { AppContext } from "~/lib/context.server";
import { inferMimeType } from "~/lib/mime";
import {
  buildFileStreamResponse,
  buildTeamDocumentR2Key,
  sanitizeFilename,
  uploadStreamToR2,
} from "~/modules/submissions/storage";
import type {
  AdminTeamDocumentRow,
  TeamDocumentItem,
  TeamDocumentMeta,
} from "./types";

type UploadResult = { ok: true } | { ok: false; message: string };

/** R2 객체 정리 — Workers에선 백그라운드로, 테스트 등 executionCtx가 없으면 즉시 시도 */
function deleteR2Object(ctx: AppContext, r2Key: string): void {
  if (ctx.executionCtx) {
    ctx.executionCtx.waitUntil(ctx.env.FILES.delete(r2Key));
  } else {
    try {
      void ctx.env.FILES.delete(r2Key);
    } catch {}
  }
}

/**
 * TeamDocuments Deep Module
 * 팀 사업 서류(사업자등록증·통신판매업신고증)의 제출, 교체, 삭제, 조회와
 * "서류 제출 시 해당 진행 상태를 완료로 갱신"하는 불변식을 캡슐화합니다.
 */
export const TeamDocuments = {
  /**
   * 내 팀에 제출된 서류 목록 (2종) — 팀이 없으면 빈 배열
   */
  async listForTeam(ctx: AppContext): Promise<TeamDocumentItem[]> {
    const [membership] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (!membership) return [];

    const rows = await ctx.db
      .select({
        id: teamDocuments.id,
        kind: teamDocuments.kind,
        filename: teamDocuments.filename,
        size: teamDocuments.size,
        uploadedAt: teamDocuments.uploadedAt,
      })
      .from(teamDocuments)
      .where(eq(teamDocuments.teamId, membership.teamId));

    return rows;
  },

  /**
   * 서류 업로드(신규 또는 교체).
   * 업로드 성공 시 해당 상태(businessStatus/mailOrderStatus)를 'done'으로 갱신한다 —
   * 등록증/신고증을 제출했다는 것은 곧 등록·신고가 완료됐다는 뜻이므로.
   */
  async upload(
    ctx: AppContext,
    kind: string,
    file: File | null
  ): Promise<UploadResult> {
    if (!isTeamDocKind(kind)) {
      return { ok: false, message: "서류 종류가 올바르지 않아요." };
    }
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: `${TEAM_DOC_LABELS[kind]} 파일을 선택해 주세요.` };
    }
    if (file.size > MAX_DOC_MB * 1024 * 1024) {
      return {
        ok: false,
        message: `'${file.name}' 파일이 ${MAX_DOC_MB}MB를 초과해요. 사진을 압축하거나 스캔본으로 올려주세요.`,
      };
    }
    if (!isAllowedDocFile(file.name, file.type)) {
      return {
        ok: false,
        message: "PDF 또는 이미지(jpg·png·webp·heic) 파일만 제출할 수 있어요.",
      };
    }

    const [membership] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (!membership) {
      return { ok: false, message: "팀이 없어요. 서류는 팀 단위로 제출해요." };
    }
    const teamId = membership.teamId;

    const filename = sanitizeFilename(file.name);
    const mime = inferMimeType(file.name, file.type);
    const key = buildTeamDocumentR2Key(teamId, filename);

    await uploadStreamToR2(ctx.env.FILES, key, file, mime);

    const [existing] = await ctx.db
      .select({ id: teamDocuments.id, r2Key: teamDocuments.r2Key })
      .from(teamDocuments)
      .where(and(eq(teamDocuments.teamId, teamId), eq(teamDocuments.kind, kind)))
      .limit(1);

    if (existing) {
      await ctx.db
        .update(teamDocuments)
        .set({
          filename,
          r2Key: key,
          size: file.size,
          mime,
          uploadedById: ctx.user.id,
          uploadedAt: ctx.now,
        })
        .where(eq(teamDocuments.id, existing.id));
      deleteR2Object(ctx, existing.r2Key);
    } else {
      await ctx.db.insert(teamDocuments).values({
        teamId,
        kind,
        filename,
        r2Key: key,
        size: file.size,
        mime,
        uploadedById: ctx.user.id,
      });
    }

    await ctx.db
      .update(teams)
      .set(
        kind === "business"
          ? { businessStatus: "done", updatedAt: ctx.now }
          : { mailOrderStatus: "done", updatedAt: ctx.now }
      )
      .where(eq(teams.id, teamId));

    return { ok: true };
  },

  /**
   * 서류 삭제 (팀원). 상태 표시는 팀이 직접 관리하므로 건드리지 않는다.
   */
  async deleteDocument(ctx: AppContext, kind: string): Promise<UploadResult> {
    if (!isTeamDocKind(kind)) {
      return { ok: false, message: "서류 종류가 올바르지 않아요." };
    }

    const [membership] = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.user.id))
      .limit(1);

    if (!membership) {
      return { ok: false, message: "팀이 없어요." };
    }

    const [existing] = await ctx.db
      .select({ id: teamDocuments.id, r2Key: teamDocuments.r2Key })
      .from(teamDocuments)
      .where(and(eq(teamDocuments.teamId, membership.teamId), eq(teamDocuments.kind, kind)))
      .limit(1);

    if (!existing) {
      return { ok: false, message: "제출된 서류가 없어요." };
    }

    await ctx.db.delete(teamDocuments).where(eq(teamDocuments.id, existing.id));
    deleteR2Object(ctx, existing.r2Key);

    return { ok: true };
  },

  /**
   * 단일 서류 스트리밍 서빙. 접근 권한: 해당 팀원 또는 교수.
   */
  async serve(
    ctx: AppContext,
    docId: string,
    options: { inline?: boolean } = {}
  ): Promise<Response> {
    const [doc] = await ctx.db
      .select({
        id: teamDocuments.id,
        teamId: teamDocuments.teamId,
        filename: teamDocuments.filename,
        r2Key: teamDocuments.r2Key,
        mime: teamDocuments.mime,
      })
      .from(teamDocuments)
      .where(eq(teamDocuments.id, docId))
      .limit(1);

    if (!doc) throw new Response("서류를 찾을 수 없어요", { status: 404 });

    if (ctx.user.role !== "professor") {
      const [membership] = await ctx.db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, doc.teamId), eq(teamMembers.userId, ctx.user.id)))
        .limit(1);
      if (!membership) {
        throw new Response("서류에 접근할 권한이 없어요", { status: 403 });
      }
    }

    const object = await ctx.env.FILES.get(doc.r2Key);
    if (!object) {
      throw new Response("저장된 파일이 없어요 (스토리지에서 삭제되었을 수 있어요)", {
        status: 404,
      });
    }

    return buildFileStreamResponse(doc.filename, doc.mime, object.body, options.inline);
  },

  /**
   * 관리자 서류 현황 — 전체 팀의 서류 2종 제출 상태 (가나다순)
   */
  async getAdminOverview(ctx: AppContext): Promise<AdminTeamDocumentRow[]> {
    const [allTeams, memberships, docs] = await Promise.all([
      ctx.db.select().from(teams),
      ctx.db
        .select({ teamId: teamMembers.teamId, userName: users.name })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id)),
      ctx.db.select().from(teamDocuments),
    ]);

    const membersByTeam = new Map<string, string[]>();
    for (const m of memberships) {
      const list = membersByTeam.get(m.teamId) ?? [];
      list.push(m.userName);
      membersByTeam.set(m.teamId, list);
    }

    /** 키: `${teamId}:${kind}` */
    const docsByKey = new Map<string, TeamDocumentMeta>();
    for (const d of docs) {
      docsByKey.set(`${d.teamId}:${d.kind}`, {
        id: d.id,
        filename: d.filename,
        size: d.size,
        uploadedAt: d.uploadedAt,
      });
    }

    return allTeams
      .map((t) => ({
        teamId: t.id,
        teamName: t.name,
        members: membersByTeam.get(t.id) ?? [],
        businessStatus: t.businessStatus,
        mailOrderStatus: t.mailOrderStatus,
        business: docsByKey.get(`${t.id}:business`) ?? null,
        mailOrder: docsByKey.get(`${t.id}:mail_order`) ?? null,
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName, "ko"));
  },
};
