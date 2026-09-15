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

export const meta: Route.MetaFunction = () => [
  { title: "창업심화세미나2" },
  { name: "description", content: "창업심화세미나2 출석·팀·과제 관리 페이지" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await getCurrentUser(request, context);
  return { userName: user?.name ?? null };
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const navItems = [
  { to: "/", label: "홈", end: true },
  { to: "/attendance", label: "출석" },
  { to: "/board", label: "리더보드" },
  { to: "/team", label: "내 팀" },
  { to: "/assignments", label: "과제" },
  { to: "/admin", label: "관리자" },
];

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <Layout>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2.5 sm:gap-2">
          <Link to="/" className="mr-2 shrink-0 font-extrabold tracking-tight text-indigo-600">
            🚀 창업심화세미나<span className="hidden sm:inline">2</span>
          </Link>
          <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `shrink-0 rounded-lg px-2.5 py-1.5 font-medium transition ${
                    isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            {loaderData.userName ? (
              <>
                <span className="hidden font-medium text-slate-700 sm:inline">
                  {loaderData.userName}님
                </span>
                <Form method="post" action="/logout">
                  <button
                    type="submit"
                    className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                  >
                    로그아웃
                  </button>
                </Form>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                로그인
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-16">
        <Outlet />
      </main>
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
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="text-5xl">😵</div>
        <h1 className="mt-4 text-xl font-bold">문제가 발생했어요</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
        >
          홈으로
        </Link>
      </main>
    </Layout>
  );
}
