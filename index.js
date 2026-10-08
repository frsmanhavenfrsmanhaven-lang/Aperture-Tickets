require("dotenv").config();

const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

/* =========================================================
   CONFIG
========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 3000);

const BOT_NAME = process.env.BOT_NAME || "Aperture Tickets";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET";

const DASHBOARD_URL =
    process.env.DASHBOARD_URL ||
    `http://localhost:${PORT}`;

const REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI ||
    `${DASHBOARD_URL}/auth/callback`;

if (!DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN in .env / Render environment.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("Missing CLIENT_ID in .env / Render environment.");
    process.exit(1);
}

if (!CLIENT_SECRET) {
    console.error("Missing CLIENT_SECRET in .env / Render environment.");
    process.exit(1);
}

/* =========================================================
   EXPRESS
========================================================= */

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/*
   IMPORTANT FOR RENDER

   Render sits behind a proxy. Trusting the proxy allows
   Express to correctly understand HTTPS and set secure
   session cookies.
*/

app.set("trust proxy", 1);

app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        proxy: true,
        cookie: {
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24
        }
    })
);

/* =========================================================
   DATA
========================================================= */

const DATA_FILE = path.join(__dirname, "guilds.json");

function loadGuildData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, "{}");
            return {};
        }

        return JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );
    } catch (error) {
        console.error("Could not load guild data:", error);
        return {};
    }
}

let guildData = loadGuildData();

function saveGuildData() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(guildData, null, 2)
        );
    } catch (error) {
        console.error("Could not save guild data:", error);
    }
}

function defaultGuildConfig() {
    return {
        panel: {
            title: "Contact Support",
            description:
                "Click the button below to create a private support ticket.",
            color: "#5865F2",
            footer: "Aperture Tickets",
            buttonLabel: "Create Ticket",
            buttonStyle: "primary",
            thumbnail: "",
            image: ""
        },

        ticket: {
            categoryId: "",
            supportRoleId: "",
            closeRoleId: "",
            allowUserClose: true,
            prefix: "ticket"
        },

        dashboard: {
            panelChannelId: ""
        }
    };
}

function getGuildConfig(guildId) {
    if (!guildData[guildId]) {
        guildData[guildId] = defaultGuildConfig();
        saveGuildData();
    }

    return guildData[guildId];
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
   SLASH COMMANDS
========================================================= */

const slashCommands = [
    new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Aperture Tickets commands.")
        .addSubcommand(sub =>
            sub
                .setName("status")
                .setDescription("View the ticket configuration.")
        )
        .addSubcommand(sub =>
            sub
                .setName("config")
                .setDescription("Open the Aperture Tickets dashboard.")
        )
        .addSubcommand(sub =>
            sub
                .setName("close")
                .setDescription("Close the current ticket.")
        )
].map(command => command.toJSON());

async function registerCommands() {
    try {
        const rest = new REST({ version: "10" })
            .setToken(DISCORD_TOKEN);

        console.log("Registering Aperture Tickets slash commands...");

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: slashCommands
            }
        );

        console.log("Slash commands registered.");
        console.log("  /ticket status");
        console.log("  /ticket config");
        console.log("  /ticket close");
    } catch (error) {
        console.error(
            "Slash command registration error:",
            error
        );
    }
}

/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function isManager(member) {
    if (!member) return false;

    return (
        member.permissions &&
        (
            member.permissions.includes("Administrator") ||
            member.permissions.includes("ManageGuild")
        )
    );
}

