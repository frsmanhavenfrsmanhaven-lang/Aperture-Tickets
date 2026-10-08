require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    REST,
    Routes
} = require("discord.js");

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const PORT = Number(process.env.PORT || 3000);

const DASHBOARD_URL = (
    process.env.DASHBOARD_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");

const REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI ||
    `${DASHBOARD_URL}/auth/callback`;

const BOT_NAME = process.env.BOT_NAME || "NexusTickets";

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex");

if (!TOKEN) {
    console.error("ERROR: DISCORD_TOKEN is missing from .env");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("ERROR: CLIENT_ID is missing from .env");
    process.exit(1);
}

if (!CLIENT_SECRET) {
    console.error("ERROR: CLIENT_SECRET is missing from .env");
    process.exit(1);
}

/* =========================================================
   DATABASE
========================================================= */

const DATABASE_FILE = path.join(__dirname, "guilds.json");

let database = {};

if (fs.existsSync(DATABASE_FILE)) {
    try {
        database = JSON.parse(
            fs.readFileSync(DATABASE_FILE, "utf8")
        );
    } catch {
        database = {};
    }
}

function saveDatabase() {
    fs.writeFileSync(
        DATABASE_FILE,
        JSON.stringify(database, null, 2)
    );
}

function getGuildConfig(guildId) {
    if (!database[guildId]) {
        database[guildId] = {
            panel: {
                title: "Need help?",
                description:
                    "Click the button below to create a private support ticket.",
                color: "#5865F2",
                footer: "NexusTickets",
                buttonLabel: "Create Ticket",
                buttonStyle: "Primary",
                thumbnail: "",
                image: ""
            },

            ticket: {
                categoryId: "",
                supportRoleId: "",
                closeRoleId: "",
                prefix: "ticket",
                allowUserClose: true
            },

            lastPanel: {
                channelId: "",
                messageId: ""
            }
        };

        saveDatabase();
    }

    return database[guildId];
}

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

/* =========================================================
   EXPRESS
========================================================= */

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: DASHBOARD_URL.startsWith("https://"),
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    })
);

/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function colorToInt(color) {
    const clean = String(color || "")
        .replace("#", "")
        .trim();

    if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
        return 0x5865f2;
    }

    return parseInt(clean, 16);
}

function isManager(guild) {
    if (!guild) return false;

    if (guild.owner === true) return true;

    const permissions = BigInt(guild.permissions || "0");

    return (
        (permissions &
            BigInt(PermissionFlagsBits.Administrator)) !==
            0n ||
        (permissions &
            BigInt(PermissionFlagsBits.ManageGuild)) !==
            0n
    );
}

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    next();
}

function getInviteURL(guildId = "") {
    const permissions =
        process.env.BOT_PERMISSIONS ||
        "2147609616";

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        permissions,
        scope: "bot applications.commands"
    });

    if (guildId) {
        params.set("guild_id", guildId);
    }

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function getOAuthURL(state) {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "identify guilds",
        state
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function discordAPI(endpoint, options = {}) {
    const response = await fetch(
        `https://discord.com/api/v10${endpoint}`,
        options
    );

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!response.ok) {
        throw new Error(
            `Discord API ${response.status}: ${
                typeof data === "string"
                    ? data
                    : JSON.stringify(data)
            }`
        );
    }

    return data;
}

/* =========================================================
   HTML LAYOUT
========================================================= */

function layout(title, body, user = null) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>${escapeHTML(title)} - ${escapeHTML(BOT_NAME)}</title>

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #080808;
    color: #f5f5f5;
    font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
}

a {
    text-decoration: none;
    color: inherit;
}

.nav {
    height: 70px;
    border-bottom: 1px solid #202020;
    background: #0b0b0b;

    display: flex;
    align-items: center;
    justify-content: space-between;

    padding: 0 32px;
}

.logo {
    font-size: 21px;
    font-weight: 800;
}

.logo span {
    color: #666;
}

.nav-right {
    display: flex;
    align-items: center;
    gap: 12px;
}

.user {
    display: flex;
    align-items: center;
    gap: 9px;
    color: #bbb;
}

.avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #202020;
    object-fit: cover;
}

.container {
    width: min(1180px, calc(100% - 40px));
    margin: auto;
}

.hero {
    text-align: center;
    padding: 110px 0;
}

.hero h1 {
    margin: 0 0 18px;
    font-size: 60px;
    letter-spacing: -3px;
}

.hero p {
    max-width: 680px;
    margin: auto;
    color: #888;
    font-size: 18px;
    line-height: 1.7;
}

.buttons {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 30px;
    flex-wrap: wrap;
}

.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;

    border: 0;
    border-radius: 8px;

    padding: 11px 17px;

    background: #f5f5f5;
    color: #080808;

    font-size: 14px;
    font-weight: 700;

    cursor: pointer;
}

.btn:hover {
    opacity: .85;
}

.btn.secondary {
    background: #171717;
    color: #eee;
    border: 1px solid #292929;
}

.page {
    padding: 38px 0 70px;
}

.page-title {
    margin-bottom: 25px;
}

.page-title h1 {
    margin: 0 0 7px;
    font-size: 31px;
}

.page-title p {
    margin: 0;
    color: #777;
}

.grid {
    display: grid;
    grid-template-columns:
        repeat(auto-fill, minmax(290px, 1fr));

    gap: 16px;
}

.card {
    background: #101010;
    border: 1px solid #222;
    border-radius: 12px;
    padding: 20px;
}

.server {
    display: flex;
    align-items: center;
    gap: 13px;
}

.server-icon {
    width: 55px;
    height: 55px;
    border-radius: 14px;
    background: #1d1d1d;
    object-fit: cover;
}

