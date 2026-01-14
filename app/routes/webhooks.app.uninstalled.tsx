import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  logger.webhook(topic, shop || "unknown", "App uninstalled");
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
