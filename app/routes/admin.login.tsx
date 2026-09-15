import { data, Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/admin.login";
import { getCloudflare } from "~/lib/env";
import { isAdmin, sessionSecret } from "~/lib/session";
import {
  ADMIN_COOKIE,
  clearCookieHeader,
  cookieHeader,
  makeAdminToken,
} from "~/lib/auth";
import { Card, ErrorText } from "~/components/ui";

const ADMIN_COOKIE_TTL = 60 * 60 * 12; // 12시간

export async function loader({ request, context }: Route.LoaderArgs) {
  // 이미 관리자 인증됨 → 개요로
  if (await isAdmin(request, context)) throw redirect("/admin");
  return {};
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "login") {
    const password = String(form.get("password") ?? "");
    const expected = env.ADMIN_PASSWORD || "0806";
    if (password !== expected) {
      return data({ error: "비밀번호가 달라요." }, { status: 400 });
    }
    const token = await makeAdminToken(sessionSecret(env));
    return redirect("/admin", {
      headers: { "Set-Cookie": cookieHeader(ADMIN_COOKIE, token, ADMIN_COOKIE_TTL) },
    });
  }

  if (intent === "logout") {
    return redirect("/admin/login", {
      headers: { "Set-Cookie": clearCookieHeader(ADMIN_COOKIE) },
    });
  }

  return data({ error: "알 수 없는 요청이에요." }, { status: 400 });
}

export default function AdminLoginRoute() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="auth-wrap">
      <Card>
        <div className="auth-mark" aria-hidden>
          🔐
        </div>
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <h1 className="page-head__title page-head__title--sm">관리자</h1>
          <p className="muted small" style={{ marginTop: "0.375rem" }}>
            관리자 비밀번호를 입력해 주세요.
          </p>
        </div>
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="login" />
          <input
            name="password"
            type="password"
            className="input"
            placeholder="비밀번호"
            autoFocus
            required
          />
          <ErrorText>{actionData?.error}</ErrorText>
          <button type="submit" className="btn btn--primary btn--block mt-4">
            입장
          </button>
        </Form>
      </Card>
    </div>
  );
}