.server-name {
    font-size: 16px;
    font-weight: 700;
}

.server-id {
    color: #666;
    font-size: 11px;
    margin-top: 4px;
}

.card-actions {
    margin-top: 18px;
    display: flex;
    gap: 8px;
}

.section {
    background: #101010;
    border: 1px solid #222;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 18px;
}

.section h2 {
    margin: 0 0 6px;
    font-size: 18px;
}

.section-desc {
    color: #777;
    font-size: 13px;
    margin-bottom: 20px;
}

.notice {
    background: #111;
    border: 1px solid #282828;
    border-radius: 8px;
    padding: 14px;
    color: #999;
    margin-bottom: 18px;
}

.form-grid {
    display: grid;
    grid-template-columns:
        repeat(2, minmax(0, 1fr));

    gap: 16px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 7px;
}

.field.full {
    grid-column: 1 / -1;
}

label {
    color: #bbb;
    font-size: 13px;
    font-weight: 600;
}

input,
textarea,
select {
    width: 100%;

    background: #080808;
    border: 1px solid #292929;

    color: #eee;

    border-radius: 8px;
    padding: 11px 12px;

    outline: none;
    font-family: inherit;
}

input:focus,
textarea:focus,
select:focus {
    border-color: #555;
}

textarea {
    min-height: 130px;
    resize: vertical;
}

.checkbox {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 9px;
}

.checkbox input {
    width: auto;
}

.actions {
    display: flex;
    gap: 9px;
    flex-wrap: wrap;
    margin-top: 20px;
}

.preview {
    background: #080808;
    border: 1px solid #292929;
    border-radius: 10px;
    padding: 20px;
}

.preview-embed {
    border-left: 4px solid #5865f2;
    background: #151515;
    border-radius: 5px;
    padding: 18px;
}

.preview-title {
    font-weight: 800;
    margin-bottom: 9px;
}

.preview-description {
    color: #aaa;
    white-space: pre-wrap;
    line-height: 1.5;
}

.footer {
    border-top: 1px solid #202020;
    padding: 30px;
    text-align: center;
    color: #555;
    font-size: 13px;
}

@media(max-width: 700px) {

    .form-grid {
        grid-template-columns: 1fr;
    }

    .field.full {
        grid-column: auto;
    }

    .hero h1 {
        font-size: 42px;
    }

    .nav {
        padding: 0 16px;
    }

}

</style>
</head>

<body>

<nav class="nav">

    <a href="/" class="logo">
        ${escapeHTML(BOT_NAME)}<span>.</span>
    </a>

    <div class="nav-right">

        ${
            user
                ? `
                <div class="user">

                    ${
                        user.avatar
                            ? `
                            <img
                                class="avatar"
                                src="${escapeHTML(user.avatar)}"
                            >
                            `
                            : `
                            <div class="avatar"></div>
                            `
                    }

                    <span>
                        ${escapeHTML(
                            user.global_name ||
                                user.username
                        )}
                    </span>

                </div>

                <a class="btn secondary" href="/logout">
                    Logout
                </a>
                `
                : `
                <a class="btn secondary" href="/login">
                    Login with Discord
                </a>
                `
        }

    </div>

</nav>

${body}

<div class="footer">
    ${escapeHTML(BOT_NAME)} · Discord Ticket Management
</div>

