import { authConfig, SupabaseAuthenticator } from "@/lib/auth";
import { adminConfig, createTakedownRestoreHandlers } from "@/lib/outreach";
import { createDrizzleTakedownStore } from "@/lib/outreach-db";

export const runtime = "nodejs";

const handlers = createTakedownRestoreHandlers({
  authenticator: new SupabaseAuthenticator(authConfig()),
  admin: adminConfig(),
  store: createDrizzleTakedownStore()
});

export const POST = handlers.restore;
