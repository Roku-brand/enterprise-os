import { protectedResourceMetadata } from "../../../lib/mcp-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ dotwellknown: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { dotwellknown } = await context.params;
  if (dotwellknown !== ".well-known") return Response.json({ error: "not_found" }, { status: 404 });

  const metadata = protectedResourceMetadata(request);
  if (!metadata) {
    return Response.json(
      { error: "server_configuration_error", error_description: "AUTH0_ISSUER is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(metadata, { headers: { "Cache-Control": "public, max-age=300" } });
}