</body>
</html>
`;
}

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
    res.send(
        layout(
            "Home",
            `
            <div class="container">

                <div class="hero">

                    <h1>
                        ${escapeHTML(BOT_NAME)}
                    </h1>

                    <p>
                        A modern Discord ticket system with a powerful
                        dashboard for configuring and sending your ticket
                        panels.
                    </p>

                    <div class="buttons">

                        ${
                            req.session.user
                                ? `
                                <a
                                    class="btn"
                                    href="/dashboard"
                                >
                                    Open Dashboard
                                </a>
                                `
                                : `
                                <a
                                    class="btn"
                                    href="/login"
                                >
                                    Login with Discord
                                </a>
                                `
                        }

                        <a
                            class="btn secondary"
                            href="${getInviteURL()}"
                        >
                            Invite Bot
                        </a>

                    </div>

                </div>

            </div>
            `,
            req.session.user
        )
    );
});

/* =========================================================
   LOGIN
========================================================= */

app.get("/login", (req, res) => {
    const state = crypto.randomBytes(32).toString("hex");

    req.session.oauthState = state;

    res.redirect(
        getOAuthURL(state)
    );
});

/* =========================================================
   OAUTH CALLBACK
========================================================= */

app.get("/auth/callback", async (req, res) => {

    try {

        const {
            code,
            state,
            error
        } = req.query;

        if (error) {
            return res.status(400).send(
                layout(
                    "Discord Login Error",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>Discord login failed</h2>

                            <p class="section-desc">
                                ${escapeHTML(error)}
                            </p>

                            <a
                                class="btn"
                                href="/login"
                            >
                                Try Again
                            </a>

                        </div>

                    </div>
                    `
                )
            );
        }

        if (!code) {
            return res.status(400).send(
                layout(
                    "Discord Login Error",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>No authorization code</h2>

                            <p class="section-desc">
                                Discord did not return an authorization code.
                            </p>

                            <a
                                class="btn"
                                href="/login"
                            >
                                Try Again
                            </a>

                        </div>

                    </div>
                    `
                )
            );
        }

        if (
            !state ||
            state !== req.session.oauthState
        ) {

            return res.status(400).send(
                layout(
                    "Discord Login Error",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>Invalid login session</h2>

                            <p class="section-desc">
                                The Discord OAuth session did not match.
                                Start the login again.
                            </p>

                            <a
                                class="btn"
                                href="/login"
                            >
                                Login Again
                            </a>

                        </div>

                    </div>
                    `
                )
            );
        }

        delete req.session.oauthState;

        const tokenResponse = await fetch(
            "https://discord.com/api/v10/oauth2/token",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },

                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: REDIRECT_URI
                })
            }
        );

        const tokenText =
            await tokenResponse.text();

        let tokenData;

        try {
            tokenData =
                JSON.parse(tokenText);
        } catch {
            tokenData = {};
        }

        if (
            !tokenResponse.ok ||
            !tokenData.access_token
        ) {

            console.error(
                "OAuth token error:",
                tokenText
            );

            return res.status(500).send(
                layout(
                    "Discord Login Error",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>Discord OAuth failed</h2>

                            <p class="section-desc">
                                Discord rejected the OAuth login.
                                Check your Client ID, Client Secret
                                and Redirect URI.
                            </p>

                            <a
                                class="btn"
                                href="/login"
                            >
                                Try Again
                            </a>

                        </div>

                    </div>
                    `
                )
            );
        }

        const accessToken =
            tokenData.access_token;

        const user =
            await discordAPI(
                "/users/@me",
                {
                    headers: {
                        Authorization:
                            `Bearer ${accessToken}`
                    }
                }
            );

        const guilds =
            await discordAPI(
                "/users/@me/guilds",
                {
                    headers: {
                        Authorization:
                            `Bearer ${accessToken}`
                    }
                }
            );

        req.session.user = {
            id: user.id,
            username: user.username,
            global_name: user.global_name,

            avatar: user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
                : null
        };

        req.session.guilds = guilds;

        res.redirect("/dashboard");

    } catch (error) {

        console.error(
            "OAuth callback error:",
            error
        );

        res.status(500).send(
            layout(
                "Login Error",
                `
                <div class="container page">

                    <div class="section">

                        <h2>Login error</h2>

                        <p class="section-desc">
                            ${escapeHTML(error.message)}
                        </p>

                        <a
                            class="btn"
                            href="/login"
                        >
                            Try Again
                        </a>

                    </div>

                </div>
                `
            )
        );
    }

});

/* =========================================================
   LOGOUT
========================================================= */

app.get("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/");
    });

});

/* =========================================================
   SERVER SELECTION
========================================================= */

app.get(
    "/dashboard",
    requireLogin,
    async (req, res) => {

        const guilds =
            req.session.guilds || [];

        const manageable =
            guilds.filter(isManager);

        res.send(
            layout(
                "Dashboard",
                `
                <div class="container page">

                    <div class="page-title">

                        <h1>
                            Your Servers
                        </h1>

                        <p>
                            Select a server to manage
                            ${escapeHTML(BOT_NAME)}.
                        </p>

                    </div>

                    <div class="grid">

                        ${
                            manageable.length
                                ? manageable
                                      .map(
                                          (guild) => {

                                              const installed =
                                                  client.guilds.cache.has(
                                                      guild.id
                                                  );

                                              const icon =
                                                  guild.icon
                                                      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
                                                      : "";

                                              return `
                                              <div class="card">

                                                  <div class="server">

                                                      ${
                                                          icon
                                                              ? `
                                                              <img
                                                                  class="server-icon"
                                                                  src="${icon}"
                                                              >
                                                              `
                                                              : `
                                                              <div class="server-icon"></div>
                                                              `
                                                      }

                                                      <div>

                                                          <div class="server-name">
                                                              ${escapeHTML(
                                                                  guild.name
                                                              )}
                                                          </div>

                                                          <div class="server-id">
                                                              ${escapeHTML(
                                                                  guild.id
                                                              )}
                                                          </div>

                                                      </div>

                                                  </div>

                                                  <div class="card-actions">

                                                      ${
                                                          installed
                                                              ? `
                                                              <a
                                                                  class="btn"
                                                                  href="/dashboard/${guild.id}"
                                                              >
                                                                  Manage
                                                              </a>
                                                              `
                                                              : `
                                                              <a
                                                                  class="btn"
                                                                  href="${getInviteURL(guild.id)}"
                                                              >
                                                                  Invite Bot
                                                              </a>
                                                              `
                                                      }

                                                  </div>

                                              </div>
                                              `;
                                          }
                                      )
                                      .join("")
                                : `
                                <div class="card">

                                    <h3>
                                        No manageable servers
                                    </h3>

                                    <p style="color:#777">
                                        You need Administrator or
                                        Manage Server permission.
                                    </p>

                                </div>
                                `
                        }

                    </div>

                </div>
                `,
                req.session.user
            )
        );
    }
);

/* =========================================================
   SERVER DASHBOARD
========================================================= */

app.get(
    "/dashboard/:guildId",
    requireLogin,
    async (req, res) => {

        const guildId =
            req.params.guildId;

        const userGuild =
            (req.session.guilds || [])
                .find(
                    guild => guild.id === guildId
                );

        if (
            !userGuild ||
            !isManager(userGuild)
        ) {

            return res.status(403).send(
                layout(
                    "Access Denied",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>
                                Access denied
                            </h2>

                            <p class="section-desc">
                                You don't have permission
                                to manage this server.
                            </p>

                        </div>

                    </div>
                    `,
                    req.session.user
                )
            );
        }

        const guild =
            client.guilds.cache.get(
                guildId
            );

        if (!guild) {

            return res.send(
                layout(
                    "Bot Not Installed",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>
                                Bot not installed
                            </h2>

                            <p class="section-desc">
                                Invite ${escapeHTML(BOT_NAME)}
                                to this server first.
                            </p>

                            <a
                                class="btn"
                                href="${getInviteURL(guildId)}"
                            >
                                Invite Bot
                            </a>

                        </div>

                    </div>
                    `,
                    req.session.user
                )
            );
        }

        const config =
            getGuildConfig(guildId);

        const channels =
            guild.channels.cache
                .filter(
                    channel =>
                        channel.type ===
                            ChannelType.GuildText ||
                        channel.type ===
                            ChannelType.GuildAnnouncement
                )
                .sort(
                    (a, b) =>
                        a.position - b.position
                );

        const categories =
            guild.channels.cache
                .filter(
                    channel =>
                        channel.type ===
                        ChannelType.GuildCategory
                )
                .sort(
                    (a, b) =>
                        a.position - b.position
                );

        const roles =
            guild.roles.cache
                .filter(
                    role =>
                        role.id !== guild.id
                )
                .sort(
                    (a, b) =>
                        b.position - a.position
                );

        res.send(
            layout(
                `${guild.name} Dashboard`,
                `
                <div class="container page">

                    <div class="page-title">

                        <h1>
                            ${escapeHTML(guild.name)}
                        </h1>

                        <p>
                            Ticket panel configuration
                        </p>

                    </div>

                    <div class="notice">

                        Customize your panel and ticket
                        permissions below. When you click
                        <strong>Save & Send Panel</strong>,
                        the bot will immediately send the
                        panel to your selected Discord channel.

                    </div>

                    <form
                        method="POST"
                        action="/dashboard/${guildId}/save"
                    >

                        <!-- PANEL -->

                        <div class="section">

                            <h2>
                                Ticket Panel
                            </h2>

                            <div class="section-desc">
                                Customize the panel users will see.
                            </div>

                            <div class="form-grid">

                                <div class="field">

                                    <label>
                                        Panel Title
                                    </label>

                                    <input
                                        name="title"
                                        maxlength="256"
                                        value="${escapeHTML(
                                            config.panel.title
                                        )}"
                                        required
                                    >

                                </div>

                                <div class="field">

                                    <label>
                                        Embed Color
                                    </label>

                                    <input
                                        name="color"
                                        value="${escapeHTML(
                                            config.panel.color
                                        )}"
                                        placeholder="#5865F2"
                                    >

                                </div>

                                <div class="field full">

                                    <label>
                                        Panel Description
                                    </label>

                                    <textarea
                                        name="description"
                                    >${escapeHTML(
                                        config.panel.description
                                    )}</textarea>

                                </div>

                                <div class="field">

                                    <label>
                                        Button Label
                                    </label>

                                    <input
                                        name="buttonLabel"
                                        maxlength="80"
                                        value="${escapeHTML(
                                            config.panel.buttonLabel
                                        )}"
                                    >

                                </div>

                                <div class="field">

                                    <label>
                                        Button Style
                                    </label>

                                    <select
                                        name="buttonStyle"
                                    >

                                        <option
                                            value="Primary"
                                            ${
                                                config.panel.buttonStyle ===
                                                "Primary"
                                                    ? "selected"
                                                    : ""
                                            }
                                        >
                                            Blurple
                                        </option>

                                        <option
                                            value="Secondary"
                                            ${
                                                config.panel.buttonStyle ===
                                                "Secondary"
                                                    ? "selected"
                                                    : ""
                                            }
                                        >
                                            Gray
                                        </option>

                                        <option
                                            value="Success"
                                            ${
                                                config.panel.buttonStyle ===
                                                "Success"
                                                    ? "selected"
                                                    : ""
                                            }
                                        >
                                            Green
                                        </option>

                                        <option
                                            value="Danger"
                                            ${
                                                config.panel.buttonStyle ===
                                                "Danger"
                                                    ? "selected"
                                                    : ""
                                            }
                                        >
                                            Red
                                        </option>

                                    </select>

                                </div>

                                <div class="field">

                                    <label>
                                        Footer
                                    </label>

                                    <input
                                        name="footer"
                                        maxlength="2048"
                                        value="${escapeHTML(
                                            config.panel.footer
                                        )}"
                                    >

                                </div>

                                <div class="field">

                                    <label>
                                        Thumbnail URL
                                    </label>

                                    <input
                                        name="thumbnail"
                                        value="${escapeHTML(
                                            config.panel.thumbnail
                                        )}"
                                        placeholder="https://..."
                                    >

                                </div>

                                <div class="field full">

                                    <label>
                                        Large Image URL
                                    </label>

                                    <input
                                        name="image"
                                        value="${escapeHTML(
                                            config.panel.image
                                        )}"
                                        placeholder="https://..."
                                    >

                                </div>

                            </div>

                        </div>

                        <!-- PERMISSIONS -->

                        <div class="section">

                            <h2>
                                Ticket Permissions
                            </h2>

                            <div class="section-desc">
                                Configure who gets access to tickets.
                            </div>

                            <div class="form-grid">

                                <div class="field">

                                    <label>
                                        Ticket Category
                                    </label>

                                    <select
                                        name="categoryId"
                                    >

                                        <option value="">
                                            No Category
                                        </option>

                                        ${categories
                                            .map(
                                                category => `
                                                <option
                                                    value="${category.id}"
                                                    ${
                                                        config.ticket.categoryId ===
                                                        category.id
                                                            ? "selected"
                                                            : ""
                                                    }
                                                >
                                                    ${escapeHTML(
                                                        category.name
                                                    )}
                                                </option>
                                                `
                                            )
                                            .join("")}

                                    </select>

                                </div>

                                <div class="field">

                                    <label>
                                        Support Role
                                    </label>

                                    <select
                                        name="supportRoleId"
                                    >

                                        <option value="">
                                            No Support Role
                                        </option>

                                        ${roles
                                            .map(
                                                role => `
                                                <option
                                                    value="${role.id}"
                                                    ${
                                                        config.ticket.supportRoleId ===
                                                        role.id
                                                            ? "selected"
                                                            : ""
                                                    }
                                                >
                                                    @${escapeHTML(
                                                        role.name
                                                    )}
                                                </option>
                                                `
                                            )
                                            .join("")}

                                    </select>

                                </div>

                                <div class="field">

                                    <label>
                                        Close Permission Role
                                    </label>

                                    <select
                                        name="closeRoleId"
                                    >

                                        <option value="">
                                            Support Role / Admin
                                        </option>

                                        ${roles
                                            .map(
                                                role => `
                                                <option
                                                    value="${role.id}"
                                                    ${
                                                        config.ticket.closeRoleId ===
                                                        role.id
                                                            ? "selected"
                                                            : ""
                                                    }
                                                >
                                                    @${escapeHTML(
                                                        role.name
                                                    )}
                                                </option>
                                                `
                                            )
                                            .join("")}

                                    </select>

                                </div>

                                <div class="field">

                                    <label>
                                        Ticket Name Prefix
                                    </label>

                                    <input
                                        name="prefix"
                                        maxlength="30"
                                        value="${escapeHTML(
                                            config.ticket.prefix
                                        )}"
                                    >

                                </div>

                                <div class="field full">

                                    <label class="checkbox">

                                        <input
                                            type="checkbox"
                                            name="allowUserClose"
                                            ${
                                                config.ticket.allowUserClose
                                                    ? "checked"
                                                    : ""
                                            }
                                        >

                                        Allow the ticket creator
                                        to close their ticket

                                    </label>

                                </div>

                            </div>

                        </div>

                        <!-- SEND -->

                        <div class="section">

                            <h2>
                                Send Ticket Panel
                            </h2>

                            <div class="section-desc">
                                This is the only place ticket panels
                                are sent.
                            </div>

                            <div class="form-grid">

                                <div class="field">

                                    <label>
                                        Discord Channel
                                    </label>

                                    <select
                                        name="channelId"
                                        required
                                    >

                                        <option value="">
                                            Select a channel
                                        </option>

                                        ${channels
                                            .map(
                                                channel => `
                                                <option
                                                    value="${channel.id}"
                                                >
                                                    #${escapeHTML(
                                                        channel.name
                                                    )}
                                                </option>
                                                `
                                            )
                                            .join("")}

                                    </select>

                                </div>

                            </div>

                            <div class="actions">

                                <button
                                    class="btn"
                                    type="submit"
                                >
                                    Save & Send Panel
                                </button>

                                <a
                                    class="btn secondary"
                                    href="/dashboard"
                                >
                                    Back to Servers
                                </a>

                            </div>

                        </div>

                    </form>

                    <!-- PREVIEW -->

                    <div class="section">

                        <h2>
                            Panel Preview
                        </h2>

                        <div class="section-desc">
                            Live preview of the embed.
                        </div>

                        <div class="preview">

                            <div
                                id="previewEmbed"
                                class="preview-embed"
                                style="border-left-color:${escapeHTML(
                                    config.panel.color
                                )}"
                            >

                                <div
                                    id="previewTitle"
                                    class="preview-title"
                                >
                                    ${escapeHTML(
                                        config.panel.title
                                    )}
                                </div>

                                <div
                                    id="previewDescription"
                                    class="preview-description"
                                >
                                    ${escapeHTML(
                                        config.panel.description
                                    )}
                                </div>

                            </div>

                        </div>

                    </div>

                </div>

                <script>

                const title =
                    document.querySelector(
                        '[name="title"]'
                    );

                const description =
                    document.querySelector(
                        '[name="description"]'
                    );

                const color =
                    document.querySelector(
                        '[name="color"]'
                    );

                const previewTitle =
                    document.getElementById(
                        "previewTitle"
                    );

                const previewDescription =
                    document.getElementById(
                        "previewDescription"
                    );

                const previewEmbed =
                    document.getElementById(
                        "previewEmbed"
                    );

                function updatePreview() {

                    previewTitle.textContent =
                        title.value ||
                        "Need help?";

                    previewDescription.textContent =
                        description.value ||
                        "Click the button below to create a private support ticket.";

                    if (
                        /^#[0-9a-fA-F]{6}$/.test(
                            color.value
                        )
                    ) {

                        previewEmbed.style.borderLeftColor =
                            color.value;

                    }

                }

                title.addEventListener(
                    "input",
                    updatePreview
                );

                description.addEventListener(
                    "input",
                    updatePreview
                );

                color.addEventListener(
                    "input",
                    updatePreview
                );

                </script>
                `,
                req.session.user
            )
        );
    }
);

/* =========================================================
   SAVE CONFIG + SEND PANEL
========================================================= */

app.post(
    "/dashboard/:guildId/save",
    requireLogin,
    async (req, res) => {

        try {

            const guildId =
                req.params.guildId;

            const userGuild =
                (req.session.guilds || [])
                    .find(
                        guild =>
                            guild.id === guildId
                    );

            if (
                !userGuild ||
                !isManager(userGuild)
            ) {
                return res.status(403).send(
                    "Access denied."
                );
            }

            const guild =
                client.guilds.cache.get(
                    guildId
                );

            if (!guild) {
                return res.status(400).send(
                    "Bot is not installed."
                );
            }

            const config =
                getGuildConfig(guildId);

            /* PANEL */

            config.panel.title =
                String(
                    req.body.title ||
                        "Need help?"
                ).slice(0, 256);

            config.panel.description =
                String(
                    req.body.description ||
                        "Click the button below to create a private support ticket."
                ).slice(0, 4000);

            config.panel.color =
                String(
                    req.body.color ||
                        "#5865F2"
                );

            config.panel.footer =
                String(
                    req.body.footer || ""
                ).slice(0, 2048);

            config.panel.buttonLabel =
                String(
                    req.body.buttonLabel ||
                        "Create Ticket"
                ).slice(0, 80);

            config.panel.buttonStyle =
                [
                    "Primary",
                    "Secondary",
                    "Success",
                    "Danger"
                ].includes(
                    req.body.buttonStyle
                )
                    ? req.body.buttonStyle
                    : "Primary";

            config.panel.thumbnail =
                String(
                    req.body.thumbnail || ""
                ).slice(0, 1000);

            config.panel.image =
                String(
                    req.body.image || ""
                ).slice(0, 1000);

            /* TICKET */

            config.ticket.categoryId =
                String(
                    req.body.categoryId || ""
                );

            config.ticket.supportRoleId =
                String(
                    req.body.supportRoleId || ""
                );

            config.ticket.closeRoleId =
                String(
                    req.body.closeRoleId || ""
                );

            config.ticket.prefix =
                String(
                    req.body.prefix || "ticket"
                )
                    .replace(
                        /[^a-zA-Z0-9-_]/g,
                        ""
                    )
                    .slice(0, 30) ||
                "ticket";

            config.ticket.allowUserClose =
                req.body.allowUserClose === "on";

            /* CHANNEL */

            const channel =
                guild.channels.cache.get(
                    req.body.channelId
                );

            if (
                !channel ||
                ![
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement
                ].includes(channel.type)
            ) {

                return res.status(400).send(
                    "Invalid Discord channel."
                );
            }

            saveDatabase();

            /* EMBED */

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        config.panel.title
                    )
                    .setDescription(
                        config.panel.description
                    )
                    .setColor(
                        colorToInt(
                            config.panel.color
                        )
                    );

            if (
                config.panel.footer
            ) {

                embed.setFooter({
                    text:
                        config.panel.footer
                });

            }

            if (
                config.panel.thumbnail
            ) {

                try {
                    embed.setThumbnail(
                        config.panel.thumbnail
                    );
                } catch {}

            }

            if (
                config.panel.image
            ) {

                try {
                    embed.setImage(
                        config.panel.image
                    );
                } catch {}

            }

            /* BUTTON */

            let buttonStyle =
                ButtonStyle.Primary;

            if (
                config.panel.buttonStyle ===
                "Secondary"
            ) {
                buttonStyle =
                    ButtonStyle.Secondary;
            }

            if (
                config.panel.buttonStyle ===
                "Success"
            ) {
                buttonStyle =
                    ButtonStyle.Success;
            }

            if (
                config.panel.buttonStyle ===
                "Danger"
            ) {
                buttonStyle =
                    ButtonStyle.Danger;
            }

            const button =
                new ButtonBuilder()
                    .setCustomId(
                        "nexustickets:create"
                    )
                    .setLabel(
                        config.panel.buttonLabel
                    )
                    .setStyle(
                        buttonStyle
                    );

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        button
                    );

            /* SEND */

            const message =
                await channel.send({
                    embeds: [embed],
                    components: [row]
                });

            config.lastPanel = {
                channelId:
                    channel.id,
                messageId:
                    message.id
            };

            saveDatabase();

            res.send(
                layout(
                    "Panel Sent",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>
                                Ticket panel sent
                            </h2>

                            <p class="section-desc">
                                The panel was sent successfully
                                to #${escapeHTML(
                                    channel.name
                                )}.
                            </p>

                            <div class="actions">

                                <a
                                    class="btn"
                                    href="/dashboard/${guildId}"
                                >
                                    Back to Dashboard
                                </a>

                            </div>

                        </div>

                    </div>
                    `,
                    req.session.user
                )
            );

        } catch (error) {

            console.error(
                "SEND PANEL ERROR:",
                error
            );

            res.status(500).send(
                layout(
                    "Panel Error",
                    `
                    <div class="container page">

                        <div class="section">

                            <h2>
                                Panel could not be sent
                            </h2>

                            <p class="section-desc">
                                ${escapeHTML(
                                    error.message
                                )}
                            </p>

                            <a
                                class="btn"
                                href="/dashboard"
                            >
                                Back
                            </a>

                        </div>

                    </div>
                    `,
                    req.session.user
                )
            );
        }
    }
);

