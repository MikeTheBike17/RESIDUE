import { Resend } from "npm:resend@4";

const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");
const webhookSecret = Deno.env.get("WELCOME_WEBHOOK_SECRET") ?? "";
const purchaseUrl = Deno.env.get("PURCHASE_URL") ?? "https://www.residue.cc/residue-private.html";
const fromEmail = Deno.env.get("FROM_EMAIL") ?? "Residue <welcome@residue.cc>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const incomingSecret = req.headers.get("x-webhook-secret");
  if (!webhookSecret || incomingSecret !== webhookSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const payload = await req.json().catch(() => null);
  const type = String(payload?.type || "").toUpperCase();
  const record = payload?.record;

  // Send immediately when a new auth user row is inserted.
  // Keep a small fallback for payloads that omit type but include a new record.
  const isInsert = type === "INSERT" || (!payload?.old_record && !!record?.id);
  if (!isInsert || !record?.email) return json({ skipped: true, reason: "not_insert" });

  const email = String(record.email).toLowerCase();
  const firstName = email.split("@")[0] || "there";

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: [email],
    subject: "Welcome to Residue.cc",
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <h2>Welcome to Residue.cc, ${firstName}</h2>
        <p>Your account is ready.</p>
        <p>
          <a href="${purchaseUrl}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">
            Purchase a card today
          </a>
        </p>
      </div>
    `,
  });

  if (error) return json({ error: error.message || "Email send failed" }, 500);
  return json({ ok: true });
});
