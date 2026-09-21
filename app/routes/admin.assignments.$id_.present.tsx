import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/admin.assignments.$id_.present";
import { eq, inArray } from "drizzle-orm";
import { assignments, submissionFiles, submissions, teams, users } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { IconArrowLeft } from "~/components/icons";
import { Card, EmptyState, formatBytes } from "~/components/ui";

const PdfStage = lazy(() => import("~/components/present/PdfStage"));
const PptxStage = lazy(() => import("~/components/present/PptxStage"));

type PresentFile = { id: string; filename: string; mime: string | null; size: number };
type PresentSub = {
  id: string;
  sortKey: string;
  label: string; // 팀명(팀 과제) 또는 이름(개인 과제)
  presenter: string; // 실제 제출자
  content: string | null;
  link: string | null;
  updatedAt: string;
  files: PresentFile[];
};

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, params.id!))
    .limit(1);
  if (!assignment) throw new Response("과제를 찾을 수 없어요", { status: 404 });

  const rows = await db
    .select({ submission: submissions, userName: users.name, teamName: teams.name })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .leftJoin(teams, eq(submissions.teamId, teams.id))
    .where(eq(submissions.assignmentId, assignment.id));

  const subIds = rows.map((r) => r.submission.id);
  const files =
    subIds.length > 0
      ? await db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subIds))
      : [];
  const filesBySub = new Map<string, typeof files>();
  for (const f of files) {
    const list = filesBySub.get(f.submissionId) ?? [];
    list.push(f);
    filesBySub.set(f.submissionId, list);
  }

  const submissionsList: PresentSub[] = rows
    .map((r) => ({
      id: r.submission.id,
      sortKey: (assignment.unit === "team" ? r.teamName : r.userName) ?? r.userName,
      label: assignment.unit === "team" ? `${r.teamName ?? "팀명없음"} 팀` : r.userName,
      presenter: r.userName,
      content: r.submission.content,
      link: r.submission.link,
      updatedAt: r.submission.updatedAt.toISOString(),
      files: (filesBySub.get(r.submission.id) ?? []).map((f) => ({
        id: f.id,
        filename: f.filename,
        mime: f.mime,
        size: f.size,
      })),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ko"));

  // 미제출 목록
  let missing: string[] = [];
  if (assignment.unit === "team") {
    const allTeams = await db.select({ id: teams.id, name: teams.name }).from(teams);
    const submittedTeamIds = new Set(rows.map((r) => r.submission.teamId).filter(Boolean));
    missing = allTeams.filter((t) => !submittedTeamIds.has(t.id)).map((t) => `${t.name} 팀`);
  } else {
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
    const submittedUserIds = new Set(rows.map((r) => r.submission.userId));
    missing = allUsers.filter((u) => !submittedUserIds.has(u.id)).map((u) => u.name);
  }
  missing.sort((a, b) => a.localeCompare(b, "ko"));

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      unit: assignment.unit,
      dueAt: assignment.dueAt.toISOString(),
    },
    submissions: submissionsList,
    missing,
  };
}

type Slide =
  | { kind: "cover"; subIndex: number }
  | { kind: "file"; subIndex: number; file: PresentFile };

function classify(
  f: PresentFile,
): "pdf" | "pptx" | "image" | "html" | "text" | "other" {
  const mime = (f.mime || "").toLowerCase();
  const name = f.filename.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";
  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (mime.includes("presentation") || mime.includes("powerpoint") || ext === "pptx" || ext === "ppt") {
    return "pptx";
  }
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(ext)) {
    return "image";
  }
  if (mime.includes("html") || ext === "html" || ext === "htm") return "html";
  if (mime.startsWith("text/") || ["txt", "md", "csv"].includes(ext)) return "text";
  return "other";
}