/* =========================================================
   TICKET BUTTONS
========================================================= */

client.on(
    "interactionCreate",
    async interaction => {

        if (!interaction.isButton()) {
            return;
        }

        /* =================================================
           CREATE TICKET
        ================================================= */

        if (
            interaction.customId ===
            "nexustickets:create"
        ) {

            try {

                const guild =
                    interaction.guild;

                if (!guild) {
                    return interaction.reply({
                        content:
                            "This button can only be used in a server.",
                        ephemeral: true
                    });
                }

                const config =
                    getGuildConfig(
                        guild.id
                    );

                const existing =
                    guild.channels.cache.find(
                        channel =>
                            channel.type ===
                                ChannelType.GuildText &&
                            channel.topic ===
                                `nexustickets-owner:${interaction.user.id}`
                    );

                if (existing) {

                    return interaction.reply({
                        content:
                            `You already have an open ticket: ${existing}`,
                        ephemeral: true
                    });

                }

                let category = null;

                if (
                    config.ticket.categoryId
                ) {

                    const possible =
                        guild.channels.cache.get(
                            config.ticket.categoryId
                        );

                    if (
                        possible &&
                        possible.type ===
                            ChannelType.GuildCategory
                    ) {
                        category =
                            possible;
                    }

                }

                const overwrites = [

                    {
                        id:
                            guild.roles
                                .everyone.id,

                        deny: [
                            PermissionFlagsBits.ViewChannel
                        ]
                    },

                    {
                        id:
                            interaction.user.id,

                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    }

                ];

                if (
                    config.ticket.supportRoleId
                ) {

                    const role =
                        guild.roles.cache.get(
                            config.ticket.supportRoleId
                        );

                    if (role) {

                        overwrites.push({
                            id: role.id,

                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.AttachFiles,
                                PermissionFlagsBits.EmbedLinks
                            ]
                        });

                    }

                }

                overwrites.push({
                    id: client.user.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels
                    ]
                });

                const username =
                    interaction.user.username
                        .toLowerCase()
                        .replace(
                            /[^a-z0-9-]/g,
                            ""
                        )
                        .slice(0, 40) ||
                    "user";

                const channel =
                    await guild.channels.create({
                        name:
                            `${config.ticket.prefix}-${username}`,

                        type:
                            ChannelType.GuildText,

                        parent:
                            category
                                ? category.id
                                : undefined,

                        topic:
                            `nexustickets-owner:${interaction.user.id}`,

                        permissionOverwrites:
                            overwrites
                    });

                const welcome =
                    new EmbedBuilder()
                        .setTitle(
                            "Ticket Created"
                        )
                        .setDescription(
                            `Welcome ${interaction.user}.\n\n` +
                            "Please explain your issue and our support team will assist you."
                        )
                        .setColor(
                            colorToInt(
                                config.panel.color
                            )
                        )
                        .setFooter({
                            text:
                                BOT_NAME
                        });

                const closeButton =
                    new ButtonBuilder()
                        .setCustomId(
                            "nexustickets:close"
                        )
                        .setLabel(
                            "Close Ticket"
                        )
                        .setStyle(
                            ButtonStyle.Danger
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            closeButton
                        );

                await channel.send({
                    content:
                        `${interaction.user}`,

                    embeds: [
                        welcome
                    ],

                    components: [
                        row
                    ]
                });

                await interaction.reply({
                    content:
                        `Your ticket has been created: ${channel}`,

                    ephemeral: true
                });

            } catch (error) {

                console.error(
                    "CREATE TICKET ERROR:",
                    error
                );

                if (
                    !interaction.replied
                ) {

                    await interaction.reply({
                        content:
                            "I couldn't create the ticket. Make sure the bot has Manage Channels permission.",

                        ephemeral: true
                    });

                }

            }

            return;
        }

        /* =================================================
           CLOSE TICKET
        ================================================= */

        if (
            interaction.customId ===
            "nexustickets:close"
        ) {

            try {

                const channel =
                    interaction.channel;

                if (
                    !channel ||
                    !interaction.guild
                ) {
                    return;
                }

                if (
                    !channel.topic ||
                    !channel.topic.startsWith(
                        "nexustickets-owner:"
                    )
                ) {

                    return interaction.reply({
                        content:
                            "This is not a NexusTickets channel.",

                        ephemeral: true
                    });

                }

                const ownerId =
                    channel.topic.replace(
                        "nexustickets-owner:",
                        ""
                    );

                const config =
                    getGuildConfig(
                        interaction.guild.id
                    );

                const isOwner =
                    interaction.user.id ===
                    ownerId;

                const isAdmin =
                    interaction.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    ) ||
                    interaction.member.permissions.has(
                        PermissionFlagsBits.ManageGuild
                    );

                let hasCloseRole = false;

                if (
                    config.ticket.closeRoleId
                ) {

                    hasCloseRole =
                        interaction.member.roles.cache.has(
                            config.ticket.closeRoleId
                        );

                } else if (
                    config.ticket.supportRoleId
                ) {

                    hasCloseRole =
                        interaction.member.roles.cache.has(
                            config.ticket.supportRoleId
                        );

                }

                if (
                    !isAdmin &&
                    !hasCloseRole &&
                    !(
                        isOwner &&
                        config.ticket.allowUserClose
                    )
                ) {

                    return interaction.reply({
                        content:
                            "You do not have permission to close this ticket.",

                        ephemeral: true
                    });

                }

                await interaction.reply(
                    "Closing this ticket..."
                );

                setTimeout(
                    async () => {

                        try {

                            await channel.delete(
                                "NexusTickets ticket closed"
                            );

                        } catch {}

                    },
                    1000
                );

            } catch (error) {

                console.error(
                    "CLOSE TICKET ERROR:",
                    error
                );

            }

            return;
        }

    }
);

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [

    new SlashCommandBuilder()
        .setName("ticket")
        .setDescription(
            "NexusTickets management commands"
        )
        .addSubcommand(
            sub =>
                sub
                    .setName("status")
                    .setDescription(
                        "View the ticket system status"
                    )
        )
        .addSubcommand(
            sub =>
                sub
                    .setName("config")
                    .setDescription(
                        "View the current ticket configuration"
                    )
        )
        .addSubcommand(
            sub =>
                sub
                    .setName("close")
                    .setDescription(
                        "Close the current ticket"
                    )
        )

].map(
    command => command.toJSON()
);

