import { data, Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { eq } from "drizzle-orm";
import { users } from "~/db/schema";
import { getCloudflare } from "~/lib/env";
import { getDb } from "~/db";
import { cookieHeader, makeSessionToken, SESSION_COOKIE } from "~/lib/auth";
import { sessionSecret } from "~/lib/session";
import { Card, ErrorText, Field, PageHeader } from "~/components/ui";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  if (!env.DB) {
    throw new Error("D1 바인딩(DB)이 wrangler.toml에 설정되지 않았습니다.");
  }
  const db = getDb(env.DB);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();

  if (!name) {
    return data({ error: "이름을 입력해 주세요." }, { status: 400 });
  }

  // 명단 기반 로그인 — 수강생/교수 명단에 등록된 이름만 입장 가능
  const [existing] = await db.select().from(users).where(eq(users.name, name)).limit(1);
  if (!existing) {
    return data(
      { error: "명단에 없는 이름이에요. 이름을 확인하거나 관리자에게 문의해 주세요." },
      { status: 400 },
    );
  }

  const token = await makeSessionToken(existing.id, sessionSecret(env));
  return redirect("/", { headers: { "Set-Cookie": cookieHeader(SESSION_COOKIE, token) } });
}

export default function LoginRoute() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <div className="auth-wrap">
      <Card>
        <div className="auth-mark" aria-hidden>
          🚀
        </div>
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <h1 className="page-head__title page-head__title--sm">로그인</h1>
          <p className="muted small" style={{ marginTop: "0.375rem" }}>
            수강 명단에 등록된 <strong>이름</strong>만 입력하면 돼요.
            <br />
            생일 4자리는 첫 출석체크 때 등록해요.
          </p>
        </div>

        <Form method="post" className="mt-4">
          <Field label="이름" htmlFor="name">
            <input id="name" name="name" className="input" placeholder="홍길동" required />
          </Field>
          <ErrorText>{actionData?.error}</ErrorText>
          <button type="submit" className="btn btn--primary btn--block btn--lg mt-4" disabled={busy}>
            {busy ? "처리 중..." : "입장하기"}
          </button>
        </Form>
      </Card>
    </div>
  );
}
