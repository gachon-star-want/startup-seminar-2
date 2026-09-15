import { data, Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { eq } from "drizzle-orm";
import { users } from "~/db/schema";
import { getCloudflare } from "~/lib/env";
import { getDb } from "~/db";
import { cookieHeader, makeSessionToken, SESSION_COOKIE } from "~/lib/auth";
import { sessionSecret } from "~/lib/session";
import { Card, ErrorText, inputClass, labelClass, btnPrimary } from "~/components/ui";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL 시크릿이 설정되지 않았습니다.");
  }
  const db = getDb(env.DATABASE_URL);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const studentNumber = String(form.get("studentNumber") ?? "").trim();
  const birth4 = String(form.get("birth4") ?? "").trim();

  if (!name || !studentNumber) {
    return data({ error: "이름과 학번을 모두 입력해 주세요." }, { status: 400 });
  }
  if (birth4 && !/^\d{4}$/.test(birth4)) {
    return data({ error: "생일 4자리는 숫자 4자리(MMDD)로 입력해 주세요." }, { status: 400 });
  }

  const [existing] = await db.select().from(users).where(eq(users.studentNumber, studentNumber)).limit(1);

  let userId: string;
  if (existing) {
    if (existing.name !== name) {
      return data(
        { error: "이 학번으로 등록된 이름과 달라요. 이름을 확인해 주세요." },
        { status: 400 },
      );
    }
    if (birth4 && birth4 !== existing.birth4) {
      return data({ error: "생일 4자리가 등록된 정보와 달라요." }, { status: 400 });
    }
    userId = existing.id;
  } else {
    if (!birth4) {
      return data(
        { error: "첫 로그인이에요! 가입을 위해 생일 4자리(MMDD)를 함께 입력해 주세요." },
        { status: 400 },
      );
    }
    try {
      const [created] = await db.insert(users).values({ name, studentNumber, birth4 }).returning();
      userId = created.id;
    } catch {
      return data({ error: "가입 처리 중 문제가 생겼어요. 다시 시도해 주세요." }, { status: 500 });
    }
  }

  const token = await makeSessionToken(userId, sessionSecret(env));
  return redirect("/", { headers: { "Set-Cookie": cookieHeader(SESSION_COOKIE, token) } });
}

export default function LoginRoute() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <h1 className="text-xl font-bold">로그인 / 회원가입</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          <strong>처음</strong>이면 생일 4자리까지 입력하면 바로 가입돼요.
          <br />
          이미 가입했다면 <strong>이름 + 학번</strong>만 입력하면 돼요.
        </p>
        <Form method="post" className="mt-5 space-y-4">
          <div>
            <label className={labelClass} htmlFor="name">
              이름
            </label>
            <input id="name" name="name" className={inputClass} placeholder="홍길동" required />
          </div>
          <div>
            <label className={labelClass} htmlFor="studentNumber">
              학번
            </label>
            <input
              id="studentNumber"
              name="studentNumber"
              className={inputClass}
              placeholder="202612345"
              inputMode="numeric"
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="birth4">
              생일 4자리 (첫 가입 때만 필요 · MMDD)
            </label>
            <input
              id="birth4"
              name="birth4"
              className={inputClass}
              placeholder="0415"
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
            />
          </div>
          <ErrorText>{actionData?.error}</ErrorText>
          <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? "처리 중..." : "입장하기"}
          </button>
        </Form>
      </Card>
    </div>
  );
}
