import { Form, NavLink, Outlet, redirect } from "react-router";
import type { Route } from "./+types/admin";
import { isAdmin } from "~/lib/session";
import { ADMIN_COOKIE, clearCookieHeader } from "~/lib/auth";

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
];

export default function AdminRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="space-y-6">
      {loaderData.authed ? (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-extrabold tracking-tight">관리자</h1>
            <Form method="post" action="/admin">
              <input type="hidden" name="intent" value="logout" />
              <button
                type="submit"
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
              >
                관리자 로그아웃
              </button>
            </Form>
          </div>

          <nav className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `flex-1 rounded-lg px-3 py-1.5 text-center text-sm font-semibold transition ${
                    isActive ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`
                }
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