function makeDiscordAuthURL(state) {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "identify guilds",
        state
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function discordFetch(url, options = {}) {
    const response = await fetch(url, options);

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return {
        response,
        data
    };
}

/* =========================================================
   AUTH
========================================================= */

app.get("/login", (req, res) => {
    const state =
        require("crypto")
            .randomBytes(32)
            .toString("hex");

    req.session.oauthState = state;

    req.session.save(error => {
        if (error) {
            console.error(
                "Could not save OAuth session:",
                error
            );

            return res
                .status(500)
                .send("Could not start Discord login.");
        }

        res.redirect(makeDiscordAuthURL(state));
    });
});

app.get("/auth/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.status(400).send(`
                <h1>Discord Login Failed</h1>
                <p>Missing OAuth information.</p>
                <a href="/login">Login Again</a>
            `);
        }

        if (
            !req.session.oauthState ||
            req.session.oauthState !== state
        ) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Invalid login session</title>
                    <style>
                        body {
                            margin: 0;
                            background: #090909;
                            color: white;
                            font-family: Arial, sans-serif;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            min-height: 100vh;
                        }

                        .box {
                            width: 420px;
                            max-width: calc(100% - 40px);
                            background: #111;
                            border: 1px solid #292929;
                            border-radius: 18px;
                            padding: 35px;
                            text-align: center;
                        }

                        h1 {
                            margin-top: 0;
                        }

                        a {
                            display: inline-block;
                            margin-top: 20px;
                            padding: 12px 20px;
                            border-radius: 10px;
                            background: #5865f2;
                            color: white;
                            text-decoration: none;
                            font-weight: bold;
                        }
                    </style>
                </head>
                <body>
                    <div class="box">
                        <h1>Invalid login session</h1>
                        <p>
                            The Discord OAuth session did not match.
                            Start the login again.
                        </p>
                        <a href="/login">Login Again</a>
                    </div>
                </body>
                </html>
            `);
        }

        delete req.session.oauthState;

        const tokenResult = await discordFetch(
            "https://discord.com/api/oauth2/token",
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

        if (
            !tokenResult.response.ok ||
            !tokenResult.data
        ) {
            console.error(
                "Discord token exchange failed:",
                tokenResult.data
            );

            return res.status(500).send(`
                <h1>Discord Login Failed</h1>
                <p>Discord rejected the login request.</p>
                <a href="/login">Try Again</a>
            `);
        }

        const accessToken =
            tokenResult.data.access_token;

        const userResult = await discordFetch(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`
                }
            }
        );

        if (!userResult.response.ok) {
            return res.status(500).send(`
                <h1>Discord Login Failed</h1>
                <p>Could not retrieve your Discord account.</p>
                <a href="/login">Try Again</a>
            `);
        }

        const guildResult = await discordFetch(
            "https://discord.com/api/users/@me/guilds",
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`
                }
            }
        );

        const userGuilds =
            guildResult.response.ok &&
            Array.isArray(guildResult.data)
                ? guildResult.data
                : [];

        req.session.user = userResult.data;
        req.session.guilds = userGuilds;

        req.session.save(error => {
            if (error) {
                console.error(
                    "Could not save authenticated session:",
                    error
                );

                return res.status(500).send(
                    "Could not save login session."
                );
            }

            res.redirect("/dashboard");
        });

    } catch (error) {
        console.error(
            "OAuth callback error:",
            error
        );

        res.status(500).send(`
            <h1>Discord Login Failed</h1>
            <p>An unexpected error occurred.</p>
            <a href="/login">Try Again</a>
        `);
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
    const loggedIn = !!req.session.user;

    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(BOT_NAME)}</title>

    <meta name="viewport"
          content="width=device-width, initial-scale=1">

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            background: #070707;
            color: #fff;
            font-family:
                Inter,
                Arial,
                Helvetica,
                sans-serif;
        }

        .nav {
            height: 72px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 6%;
            border-bottom: 1px solid #1b1b1b;
            background: #090909;
        }

        .brand {
            font-size: 21px;
            font-weight: 800;
        }

        .button {
            display: inline-block;
            text-decoration: none;
            color: white;
            background: #5865f2;
            padding: 13px 20px;
            border-radius: 10px;
            font-weight: 700;
            border: 0;
            cursor: pointer;
        }

        .button:hover {
            background: #4752c4;
        }

        .hero {
            min-height: calc(100vh - 72px);
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 50px 20px;
        }

        .hero-content {
            max-width: 800px;
        }

        .hero h1 {
            font-size: clamp(42px, 8vw, 80px);
            margin: 0;
            letter-spacing: -3px;
        }

        .hero p {
            color: #a6a6a6;
            font-size: 19px;
            line-height: 1.6;
            margin: 25px auto 35px;
            max-width: 650px;
        }

        .badge {
            display: inline-block;
            color: #aab0ff;
            border: 1px solid #30346d;
            background: #10122a;
            border-radius: 100px;
            padding: 8px 14px;
            margin-bottom: 20px;
            font-size: 13px;
            font-weight: 700;
        }
    </style>
</head>

<body>

<nav class="nav">
    <div class="brand">${escapeHtml(BOT_NAME)}</div>

    ${
        loggedIn
            ? `<a class="button" href="/dashboard">Dashboard</a>`
            : `<a class="button" href="/login">Login with Discord</a>`
    }