/* =========================================================
   SLASH COMMAND HANDLER
========================================================= */

client.on(
    "interactionCreate",
    async interaction => {

        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        if (
            interaction.commandName !==
            "ticket"
        ) {
            return;
        }

        const subcommand =
            interaction.options.getSubcommand();

        /* STATUS */

        if (
            subcommand === "status"
        ) {

            const guild =
                interaction.guild;

            if (!guild) {

                return interaction.reply({
                    content:
                        "This command must be used in a server.",
                    ephemeral: true
                });

            }

            const config =
                getGuildConfig(
                    guild.id
                );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `${BOT_NAME} Status`
                    )
                    .setDescription(
                        "Ticket system status for this server."
                    )
                    .addFields(
                        {
                            name:
                                "Panel Channel",
                            value:
                                config.lastPanel.channelId
                                    ? `<#${config.lastPanel.channelId}>`
                                    : "Not configured",
                            inline: true
                        },
                        {
                            name:
                                "Category",
                            value:
                                config.ticket.categoryId
                                    ? `<#${config.ticket.categoryId}>`
                                    : "Not configured",
                            inline: true
                        },
                        {
                            name:
                                "Support Role",
                            value:
                                config.ticket.supportRoleId
                                    ? `<@&${config.ticket.supportRoleId}>`
                                    : "Not configured",
                            inline: true
                        }
                    )
                    .setColor(
                        colorToInt(
                            config.panel.color
                        )
                    );

            return interaction.reply({
                embeds: [
                    embed
                ],
                ephemeral: true
            });

        }

        /* CONFIG */

        if (
            subcommand === "config"
        ) {

            const guild =
                interaction.guild;

            if (!guild) {

                return interaction.reply({
                    content:
                        "This command must be used in a server.",
                    ephemeral: true
                });

            }

            const member =
                interaction.member;

            if (
                !member.permissions.has(
                    PermissionFlagsBits.ManageGuild
                ) &&
                !member.permissions.has(
                    PermissionFlagsBits.Administrator
                )
            ) {

                return interaction.reply({
                    content:
                        "You need Manage Server or Administrator permission.",
                    ephemeral: true
                });

            }

            const config =
                getGuildConfig(
                    guild.id
                );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        "Ticket Configuration"
                    )
                    .addFields(
                        {
                            name:
                                "Panel Title",
                            value:
                                config.panel.title ||
                                "None"
                        },
                        {
                            name:
                                "Panel Channel",
                            value:
                                config.lastPanel.channelId
                                    ? `<#${config.lastPanel.channelId}>`
                                    : "Not sent"
                        },
                        {
                            name:
                                "Support Role",
                            value:
                                config.ticket.supportRoleId
                                    ? `<@&${config.ticket.supportRoleId}>`
                                    : "None"
                        },
                        {
                            name:
                                "Ticket Category",
                            value:
                                config.ticket.categoryId
                                    ? `<#${config.ticket.categoryId}>`
                                    : "None"
                        },
                        {
                            name:
                                "Prefix",
                            value:
                                config.ticket.prefix
                        }
                    )
                    .setColor(
                        colorToInt(
                            config.panel.color
                        )
                    );

            return interaction.reply({
                embeds: [
                    embed
                ],
                ephemeral: true
            });

        }

        /* CLOSE */

        if (
            subcommand === "close"
        ) {

            const channel =
                interaction.channel;

            if (
                !channel ||
                !channel.topic ||
                !channel.topic.startsWith(
                    "nexustickets-owner:"
                )
            ) {

                return interaction.reply({
                    content:
                        "This is not a NexusTickets ticket.",
                    ephemeral: true
                });

            }

            const ownerId =
                channel.topic.replace(
                    "nexustickets-owner:",
                    ""
                );

            const config =
                getGuildConfig(
                    interaction.guild.id
                );

            const isOwner =
                interaction.user.id ===
                ownerId;

            const isAdmin =
                interaction.member.permissions.has(
                    PermissionFlagsBits.Administrator
                ) ||
                interaction.member.permissions.has(
                    PermissionFlagsBits.ManageGuild
                );

            const hasRole =
                config.ticket.closeRoleId &&
                interaction.member.roles.cache.has(
                    config.ticket.closeRoleId
                );

            const supportRole =
                config.ticket.supportRoleId &&
                interaction.member.roles.cache.has(
                    config.ticket.supportRoleId
                );

            if (
                !isAdmin &&
                !hasRole &&
                !supportRole &&
                !(
                    isOwner &&
                    config.ticket.allowUserClose
                )
            ) {

                return interaction.reply({
                    content:
                        "You do not have permission to close this ticket.",
                    ephemeral: true
                });

            }

            await interaction.reply(
                "Closing this ticket..."
            );

            setTimeout(
                async () => {

                    try {

                        await channel.delete(
                            "NexusTickets ticket closed"
                        );

                    } catch {}

                },
                1000
            );

        }

    }
);

