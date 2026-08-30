const LETTR_API_URL = "https://app.lettr.com/api/emails";

export class MailNotConfiguredError extends Error {
    constructor() {
        super("Mail transport is not configured");
        this.name = "MailNotConfiguredError";
    }
}

// Accepts a plain "noreply@domain.de" or a "Name <noreply@domain.de>" string and
// splits it into Lettr's separate `from` (email) + `from_name` fields.
function parseFrom(raw: string): { from: string; fromName?: string } {
    const match = raw.match(/^\s*(.*?)\s*<(.+?)>\s*$/);

    if (match) {
        const [, name, email] = match;
        return { from: email.trim(), fromName: name.trim() || undefined };
    }

    return { from: raw.trim() };
}

function getMailConfig() {
    const apiKey = process.env.LETTR_API_KEY;
    const fromRaw = process.env.TTTRACKER_MAIL_FROM;

    if (!apiKey || !fromRaw) {
        throw new MailNotConfiguredError();
    }

    return { apiKey, ...parseFrom(fromRaw) };
}

function buildResetLink(rawToken: string) {
    const base = process.env.TTTRACKER_RESET_URL_BASE ?? "";
    const separator = base.includes("?") ? "&" : "?";

    return `${base}${separator}token=${encodeURIComponent(rawToken)}`;
}

async function sendMail(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
}) {
    const { apiKey, from, fromName } = getMailConfig();

    const response = await fetch(LETTR_API_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from,
            ...(fromName ? { from_name: fromName } : {}),
            to: [params.to],
            subject: params.subject,
            html: params.html,
            text: params.text
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
            `Lettr request failed (${response.status}): ${detail}`
        );
    }
}

export async function sendPasswordResetEmail(
    toEmail: string,
    rawToken: string
): Promise<void> {
    const link = buildResetLink(rawToken);

    const text = [
        "Hallo,",
        "",
        "du hast das Zurücksetzen deines TT-Tracker-Passworts angefordert.",
        "Öffne den folgenden Link, um ein neues Passwort zu setzen:",
        "",
        link,
        "",
        "Der Link ist 1 Stunde gültig und kann nur einmal verwendet werden.",
        "Wenn du das nicht warst, kannst du diese E-Mail ignorieren.",
        "",
        "Dein TT-Tracker"
    ].join("\n");

    const html = [
        "<p>Hallo,</p>",
        "<p>du hast das Zurücksetzen deines TT-Tracker-Passworts angefordert.",
        " Klicke auf den folgenden Link, um ein neues Passwort zu setzen:</p>",
        `<p><a href="${link}">Passwort zurücksetzen</a></p>`,
        "<p>Der Link ist 1 Stunde gültig und kann nur einmal verwendet werden.",
        " Wenn du das nicht warst, kannst du diese E-Mail ignorieren.</p>",
        "<p>Dein TT-Tracker</p>"
    ].join("");

    await sendMail({
        to: toEmail,
        subject: "TT-Tracker: Passwort zurücksetzen",
        html,
        text
    });
}
