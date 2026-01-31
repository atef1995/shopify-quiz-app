import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Preserve embedded app session and validate request
  await authenticate.admin(request);

  const url = new URL(request.url);
  const params = url.searchParams.toString();
  const clientId = "ccb95c69fbef7812f6a59699510890a1"; // From shopify.app.toml
  const billingUrl = `https://${session.shop}/admin/apps/${clientId}/settings${params ? `?${params}` : ""}`;

  logger.debug("Redirecting legacy /billing route to shop admin app settings", {
    billingUrl,
  });

  return redirect(billingUrl);
};