</nav>

<section class="hero">
    <div class="hero-content">

        <div class="badge">
            Discord Ticket Management
        </div>

        <h1>${escapeHtml(BOT_NAME)}</h1>

        <p>
            A modern ticket management system for Discord
            servers. Configure your ticket system from one
            simple dashboard.
        </p>

        ${
            loggedIn
                ? `
                    <a class="button" href="/dashboard">
                        Open Dashboard
                    </a>
                `
                : `
                    <a class="button" href="/login">
                        Login with Discord
                    </a>
                `
        }

    </div>
</section>

</body>
</html>
    `);
});

/* =========================================================
   DASHBOARD
========================================================= */

app.get("/dashboard", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const guilds = Array.isArray(req.session.guilds)
        ? req.session.guilds
        : [];

    const manageableGuilds = guilds.filter(guild => {
        const permissions =
            BigInt(guild.permissions || "0");

        const administrator =
            (permissions &
                PermissionsBitField.Flags.Administrator) !==
            0n;

        const manageGuild =
            (permissions &
                PermissionsBitField.Flags.ManageGuild) !==
            0n;

        return administrator || manageGuild;
    });

    const selectedGuildId =
        req.query.guild ||
        (manageableGuilds[0]
            ? manageableGuilds[0].id
            : "");

    if (!selectedGuildId) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${escapeHtml(BOT_NAME)}</title>
                <style>
                    body {
                        margin: 0;
                        background: #080808;
                        color: white;
                        font-family: Arial;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                    }

                    .box {
                        width: 500px;
                        max-width: 90%;
                        background: #111;
                        border: 1px solid #292929;
                        border-radius: 18px;
                        padding: 35px;
                        text-align: center;
                    }

                    a {
                        color: #8d95ff;
                    }
                </style>
            </head>

            <body>
                <div class="box">
                    <h1>No Manageable Servers</h1>
                    <p>
                        You need Administrator or Manage Server
                        permissions on a Discord server.
                    </p>

                    <a href="/logout">Logout</a>
                </div>
            </body>
            </html>
        `);
    }

    const selectedGuild =
        manageableGuilds.find(
            guild => guild.id === selectedGuildId
        );

    if (!selectedGuild) {
        return res.status(403).send("You do not have access to this server.");
    }

    const config =
        getGuildConfig(selectedGuild.id);

    const botGuild =
        client.guilds.cache.get(selectedGuild.id);

    let channels = [];

    let roles = [];

    if (botGuild) {
        channels = [
            ...botGuild.channels.cache.values()
        ]
            .filter(channel =>
                channel.type === ChannelType.GuildText ||
                channel.type === ChannelType.GuildAnnouncement
            )
            .sort((a, b) =>
                a.position - b.position
            );

        roles = [
            ...botGuild.roles.cache.values()
        ]
            .filter(role => role.id !== botGuild.id)
            .sort((a, b) =>
                b.position - a.position
            );
    }

    const guildOptions = manageableGuilds
        .map(guild => `
            <option
                value="${escapeHtml(guild.id)}"
                ${guild.id === selectedGuildId ? "selected" : ""}
            >
                ${escapeHtml(guild.name)}
            </option>
        `)
        .join("");

    const channelOptions = channels
        .map(channel => `
            <option
                value="${escapeHtml(channel.id)}"
                ${channel.id === config.dashboard.panelChannelId ? "selected" : ""}
            >
                #${escapeHtml(channel.name)}
            </option>
        `)
        .join("");

    const categoryOptions = botGuild
        ? [
            ...botGuild.channels.cache.values()
        ]
            .filter(channel =>
                channel.type === ChannelType.GuildCategory
            )
            .map(channel => `
                <option
                    value="${escapeHtml(channel.id)}"
                    ${channel.id === config.ticket.categoryId ? "selected" : ""}
                >
                    ${escapeHtml(channel.name)}
                </option>
            `)
            .join("")
        : "";

    const roleOptions = roles
        .map(role => `
            <option
                value="${escapeHtml(role.id)}"
                ${role.id === config.ticket.supportRoleId ? "selected" : ""}
            >
                ${escapeHtml(role.name)}
            </option>
        `)
        .join("");

    const closeRoleOptions = roles
        .map(role => `
            <option
                value="${escapeHtml(role.id)}"
                ${role.id === config.ticket.closeRoleId ? "selected" : ""}
            >
                ${escapeHtml(role.name)}
            </option>
        `)
        .join("");

    res.send(`
<!DOCTYPE html>
<html>
<head>

<title>${escapeHtml(BOT_NAME)} Dashboard</title>

<meta name="viewport"
      content="width=device-width, initial-scale=1">

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #080808;
    color: #fff;
    font-family:
        Inter,
        Arial,
        Helvetica,
        sans-serif;
}

.top {
    height: 70px;
    border-bottom: 1px solid #202020;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 30px;
    background: #0b0b0b;
}

.brand {
    font-size: 20px;
    font-weight: 800;
}

.top-right {
    display: flex;
    gap: 15px;
    align-items: center;
}

.user {
    color: #aaa;
    font-size: 14px;
}

.logout {
    color: #aaa;
    text-decoration: none;
}

.container {
    width: min(1150px, 94%);
    margin: 35px auto;
}

.server-box {
    background: #101010;
    border: 1px solid #242424;
    border-radius: 15px;
    padding: 18px;
    margin-bottom: 25px;
}

select,
input,
textarea {
    width: 100%;
    background: #0b0b0b;
    color: white;
    border: 1px solid #303030;
    border-radius: 9px;
    padding: 12px;
    outline: none;
}

select:focus,
input:focus,
textarea:focus {
    border-color: #5865f2;
}

textarea {
    min-height: 130px;
    resize: vertical;
}

.grid {
    display: grid;
    grid-template-columns:
        repeat(auto-fit, minmax(320px, 1fr));
    gap: 20px;
}

.card {
    background: #101010;
    border: 1px solid #242424;
    border-radius: 15px;
    padding: 22px;
}

.card h2 {
    margin-top: 0;
    font-size: 18px;
}

label {
    display: block;
    color: #aaa;
    font-size: 13px;
    margin: 15px 0 7px;
}

.button {
    margin-top: 18px;
    background: #5865f2;
    border: 0;
    border-radius: 9px;
    padding: 12px 17px;
    color: white;
    font-weight: 700;
    cursor: pointer;
}

.button:hover {
    background: #4752c4;
}

.success {
    background: #12361f;
    border: 1px solid #245d36;
    color: #8ee0a7;
    padding: 13px;
    border-radius: 10px;
    margin-bottom: 20px;
}

.warning {
    background: #302a12;
    border: 1px solid #5a4d20;
    color: #e8d58c;
    padding: 13px;
    border-radius: 10px;
    margin-bottom: 20px;
}

.small {
    color: #777;
    font-size: 12px;
    line-height: 1.5;
}

</style>

</head>

<body>

<header class="top">

    <div class="brand">
        ${escapeHtml(BOT_NAME)}
    </div>

    <div class="top-right">

        <div class="user">
            ${escapeHtml(
                req.session.user.username
            )}
        </div>

        <a
            class="logout"
            href="/logout"
        >
            Logout
        </a>

    </div>

</header>

<main class="container">

    <h1>Dashboard</h1>

    <p class="small">
        Configure ${escapeHtml(BOT_NAME)}
        for your Discord server.
    </p>

    <div class="server-box">

        <label>
            Server
        </label>

        <select
            onchange="window.location='/dashboard?guild=' + this.value"
        >
            ${guildOptions}
        </select>

    </div>

    ${
        !botGuild
            ? `
                <div class="warning">
                    Aperture Tickets is not in this server.
                    Invite the bot first before configuring
                    ticket channels and roles.
                </div>
            `
            : ""
    }

    <form
        method="POST"
        action="/dashboard/save"
    >

        <input
            type="hidden"
            name="guildId"
            value="${escapeHtml(selectedGuildId)}"
        >

        <div class="grid">

            <section class="card">

                <h2>Ticket Panel</h2>

                <label>Panel Title</label>

                <input
                    name="title"
                    value="${escapeHtml(config.panel.title)}"
                >

                <label>Description</label>

                <textarea
                    name="description"
                >${escapeHtml(config.panel.description)}</textarea>

                <label>Color</label>

                <input
                    name="color"
                    value="${escapeHtml(config.panel.color)}"
                    placeholder="#5865F2"
                >

                <label>Footer</label>

                <input
                    name="footer"
                    value="${escapeHtml(config.panel.footer)}"
                >

                <label>Button Label</label>

                <input
                    name="buttonLabel"
                    value="${escapeHtml(config.panel.buttonLabel)}"
                >

                <label>Button Style</label>

                <select name="buttonStyle">

                    <option
                        value="primary"
                        ${config.panel.buttonStyle === "primary" ? "selected" : ""}
                    >
                        Blue
                    </option>

                    <option
                        value="success"
                        ${config.panel.buttonStyle === "success" ? "selected" : ""}
                    >
                        Green
                    </option>

                    <option
                        value="secondary"
                        ${config.panel.buttonStyle === "secondary" ? "selected" : ""}
                    >
                        Gray
                    </option>

                    <option
                        value="danger"
                        ${config.panel.buttonStyle === "danger" ? "selected" : ""}
                    >
                        Red
                    </option>

                </select>

                <label>Thumbnail URL</label>

                <input
                    name="thumbnail"
                    value="${escapeHtml(config.panel.thumbnail)}"
                    placeholder="https://..."
                >

                <label>Image URL</label>

                <input
                    name="image"
                    value="${escapeHtml(config.panel.image)}"
                    placeholder="https://..."
                >

            </section>

            <section class="card">

                <h2>Ticket Settings</h2>

                <label>Ticket Category</label>

                <select name="categoryId">

                    <option value="">
                        No category
                    </option>

                    ${categoryOptions}

                </select>

                <label>Support Role</label>

                <select name="supportRoleId">

                    <option value="">
                        No support role
                    </option>

                    ${roleOptions}

                </select>

                <label>Close Permission Role</label>

                <select name="closeRoleId">

                    <option value="">
                        Anyone with permission
                    </option>

                    ${closeRoleOptions}

                </select>

                <label>Ticket Prefix</label>

                <input
                    name="prefix"
                    value="${escapeHtml(config.ticket.prefix)}"
                >

                <label>
                    Allow ticket creator to close tickets
                </label>

                <select name="allowUserClose">

                    <option
                        value="true"
                        ${config.ticket.allowUserClose ? "selected" : ""}
                    >
                        Yes
                    </option>

                    <option
                        value="false"
                        ${!config.ticket.allowUserClose ? "selected" : ""}
                    >
                        No
                    </option>

                </select>

            </section>

            <section class="card">

                <h2>Dashboard Panel Channel</h2>

                <label>
                    Send the ticket panel to
                </label>

                <select name="panelChannelId">

                    <option value="">
                        Select a channel
                    </option>

                    ${channelOptions}

                </select>

                <p class="small">
                    Ticket panels can only be sent from
                    the Aperture Tickets dashboard.
                </p>

                <button
                    class="button"
                    type="submit"
                >
                    Save & Send Panel
                </button>

            </section>

        </div>

    </form>

</main>

</body>
</html>
    `);
});