/* =========================================================
   REGISTER SLASH COMMANDS
========================================================= */

async function registerCommands() {

    try {

        const rest =
            new REST({
                version: "10"
            }).setToken(
                TOKEN
            );

        console.log(
            "Registering NexusTickets slash commands..."
        );

        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            "Slash commands registered:"
        );

        console.log(
            "  /ticket status"
        );

        console.log(
            "  /ticket config"
        );

        console.log(
            "  /ticket close"
        );

        console.log(
            "Panel sending remains dashboard-only."
        );

    } catch (error) {

        console.error(
            "Slash command registration failed:"
        );

        console.error(
            error
        );

    }

}

/* =========================================================
   BOT READY
========================================================= */

client.once(
    "ready",
    async () => {

        console.log("");
        console.log(
            "======================================"
        );

        console.log(
            `${BOT_NAME} is online`
        );

        console.log(
            `Logged in as: ${client.user.tag}`
        );

        console.log(
            `Servers: ${client.guilds.cache.size}`
        );

        console.log(
            `Dashboard: ${DASHBOARD_URL}`
        );

        console.log(
            `OAuth Redirect: ${REDIRECT_URI}`
        );

        console.log(
            "======================================"
        );

        console.log("");

        await registerCommands();

    }
);

/* =========================================================
   WEB SERVER
========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `Dashboard running at ${DASHBOARD_URL}`
        );

    }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(
    TOKEN
).catch(
    error => {

        console.error(
            "Discord bot login failed:"
        );

        console.error(
            error
        );

    }
);