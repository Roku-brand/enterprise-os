import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH0_ISSUER = "https://tenant.example.auth0.com/";
process.env.MCP_RESOURCE_URL = "https://solo-ai-organization.aswindow.chatgpt.site/mcp";
process.env.JWT_AUDIENCE = process.env.MCP_RESOURCE_URL;

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("mcp-auth-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const runtime = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("publishes OAuth protected-resource metadata", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/.well-known/oauth-protected-resource"),
    runtime,
    context,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    resource: process.env.MCP_RESOURCE_URL,
    authorization_servers: [process.env.AUTH0_ISSUER],
    scopes_supported: ["org:read", "org:write"],
    bearer_methods_supported: ["header"],
    resource_documentation: "http://localhost/",
  });
});

test("rejects unauthenticated MCP requests with a discovery challenge", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/mcp", { headers: { accept: "application/json" } }),
    runtime,
    context,
  );

  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
  assert.match(response.headers.get("www-authenticate") ?? "", /org:read/);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("allows unauthenticated MCP preflight", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/mcp", { method: "OPTIONS" }),
    runtime,
    context,
  );

  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /authorization/);
});