/* =========================================================
   SAVE DASHBOARD
========================================================= */

app.post("/dashboard/save", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const {
        guildId,
        title,
        description,
        color,
        footer,
        buttonLabel,
        buttonStyle,
        thumbnail,
        image,
        categoryId,
        supportRoleId,
        closeRoleId,
        allowUserClose,
        prefix,
        panelChannelId
    } = req.body;

    if (!guildId) {
        return res.status(400).send("Missing guild ID.");
    }

    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
        return res.status(400).send(
            "Aperture Tickets is not in this server."
        );
    }

    const config = getGuildConfig(guildId);

    config.panel.title =
        title || "Contact Support";

    config.panel.description =
        description ||
        "Click the button below to create a private support ticket.";

    config.panel.color =
        color || "#5865F2";

    config.panel.footer =
        footer || BOT_NAME;

    config.panel.buttonLabel =
        buttonLabel || "Create Ticket";

    config.panel.buttonStyle =
        buttonStyle || "primary";

    config.panel.thumbnail =
        thumbnail || "";

    config.panel.image =
        image || "";

    config.ticket.categoryId =
        categoryId || "";

    config.ticket.supportRoleId =
        supportRoleId || "";

    config.ticket.closeRoleId =
        closeRoleId || "";

    config.ticket.allowUserClose =
        allowUserClose !== "false";

    config.ticket.prefix =
        prefix || "ticket";

    config.dashboard.panelChannelId =
        panelChannelId || "";

    saveGuildData();

    if (!panelChannelId) {
        return res.redirect(
            `/dashboard?guild=${encodeURIComponent(guildId)}`
        );
    }

    const channel =
        guild.channels.cache.get(panelChannelId);

    if (!channel) {
        return res.status(400).send(
            "The selected channel could not be found."
        );
    }

    try {
        const embed = new EmbedBuilder()
            .setTitle(config.panel.title)
            .setDescription(config.panel.description)
            .setColor(
                config.panel.color || "#5865F2"
            );

        if (config.panel.footer) {
            embed.setFooter({
                text: config.panel.footer
            });
        }

        if (config.panel.thumbnail) {
            embed.setThumbnail(
                config.panel.thumbnail
            );
        }

        if (config.panel.image) {
            embed.setImage(
                config.panel.image
            );
        }

        const styles = {
            primary: ButtonStyle.Primary,
            secondary: ButtonStyle.Secondary,
            success: ButtonStyle.Success,
            danger: ButtonStyle.Danger
        };

        const button =
            new ButtonBuilder()
                .setCustomId("aperture_create_ticket")
                .setLabel(
                    config.panel.buttonLabel ||
                    "Create Ticket"
                )
                .setStyle(
                    styles[
                        config.panel.buttonStyle
                    ] || ButtonStyle.Primary
                );

        const row =
            new ActionRowBuilder()
                .addComponents(button);

        await channel.send({
            embeds: [embed],
            components: [row]
        });

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Panel Sent</title>
                <meta
                    http-equiv="refresh"
                    content="2;url=/dashboard?guild=${encodeURIComponent(guildId)}"
                >

                <style>
                    body {
                        margin: 0;
                        background: #080808;
                        color: white;
                        font-family: Arial;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                    }

                    .box {
                        background: #111;
                        border: 1px solid #292929;
                        border-radius: 18px;
                        padding: 35px;
                        text-align: center;
                    }
                </style>
            </head>

            <body>
                <div class="box">
                    <h1>Panel Sent</h1>
                    <p>
                        Your Aperture Tickets panel was
                        sent successfully.
                    </p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error(
            "Could not send ticket panel:",
            error
        );

        res.status(500).send(`
            <h1>Could not send panel</h1>
            <p>
                Make sure Aperture Tickets has permission
                to view and send messages in that channel.
            </p>
        `);
    }
});

