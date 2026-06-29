import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";

const allowOrigin = process.env.ALLOWED_EXTENSION_ORIGIN ?? "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowOrigin,
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: corsHeaders });
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export function newOwnerToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function maxSegments(): number {
  return Number(process.env.MAX_SEGMENTS ?? 2000);
}

export function maxSegmentBytes(): number {
  return Number(process.env.MAX_SEGMENT_BYTES ?? 5_242_880);
}
