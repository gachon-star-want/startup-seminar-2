import { IconMoon, IconSun } from "~/components/icons";

/**
 * 다크/라이트 테마 토글.
 * React 상태 없이 <html data-theme> 만 바꾸고, 아이콘은 CSS가 테마에 따라 교체한다.
 * (초기 테마는 root.tsx의 인라인 스크립트가 hydration 전에 적용)
 */
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label="다크·라이트 테마 전환"
      title="테마 전환"
      onClick={() => {
        const root = document.documentElement;
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        try {
          localStorage.setItem("theme", next);
        } catch {
          // 사파리 프라이빗 모드 등 저장 실패는 무시
        }
      }}
    >
      <IconSun className="icon-sun" />
      <IconMoon className="icon-moon" />
    </button>
  );
}
