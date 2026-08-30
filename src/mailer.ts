const RESEND_API_URL = "https://api.resend.com/emails";

export class MailNotConfiguredError extends Error {
    constructor() {
        super("Mail transport is not configured");
        this.name = "MailNotConfiguredError";
    }
}

function getMailConfig() {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.TTTRACKER_MAIL_FROM;

    if (!apiKey || !from) {
        throw new MailNotConfiguredError();
    }

    return { apiKey, from };
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
    const { apiKey, from } = getMailConfig();

    const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from,
            to: params.to,
            subject: params.subject,
            html: params.html,
            text: params.text
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
            `Resend request failed (${response.status}): ${detail}`
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
