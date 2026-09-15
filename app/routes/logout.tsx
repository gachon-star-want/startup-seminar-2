import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { clearCookieHeader, SESSION_COOKIE } from "~/lib/auth";

export async function loader() {
  return redirect("/");
}

export async function action() {
  return redirect("/login", {
    headers: { "Set-Cookie": clearCookieHeader(SESSION_COOKIE) },
  });
}
