import { authConfig, SupabaseAuthenticator } from "@/lib/auth";
import { adminConfig, createAdminOutreachHandlers, createMailgunMailer, mailgunConfig, takedownConfig } from "@/lib/outreach";
import { createDrizzleOutreachStore } from "@/lib/outreach-db";

export const runtime = "nodejs";

const mailgun = mailgunConfig();

const handlers = createAdminOutreachHandlers({
  authenticator: new SupabaseAuthenticator(authConfig()),
  admin: adminConfig(),
  store: createDrizzleOutreachStore(),
  mailer: mailgun.apiKey && mailgun.domain && mailgun.from ? createMailgunMailer(mailgun) : null,
  takedown: takedownConfig()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlers.action(request, id);
}
