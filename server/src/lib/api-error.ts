export const V1_ERROR_CODES = {
  missingToken: "missing_token",
  invalidToken: "invalid_token",
  tokenExpired: "token_expired",
  rateLimited: "rate_limited",
  checkoutDisabled: "checkout_disabled",
  checkoutUnavailable: "checkout_unavailable",
  checkoutFailed: "checkout_failed",
  unknownPlan: "unknown_plan",
  redirectNotAllowed: "redirect_not_allowed",
  invalidPayload: "invalid_payload",
  invalidSignature: "invalid_signature",
  internal: "internal_error"
} as const;

export interface V1ErrorBody {
  error: { code: string; message: string };
}

export function v1Error(
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {}
): Response {
  const body: V1ErrorBody = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

export function v1Json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}
