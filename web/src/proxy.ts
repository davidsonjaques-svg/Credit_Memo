import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Runs before every page. Refreshes the Supabase session cookie, then:
 *   not signed in            → /login
 *   signed in, no 2FA yet    → /mfa  (set up or enter the authenticator code)
 *   signed in with 2FA       → the app
 * The 2FA check reads the `aal` claim in the session token: aal2 means the
 * authenticator code was entered for this session.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const signedIn = Boolean(claims?.sub);
  const twoFactorDone = claims?.aal === "aal2";

  const { pathname } = request.nextUrl;
  const onLogin = pathname.startsWith("/login");
  const onMfa = pathname.startsWith("/mfa");

  const go = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Keep any refreshed auth cookies on the redirect
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!signedIn) return onLogin ? response : go("/login");
  if (!twoFactorDone) return onMfa ? response : go("/mfa");
  if (onLogin || onMfa) return go("/");
  return response;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
