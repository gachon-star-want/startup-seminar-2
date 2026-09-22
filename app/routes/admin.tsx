import { Form, NavLink, Outlet, redirect } from "react-router";
import type { Route } from "./+types/admin";
import { isAdmin } from "~/lib/session";
import { ADMIN_COOKIE, clearCookieHeader } from "~/lib/auth";
import { PageHeader } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  return { authed: await isAdmin(request, context) };
}

export async function action({ request }: Route.ActionArgs) {
  // 관리자 로그아웃 (게이트 로그인/로그아웃은 /admin/login 에서 처리)
  const form = await request.formData();
  if (String(form.get("intent")) === "logout") {
    return redirect("/admin/login", {
      headers: { "Set-Cookie": clearCookieHeader(ADMIN_COOKIE) },
    });
  }
  return redirect("/admin/login");
}

const tabs = [
  { to: "/admin", label: "개요", end: true },
  { to: "/admin/attendance", label: "출석 관리", end: false },
  { to: "/admin/assignments", label: "과제 관리", end: false },
  { to: "/admin/evaluations", label: "발표 평가", end: false },
];

export default function AdminRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack-lg">
      {loaderData.authed ? (
        <>
          <PageHeader
            title="관리자"
            right={
              <Form method="post" action="/admin">
                <input type="hidden" name="intent" value="logout" />
                <button type="submit" className="btn btn--ghost btn--sm">
                  관리자 로그아웃
                </button>
              </Form>
            }
          />

          <nav className="tabs" aria-label="관리자 메뉴">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) => `tabs__link${isActive ? " is-active" : ""}`}
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </>
      ) : null}

      <Outlet />
    </div>
  );
}
