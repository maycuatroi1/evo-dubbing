import { createManagedInferenceRoutes } from "@/lib/managed/inference-runtime";

export const runtime = "nodejs";

const handlers = createManagedInferenceRoutes();

export const POST = handlers.tts;