export default function PresentRoute({ loaderData }: Route.ComponentProps) {
  const a = loaderData.assignment;
  const subs = loaderData.submissions;
  const navigate = useNavigate();

  // 팀(개인)당 [표지 슬라이드, 파일 슬라이드들...]
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    subs.forEach((s, i) => {
      out.push({ kind: "cover", subIndex: i });
      s.files.forEach((f) => out.push({ kind: "file", subIndex: i, file: f }));
    });
    return out;
  }, [subs]);

  const [pos, setPos] = useState({ slide: 0, page: 0 });
  const [totals, setTotals] = useState<Record<string, number>>({}); // fileId → PDF 페이지/PPTX 슬라이드 수
  const [presenting, setPresenting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [box, setBox] = useState({ w: 960, h: 540 }); // 스테이지 크기

  const overlayRef = useRef<HTMLDivElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const overlayStageRef = useRef<HTMLDivElement>(null);

  const current = slides[Math.min(pos.slide, Math.max(slides.length - 1, 0))];
  const currentSubIndex = current?.subIndex ?? 0;

  const pagesOf = useCallback(
    (s: Slide | undefined) => {
      if (!s || s.kind === "cover") return 1;
      return Math.max(1, totals[s.file.id] ?? 1);
    },
    [totals],
  );

  const next = useCallback(() => {
    setPos((p) => {
      const s = slides[p.slide];
      if (!s) return p;
      if (p.page < pagesOf(s) - 1) return { ...p, page: p.page + 1 };
      if (p.slide < slides.length - 1) return { slide: p.slide + 1, page: 0 };
      return p;
    });
  }, [slides, pagesOf]);

  const prev = useCallback(() => {
    setPos((p) => {
      if (p.page > 0) return { ...p, page: p.page - 1 };
      if (p.slide > 0) {
        const s = slides[p.slide - 1];
        return { slide: p.slide - 1, page: pagesOf(s) - 1 };
      }
      return p;
    });
  }, [slides, pagesOf]);

  const jumpToSub = useCallback(
    (subIndex: number) => {
      const idx = slides.findIndex((s) => s.subIndex === subIndex);
      if (idx >= 0) setPos({ slide: idx, page: 0 });
    },
    [slides],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      overlayRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // 키맵: Space/Enter/→ 다음, Backspace/← 이전, Esc 나가기, T 팀목록, F 전체화면
  useEffect(() => {
    if (slides.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const onButton = Boolean(t?.closest?.("button, a"));
      switch (e.key) {
        case "Escape":
          if (presenting) setPresenting(false);
          else navigate(`/admin/assignments/${a.id}`);
          return;
        case " ":
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          next();
          return;
        case "Backspace":
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prev();
          return;
        case "Enter":
          if (!onButton) {
            e.preventDefault();
            next();
          }
          return;
        case "t":
        case "T":
          if (presenting) setDrawerOpen((o) => !o);
          return;
        case "f":
        case "F":
          if (presenting) toggleFullscreen();
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, presenting, next, prev, navigate, a.id, toggleFullscreen]);

  // 브라우저가 Esc로 전체화면을 먼저 풀면 발표 모드도 함께 종료
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // 발표 모드 진입: 전체화면 요청(거부돼도 오버레이는 동작) + 본문 스크롤 잠금
  useEffect(() => {
    if (!presenting) return;
    overlayRef.current?.requestFullscreen?.().catch(() => {});
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [presenting]);

  // 스테이지 크기 측정 (미리보기/발표 모드 각각)
  useEffect(() => {
    const el = presenting ? overlayStageRef.current : previewStageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((b) => {
        const w = Math.round(width);
        const h = Math.round(height);
        return b.w === w && b.h === h ? b : { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [presenting, slides.length === 0]);

  const setTotalFor = useCallback(
    (fileId: string) => (n: number) =>
      setTotals((t) => (t[fileId] === n ? t : { ...t, [fileId]: n })),
    [],
  );

  const onStageClick = useCallback(
    (e: ReactMouseEvent) => {
      if ((e.target as HTMLElement).closest("a, button, iframe")) return;
      next();
    },
    [next],
  );

  const teamList = (dark: boolean) => (
    <nav className={dark ? "present-drawer" : "present-side"} aria-label="발표 순서">
      <p className="present-side__heading">발표 순서</p>
      <ul className="bare-list stack-xs">
        {subs.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`present-side__item${i === currentSubIndex ? " is-active" : ""}`}
              onClick={() => {
                jumpToSub(i);
                if (dark) setDrawerOpen(false);
              }}
            >
              <span className="present-side__name ellipsis">{s.label}</span>
              <span className="present-side__meta">
                {s.files.length > 0 ? `파일 ${s.files.length}` : "파일 없음"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="present-side__missing">
        {loaderData.missing.length > 0 ? (
          <>
            <p className="present-side__missing-head">미제출 ({loaderData.missing.length})</p>
            <p className="present-side__missing-names">{loaderData.missing.join(" · ")}</p>
          </>
        ) : (
          <p className="present-side__missing-all">전원 제출 완료 🎉</p>
        )}
      </div>
    </nav>
  );

  if (slides.length === 0) {
    return (
      <div className="stack-lg">
        <Link to={`/admin/assignments/${a.id}`} className="back-link">
          <IconArrowLeft />
          과제 상세로
        </Link>
        <EmptyState>제출물이 없어서 발표할 수 있을 게 없어요.</EmptyState>
      </div>
    );
  }

  const renderSlide = (s: Slide) => {
    if (s.kind === "cover") {
      const sub = subs[s.subIndex];
      return (
        <div className="present-cover">
          <p className="present-cover__label">
            {a.unit === "team" ? "팀 발표" : "개인 발표"} · {s.subIndex + 1}/{subs.length}
          </p>
          <h2 className="present-cover__title">{sub.label}</h2>
          {a.unit === "team" ? (
            <p className="present-cover__presenter">발표자(제출자): {sub.presenter}</p>
          ) : null}
          {sub.content ? <p className="present-cover__body">{sub.content}</p> : null}
          {sub.link ? (
            <a className="present-cover__link" href={sub.link} target="_blank" rel="noreferrer">
              🔗 {sub.link}
            </a>
          ) : null}
          {sub.files.length > 0 ? (
            <ul className="present-cover__files">
              {sub.files.map((f) => (
                <li key={f.id}>
                  📄 {f.filename} <span>({formatBytes(f.size)})</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="present-cover__hint">스페이스키를 누르면 넘어가요</p>
        </div>
      );
    }

    const url = `/admin/files/${s.file.id}`;
    const kind = classify(s.file);
    switch (kind) {
      case "pdf":
        return (
          <PdfStage
            key={s.file.id}
            url={url}
            page={pos.page}
            boxW={box.w}
            boxH={box.h}
            onTotal={setTotalFor(s.file.id)}
          />
        );
      case "pptx":
        return (
          <PptxStage
            key={s.file.id}
            url={url}
            page={pos.page}
            boxW={box.w}
            boxH={box.h}
            onTotal={setTotalFor(s.file.id)}
          />
        );
      case "image":
        return <img className="present-img" src={url} alt={s.file.filename} />;
      case "html":
        return (
          <iframe
            className="present-frame"
            src={`${url}?inline=1`}
            title={s.file.filename}
            sandbox="allow-scripts allow-popups allow-forms"
          />
        );
      case "text":
        return <iframe className="present-frame" src={`${url}?inline=1`} title={s.file.filename} />;
      default:
        return (
          <div className="present-fallback">
            <p className="present-fallback__title">이 형식은 브라우저에서 바로 표시할 수 없어요</p>
            <p className="present-fallback__name">
              📄 {s.file.filename} ({formatBytes(s.file.size)})
            </p>
            <div className="cluster">
              <a href={url} className="present-btn present-btn--solid">
                다운로드
              </a>
              <a href={`${url}?inline=1`} className="present-btn" target="_blank" rel="noreferrer">
                새 탭에서 열기
              </a>
            </div>
          </div>
        );
    }
  };

  const teamChip = `${a.unit === "team" ? "팀" : "제출"} ${currentSubIndex + 1}/${subs.length}`;
  const slideChip = `${pos.slide + 1}/${slides.length}`;

  return (
    <div className="stack-lg">
      <div className="cluster cluster--between">
        <div className="minw-0">
          <Link to={`/admin/assignments/${a.id}`} className="back-link">
            <IconArrowLeft />
            과제 상세
          </Link>
          <h1 className="page-head__title page-head__title--sm ellipsis">발표 · {a.title}</h1>
          <div className="cluster mt-2">
            <span className="badge badge--indigo num">{teamChip}</span>
            <span className="badge badge--gray num">{slideChip}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--primary flex-shrink-0"
          onClick={() => {
            setDrawerOpen(false);
            setPresenting(true);
          }}
        >
          ▶ 전체화면 발표 시작
        </button>
      </div>

      <div className="present-layout">
        {teamList(false)}
        <div
          className="present-stage"
          ref={previewStageRef}
          onClick={onStageClick}
          role="button"
          tabIndex={-1}
          aria-label="클릭하면 다음 슬라이드로 넘어가요"
        >
          <Suspense fallback={<p className="present-loading">불러오는 중…</p>}>
            {current ? renderSlide(current) : null}
          </Suspense>
        </div>
      </div>

      <Card>
        <p className="small muted help-text">
          🎬 <strong>미리보기</strong>에서 내용을 확인하고 <strong>전체화면 발표 시작</strong>을 누르면
          발표 모드로 전환돼요. 스페이스바·엔터·→ 다음 / 백스페이스·← 이전 / Esc 종료 / 발표 중{" "}
          <strong>T</strong> 팀 목록 · <strong>F</strong> 전체화면.
        </p>
      </Card>

      {/* 발표(전체화면) 오버레이 */}
      {presenting ? (
        <div className="present-overlay" ref={overlayRef}>
          <div className="present-overlay__bar">
            <div className="cluster minw-0">
              <button
                type="button"
                className="present-btn"
                onClick={() => setPresenting(false)}
                title="미리보기로 돌아가기 (Esc)"
              >
                ✕ 발표 종료
              </button>
              <span className="present-overlay__title ellipsis">{a.title}</span>
            </div>
            <div className="cluster flex-shrink-0">
              <span className="present-chip num">{teamChip}</span>
              <span className="present-chip num">{slideChip}</span>
              <button
                type="button"
                className={`present-btn${drawerOpen ? " is-active" : ""}`}
                onClick={() => setDrawerOpen((o) => !o)}
                title="팀 목록 (T)"
              >
                팀 목록
              </button>
              <button type="button" className="present-btn" onClick={toggleFullscreen} title="전체화면 (F)">
                ⛶ 전체화면
              </button>
            </div>
          </div>
          <div className="present-overlay__body">
            {drawerOpen ? teamList(true) : null}
            <div
              className="present-frame-stage"
              ref={overlayStageRef}
              onClick={onStageClick}
              role="button"
              tabIndex={-1}
              aria-label="클릭하면 다음 슬라이드로 넘어가요"
            >
              <Suspense fallback={<p className="present-loading">불러오는 중…</p>}>
                {current ? renderSlide(current) : null}
              </Suspense>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
