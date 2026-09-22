import type { ReactNode } from "react";
import {
  Form,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "~/tailwind.css?url";
import { getCurrentUser } from "~/lib/session";
import { ThemeToggle } from "~/components/theme";
import {
  IconBook,
  IconCheckCircle,
  IconHome,
  IconLogin,
  IconLogout,
  IconShield,
  IconStar,
  IconTrophy,
  IconUsers,
} from "~/components/icons";

export const meta: Route.MetaFunction = () => [
  { title: "창업심화세미나2" },
  { name: "description", content: "창업심화세미나2 출석·팀·과제 관리 페이지" },
];

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await getCurrentUser(request, context);
  return { userName: user?.name ?? null };
}

/** hydration 전에 테마를 적용해 깜빡임(FOUC) 방지 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;

function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-theme="light" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#f2f3f8"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#0d0f16"
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const mainNav = [
  { to: "/", label: "홈", short: "홈", end: true, Icon: IconHome },
  {
    to: "/attendance",
    label: "출석",
    short: "출석",
    end: false,
    Icon: IconCheckCircle,
  },
  {
    to: "/board",
    label: "리더보드",
    short: "보드",
    end: false,
    Icon: IconTrophy,
  },
  { to: "/team", label: "내 팀", short: "팀", end: false, Icon: IconUsers },
  {
    to: "/assignments",
    label: "과제",
    short: "과제",
    end: false,
    Icon: IconBook,
  },
  {
    to: "/evaluations",
    label: "발표 평가",
    short: "평가",
    end: false,
    Icon: IconStar,
  },
] as const;

function Logo() {
  return (
    <Link to="/" className="logo" aria-label="창업심화세미나2 홈">
      <span className="logo__mark" aria-hidden>
        🚀
      </span>
      <span>
        창업심화세미나<span className="logo__sub">2</span>
      </span>
    </Link>
  );
}

function LogoutForm({
  className,
  ariaLabel,
  children,
}: {
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <Form method="post" action="/logout">
      <button type="submit" className={className} aria-label={ariaLabel}>
        {children}
      </button>
    </Form>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const userName = loaderData.userName;

  return (
    <Layout>
      <div className="app-shell app-shell--with-sidebar">
        {/* 모바일 상단 앱바 */}
        <header className="topbar">
          <Logo />
          <div className="topbar__spacer" />
          {userName ? (
            <>
              <Link
                to="/admin"
                prefetch="intent"
                className="icon-btn"
                aria-label="관리자"
                title="관리자"
              >
                <IconShield />
              </Link>
              <ThemeToggle />
              <span className="topbar__user">{userName}님</span>
              <LogoutForm className="icon-btn" ariaLabel="로그아웃">
                <IconLogout />
              </LogoutForm>
            </>
          ) : (
            <>
              <ThemeToggle />
              <Link to="/login" prefetch="intent" className="btn btn--primary btn--sm">
                <IconLogin />
                로그인
              </Link>
            </>
          )}
        </header>

        {/* 데스크톱 사이드바 */}
        <aside className="sidebar">
          <div className="sidebar__logo">
            <Logo />
          </div>
          <nav className="sidebar__nav" aria-label="주 메뉴">
            {mainNav.map(({ to, label, end, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                prefetch={userName ? "render" : "intent"}
                className={({ isActive }) =>
                  `nav-link${isActive ? " is-active" : ""}`
                }
              >
                <Icon />
                {label}
              </NavLink>
            ))}
            <p className="sidebar__section">운영</p>
            <NavLink
              to="/admin"
              prefetch="intent"
              className={({ isActive }) =>
                `nav-link${isActive ? " is-active" : ""}`
              }
            >
              <IconShield />
              관리자
            </NavLink>
          </nav>
          <div className="sidebar__footer">
            <div className="sidebar__user">
              {userName ? (
                <>
                  <span className="sidebar__name">{userName}님</span>
                  <LogoutForm className="sidebar__logout">로그아웃</LogoutForm>
                </>
              ) : (
                <Link to="/login" prefetch="intent" className="btn btn--primary btn--sm">
                  <IconLogin />
                  로그인
                </Link>
              )}
            </div>
            <ThemeToggle />
          </div>
        </aside>

        <main className="main main--wide">
          <Outlet />
        </main>

        {/* 모바일 하단 탭바 */}
        <nav className="tabbar" aria-label="주 메뉴">
          {mainNav.map(({ to, short, end, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              prefetch={userName ? "render" : "intent"}
              className={({ isActive }) =>
                `tabbar__item${isActive ? " is-active" : ""}`
              }
            >
              <Icon />
              {short}
            </NavLink>
          ))}
        </nav>
      </div>
    </Layout>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "알 수 없는 오류";
  return (
    <Layout>
      <div className="app-shell">
        <main className="main main--wide auth-wrap">
          <div className="card error-card">
            <div className="error-card__icon" aria-hidden>
              😵
            </div>
            <h1 className="page-head__title page-head__title--sm">문제가 발생했어요</h1>
            <p className="muted small mt-2">{message}</p>
            <Link to="/" className="btn btn--primary mt-4">
              홈으로
            </Link>
          </div>
        </main>
      </div>
    </Layout>
  );
}
