import { createTakedownHandlers, takedownConfig } from "@/lib/outreach";
import { createDrizzleTakedownStore } from "@/lib/outreach-db";

export const runtime = "nodejs";

const handlers = createTakedownHandlers({
  takedown: takedownConfig(),
  store: createDrizzleTakedownStore()
});

export const GET = handlers.apply;
