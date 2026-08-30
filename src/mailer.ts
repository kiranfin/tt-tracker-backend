import nodemailer, { type Transporter } from "nodemailer";

export class MailNotConfiguredError extends Error {
    constructor() {
        super("Mail transport is not configured");
        this.name = "MailNotConfiguredError";
    }
}

let cachedTransporter: Transporter | null = null;
let cachedFrom: string | null = null;

function getMailConfig() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.TTTRACKER_MAIL_FROM ?? user;

    if (!host || !user || !pass || !from) {
        throw new MailNotConfiguredError();
    }

    const port = Number(process.env.SMTP_PORT ?? 587);
    // Port 465 = implicit TLS. Everything else uses STARTTLS (secure=false),
    // unless SMTP_SECURE explicitly overrides it.
    const secure =
        process.env.SMTP_SECURE !== undefined
            ? process.env.SMTP_SECURE === "true"
            : port === 465;

    return { host, port, secure, user, pass, from };
}

function getTransporter(): { transporter: Transporter; from: string } {
    if (cachedTransporter && cachedFrom) {
        return { transporter: cachedTransporter, from: cachedFrom };
    }

    const config = getMailConfig();

    cachedTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        }
    });
    cachedFrom = config.from;

    return { transporter: cachedTransporter, from: cachedFrom };
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
    const { transporter, from } = getTransporter();

    await transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text
    });
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
        "Falls sich der Link nicht öffnen lässt (z.B. weil du die E-Mail nicht",
        "auf dem Handy hast), gib diesen Code in der App unter \"Ich habe schon",
        "einen Code/Link\" ein:",
        "",
        rawToken,
        "",
        "Der Link/Code ist 1 Stunde gültig und kann nur einmal verwendet werden.",
        "Wenn du das nicht warst, kannst du diese E-Mail ignorieren.",
        "",
        "Dein TT-Tracker",
        "",
        "-----------------------------------------",
        "",
        "Hi,",
        "",
        "you requested to reset your TT-Tracker password.",
        "Open the following link to set a new password:",
        "",
        link,
        "",
        "If the link doesn't open (e.g. because you don't have this email on",
        "your phone), enter this code in the app under \"I already have a",
        "code/link\":",
        "",
        rawToken,
        "",
        "The link/code is valid for 1 hour and can only be used once.",
        "If this wasn't you, you can ignore this email.",
        "",
        "Your TT-Tracker"
    ].join("\n");

    const html = [
        "<p>Hallo,</p>",
        "<p>du hast das Zurücksetzen deines TT-Tracker-Passworts angefordert.",
        " Klicke auf den folgenden Link, um ein neues Passwort zu setzen:</p>",
        `<p><a href="${link}">Passwort zurücksetzen</a></p>`,
        "<p>Falls sich der Link nicht öffnen lässt (z.B. weil du die E-Mail nicht",
        " auf dem Handy hast), gib diesen Code in der App unter",
        " &quot;Ich habe schon einen Code/Link&quot; ein:</p>",
        `<p style="font-family:monospace;font-size:15px;word-break:break-all">${rawToken}</p>`,
        "<p>Der Link/Code ist 1 Stunde gültig und kann nur einmal verwendet werden.",
        " Wenn du das nicht warst, kannst du diese E-Mail ignorieren.</p>",
        "<p>Dein TT-Tracker</p>",
        "<hr style=\"border:none;border-top:1px solid #ddd;margin:20px 0\" />",
        "<p>Hi,</p>",
        "<p>you requested to reset your TT-Tracker password.",
        " Click the following link to set a new password:</p>",
        `<p><a href="${link}">Reset password</a></p>`,
        "<p>If the link doesn't open (e.g. because you don't have this email",
        " on your phone), enter this code in the app under",
        " &quot;I already have a code/link&quot;:</p>",
        `<p style="font-family:monospace;font-size:15px;word-break:break-all">${rawToken}</p>`,
        "<p>The link/code is valid for 1 hour and can only be used once.",
        " If this wasn't you, you can ignore this email.</p>",
        "<p>Your TT-Tracker</p>"
    ].join("");

    await sendMail({
        to: toEmail,
        subject: "TT-Tracker: Passwort zurücksetzen / Reset password",
        html,
        text
    });
}
