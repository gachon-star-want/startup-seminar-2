import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { kstInstant, kstYMD, SESSION_WINDOWS, type SessionPhase } from "~/lib/time";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 오늘 세션의 phase → 카운트다운 목표 시각 (KST 창 시간으로 조합) */
function targetFor(
  phase: SessionPhase | null,
  isToday: boolean,
): { at: number; label: string } | null {
  if (!isToday || !phase) return null;
  const today = kstYMD(new Date());
  if (phase === "scheduled")
    return { at: kstInstant(today, SESSION_WINDOWS.open).getTime(), label: "출석 오픈까지" };
  if (phase === "present")
    return { at: kstInstant(today, SESSION_WINDOWS.late).getTime(), label: "출석 인정 마감까지" };
  if (phase === "late")
    return { at: kstInstant(today, SESSION_WINDOWS.close).getTime(), label: "지각 체크 마감까지" };
  return null;
}

/**
 * 오늘 출석 창까지의 실시간 카운트다운.
 * 0에 도달하면 라우트를 revalidate해 phase를 새로 받아온다.
 */
export function LiveCountdown({
  phase,
  isToday,
}: {
  phase: SessionPhase | null;
  isToday: boolean;
}) {
  const target = targetFor(phase, isToday);
  const targetAt = target?.at ?? null;
  const [now, setNow] = useState<number>(() => Date.now());
  const revalidator = useRevalidator();
  const firedRef = useRef(false);

  useEffect(() => {
    if (targetAt == null) return;
    firedRef.current = false;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetAt]);

  const done = targetAt != null && now >= targetAt;

  useEffect(() => {
    if (done && !firedRef.current) {
      firedRef.current = true;
      revalidator.revalidate();
    }
  }, [done, revalidator]);

  if (targetAt == null || !target) return null;

  const remaining = Math.max(0, targetAt - now);
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);

  return (
    <div className="hero__body">
      <p className="hero__label">{done ? "상태 갱신 중…" : target.label}</p>
      <div className="count" role="timer" aria-live="off">
        <span className="count__digits">
          {pad(h)}:{pad(m)}:{pad(s)}
        </span>
        <span className="count__unit">남음</span>
      </div>
    </div>
  );
}