/* =========================================================
   DISCORD INTERACTIONS
========================================================= */

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isChatInputCommand()) {

            if (
                interaction.commandName === "ticket"
            ) {

                const subcommand =
                    interaction.options.getSubcommand();

                if (subcommand === "status") {

                    const config =
                        getGuildConfig(
                            interaction.guildId
                        );

                    const embed =
                        new EmbedBuilder()
                            .setTitle(
                                "Aperture Tickets Status"
                            )
                            .setColor("#5865F2")
                            .addFields(
                                {
                                    name: "Panel Channel",
                                    value:
                                        config.dashboard.panelChannelId
                                            ? `<#${config.dashboard.panelChannelId}>`
                                            : "Not configured",
                                    inline: true
                                },
                                {
                                    name: "Category",
                                    value:
                                        config.ticket.categoryId
                                            ? `<#${config.ticket.categoryId}>`
                                            : "Not configured",
                                    inline: true
                                },
                                {
                                    name: "Support Role",
                                    value:
                                        config.ticket.supportRoleId
                                            ? `<@&${config.ticket.supportRoleId}>`
                                            : "Not configured",
                                    inline: true
                                }
                            )
                            .setFooter({
                                text: BOT_NAME
                            });

                    return interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });
                }

                if (subcommand === "config") {

                    const url =
                        `${DASHBOARD_URL}/dashboard?guild=${interaction.guildId}`;

                    return interaction.reply({
                        content:
                            `Configure **${BOT_NAME}** here:\n${url}`,
                        ephemeral: true
                    });
                }

                if (subcommand === "close") {

                    if (
                        !interaction.channel ||
                        !interaction.channel.name.startsWith(
                            "ticket-"
                        )
                    ) {
                        return interaction.reply({
                            content:
                                "This command can only be used inside a ticket.",
                            ephemeral: true
                        });
                    }

                    await interaction.reply(
                        "Closing this ticket..."
                    );

                    setTimeout(async () => {
                        try {
                            await interaction.channel.delete(
                                "Ticket closed"
                            );
                        } catch {}
                    }, 1500);

                    return;
                }
            }
        }

        if (
            interaction.isButton() &&
            interaction.customId ===
                "aperture_create_ticket"
        ) {
            const guild =
                interaction.guild;

            const config =
                getGuildConfig(guild.id);

            const existing =
                guild.channels.cache.find(
                    channel =>
                        channel.name ===
                        `${config.ticket.prefix}-${interaction.user.id}`
                );

            if (existing) {
                return interaction.reply({
                    content:
                        `You already have a ticket: ${existing}`,
                    ephemeral: true
                });
            }

            const permissionOverwrites = [
                {
                    id: guild.roles.everyone.id,
                    deny: [
                        PermissionsBitField.Flags.ViewChannel
                    ]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ];

            if (config.ticket.supportRoleId) {
                permissionOverwrites.push({
                    id: config.ticket.supportRoleId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                });
            }

            const ticketChannel =
                await guild.channels.create({
                    name:
                        `${config.ticket.prefix}-${interaction.user.id}`,
                    type: ChannelType.GuildText,
                    parent:
                        config.ticket.categoryId || undefined,
                    permissionOverwrites
                });

            const closeButton =
                new ButtonBuilder()
                    .setCustomId(
                        "aperture_close_ticket"
                    )
                    .setLabel("Close Ticket")
                    .setStyle(
                        ButtonStyle.Danger
                    );

            const row =
                new ActionRowBuilder()
                    .addComponents(closeButton);

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        "Aperture Tickets"
                    )
                    .setDescription(
                        `Welcome <@${interaction.user.id}>.\n\n` +
                        `A member of the support team will be with you shortly.\n\n` +
                        `Use the button below when you are finished.`
                    )
                    .setColor("#5865F2")
                    .setFooter({
                        text: BOT_NAME
                    });

            await ticketChannel.send({
                content:
                    config.ticket.supportRoleId
                        ? `<@&${config.ticket.supportRoleId}>`
                        : "",
                embeds: [embed],
                components: [row]
            });

            return interaction.reply({
                content:
                    `Your ticket has been created: ${ticketChannel}`,
                ephemeral: true
            });
        }

        if (
            interaction.isButton() &&
            interaction.customId ===
                "aperture_close_ticket"
        ) {
            const guild =
                interaction.guild;

            const config =
                getGuildConfig(guild.id);

            const member =
                interaction.member;

            const isCreator =
                interaction.channel.name ===
                `${config.ticket.prefix}-${interaction.user.id}`;

            const hasCloseRole =
                config.ticket.closeRoleId &&
                member.roles.cache.has(
                    config.ticket.closeRoleId
                );

            const administrator =
                member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                );

            if (
                !config.ticket.allowUserClose &&
                !hasCloseRole &&
                !administrator
            ) {
                return interaction.reply({
                    content:
                        "You do not have permission to close this ticket.",
                    ephemeral: true
                });
            }

            if (
                config.ticket.allowUserClose &&
                !isCreator &&
                !hasCloseRole &&
                !administrator
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

            setTimeout(async () => {
                try {
                    await interaction.channel.delete(
                        "Ticket closed"
                    );
                } catch {}
            }, 1500);
        }

    } catch (error) {
        console.error(
            "Interaction error:",
            error
        );

        if (
            interaction.isRepliable() &&
            !interaction.replied &&
            !interaction.deferred
        ) {
            await interaction.reply({
                content:
                    "An unexpected error occurred.",
                ephemeral: true
            });
        }
    }
});

/* =========================================================
   DISCORD READY
========================================================= */

client.once("ready", async () => {
    console.log("");
    console.log("======================================");
    console.log(`${BOT_NAME} is online`);
    console.log(`Logged in as ${client.user.tag}`);
    console.log("======================================");
    console.log("");

    await registerCommands();
});

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on("error", error => {
    console.error(
        "Discord client error:",
        error
    );
});

process.on("unhandledRejection", error => {
    console.error(
        "Unhandled rejection:",
        error
    );
});

process.on("uncaughtException", error => {
    console.error(
        "Uncaught exception:",
        error
    );
});

/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `${BOT_NAME} dashboard running on port ${PORT}`
        );

        console.log(
            `Dashboard URL: ${DASHBOARD_URL}`
        );

        console.log(
            `OAuth Redirect: ${REDIRECT_URI}`
        );
    }
);

client.login(DISCORD_TOKEN);
