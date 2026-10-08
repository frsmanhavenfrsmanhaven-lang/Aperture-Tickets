require("dotenv").config();

const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

/* =========================================================
   APERTURE TICKETS
   FULL SINGLE-FILE VERSION
========================================================= */

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 3000);

const BOT_NAME =
    process.env.BOT_NAME || "Aperture Tickets";

const DISCORD_TOKEN =
    process.env.DISCORD_TOKEN;

const CLIENT_ID =
    process.env.CLIENT_ID;

const CLIENT_SECRET =
    process.env.CLIENT_SECRET;

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(48).toString("hex");

const DASHBOARD_URL =
    process.env.DASHBOARD_URL ||
    `http://localhost:${PORT}`;

const REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI ||
    `${DASHBOARD_URL}/auth/callback`;

if (!DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("Missing CLIENT_ID.");
    process.exit(1);
}

if (!CLIENT_SECRET) {
    console.error("Missing CLIENT_SECRET.");
    process.exit(1);
}

/* =========================================================
   DATA STORAGE
========================================================= */

const DATA_FILE =
    path.join(__dirname, "guilds.json");

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        "{}",
        "utf8"
    );
}

let guildData = loadData();

function loadData() {
    try {
        return JSON.parse(
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            )
        );
    } catch (error) {
        console.error(
            "Failed to load guild data:",
            error
        );

        return {};
    }
}

function saveData() {
    try {
        const temporaryFile =
            `${DATA_FILE}.tmp`;

        fs.writeFileSync(
            temporaryFile,
            JSON.stringify(
                guildData,
                null,
                2
            ),
            "utf8"
        );

        fs.renameSync(
            temporaryFile,
            DATA_FILE
        );
    } catch (error) {
        console.error(
            "Failed to save guild data:",
            error
        );
    }
}

/* =========================================================
   DEFAULT SERVER CONFIG
========================================================= */

function defaultConfig() {
    return {
        panel: {
            title: "Contact Support",

            description:
                "Need help? Click the button below to create a private support ticket.",

            color: "#5865F2",

            footer:
                BOT_NAME,

            buttonLabel:
                "Create Ticket",

            buttonStyle:
                "primary",

            thumbnail:
                "",

            image:
                ""
        },

        ticket: {
            categoryId:
                "",

            supportRoleId:
                "",

            closeRoleId:
                "",

            allowUserClose:
                true,

            prefix:
                "ticket",

            maxOpenPerUser:
                1,

            welcomeMessage:
                "Welcome to your support ticket. Please explain what you need help with.",

            transcriptChannelId:
                ""
        },

        logging: {
            enabled:
                false,

            channelId:
                ""
        },

        dashboard: {
            panelChannelId:
                ""
        }
    };
}

/* =========================================================
   CONFIG MERGING
========================================================= */

function mergeDefaults(
    target,
    defaults
) {
    for (
        const [key, value]
        of Object.entries(defaults)
    ) {
        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
        ) {
            if (
                !target[key] ||
                typeof target[key] !== "object"
            ) {
                target[key] = {};
            }

            mergeDefaults(
                target[key],
                value
            );
        } else if (
            target[key] === undefined
        ) {
            target[key] = value;
        }
    }

    return target;
}

function getConfig(guildId) {
    if (!guildData[guildId]) {
        guildData[guildId] =
            defaultConfig();
    }

    mergeDefaults(
        guildData[guildId],
        defaultConfig()
    );

    return guildData[guildId];
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
        .replaceAll(
            "'",
            "&#039;"
        );
}

function text(
    value,
    fallback = ""
) {
    const result =
        String(value ?? "").trim();

    return result || fallback;
}

function normalizeColor(
    color
) {
    if (
        /^#[0-9a-fA-F]{6}$/.test(
            String(color || "")
        )
    ) {
        return color;
    }

    return "#5865F2";
}

function normalizePrefix(
    prefix
) {
    let result =
        String(prefix || "ticket")
            .toLowerCase()
            .replace(
                /[^a-z0-9-_]/g,
                "-"
            )
            .replace(
                /-+/g,
                "-"
            )
            .replace(
                /^-|-$/g,
                ""
            )
            .slice(0, 20);

    return result || "ticket";
}

function safeUrl(
    value
) {
    const url =
        String(value || "").trim();

    if (!url) {
        return "";
    }

    try {
        const parsed =
            new URL(url);

        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return "";
        }

        return parsed.toString();

    } catch {
        return "";
    }
}

function buttonStyle(
    style
) {
    const styles = {
        primary:
            ButtonStyle.Primary,

        secondary:
            ButtonStyle.Secondary,

        success:
            ButtonStyle.Success,

        danger:
            ButtonStyle.Danger
    };

    return (
        styles[style] ||
        ButtonStyle.Primary
    );
}

function isManager(
    member
) {
    if (!member) {
        return false;
    }

    return (
        member.permissions?.has(
            PermissionsBitField.Flags.Administrator
        ) ||
        member.permissions?.has(
            PermissionsBitField.Flags.ManageGuild
        )
    );
}

function isTicketChannel(
    channel,
    config
) {
    if (
        !channel ||
        !channel.name
    ) {
        return false;
    }

    return channel.name.startsWith(
        `${normalizePrefix(
            config.ticket.prefix
        )}-`
    );
}

function getTicketOwner(
    channel,
    config
) {
    if (
        !isTicketChannel(
            channel,
            config
        )
    ) {
        return null;
    }

    const prefix =
        `${normalizePrefix(
            config.ticket.prefix
        )}-`;

    const id =
        channel.name.slice(
            prefix.length
        );

    if (
        /^\d{15,25}$/.test(id)
    ) {
        return id;
    }

    return null;
}

/* =========================================================
   EMBEDS
========================================================= */

function createPanelEmbed(
    config
) {
    const embed =
        new EmbedBuilder()
            .setTitle(
                text(
                    config.panel.title,
                    "Contact Support"
                )
            )
            .setDescription(
                text(
                    config.panel.description,
                    "Click the button below to create a private support ticket."
                )
            )
            .setColor(
                normalizeColor(
                    config.panel.color
                )
            );

    if (
        config.panel.footer
    ) {
        embed.setFooter({
            text:
                String(
                    config.panel.footer
                ).slice(
                    0,
                    2048
                )
        });
    }

    const thumbnail =
        safeUrl(
            config.panel.thumbnail
        );

    const image =
        safeUrl(
            config.panel.image
        );

    if (thumbnail) {
        embed.setThumbnail(
            thumbnail
        );
    }

    if (image) {
        embed.setImage(
            image
        );
    }

    return embed;
}

function createPanelComponents(
    config
) {
    const button =
        new ButtonBuilder()
            .setCustomId(
                "aperture:create_ticket"
            )
            .setLabel(
                text(
                    config.panel.buttonLabel,
                    "Create Ticket"
                ).slice(
                    0,
                    80
                )
            )
            .setStyle(
                buttonStyle(
                    config.panel.buttonStyle
                )
            );

    return [
        new ActionRowBuilder()
            .addComponents(button)
    ];
}

/* =========================================================
   TICKET CONTROLS
========================================================= */

function createTicketControls() {

    const firstRow =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        "aperture:claim"
                    )
                    .setLabel(
                        "Claim"
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "aperture:close"
                    )
                    .setLabel(
                        "Close"
                    )
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    const secondRow =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        "aperture:add"
                    )
                    .setLabel(
                        "Add User"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "aperture:remove"
                    )
                    .setLabel(
                        "Remove User"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "aperture:rename"
                    )
                    .setLabel(
                        "Rename"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            );

    return [
        firstRow,
        secondRow
    ];
}

/* =========================================================
   TICKET EMBED
========================================================= */

function createTicketEmbed(
    config,
    userId,
    claimedBy = null
) {
    let description =
        text(
            config.ticket.welcomeMessage,
            "Welcome to your support ticket. Please explain what you need help with."
        );

    description +=
        `\n\nTicket owner: <@${userId}>`;

    if (claimedBy) {
        description +=
            `\nClaimed by: <@${claimedBy}>`;
    }

    return new EmbedBuilder()
        .setTitle(
            "Support Ticket"
        )
        .setDescription(
            description
        )
        .setColor(
            normalizeColor(
                config.panel.color
            )
        )
        .setFooter({
            text:
                BOT_NAME
        });
}

/* =========================================================
   LOGGING
========================================================= */

async function sendLog(
    guild,
    config,
    embed
) {
    if (
        !config.logging.enabled ||
        !config.logging.channelId
    ) {
        return;
    }

    const channel =
        guild.channels.cache.get(
            config.logging.channelId
        );

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        return;
    }

    try {
        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error(
            "Log error:",
            error.message
        );
    }
}

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client =
    new Client({
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
        .setDescription(
            "Aperture Tickets commands."
        )

        .addSubcommand(
            sub =>
                sub
                    .setName("status")
                    .setDescription(
                        "View ticket configuration."
                    )
        )

        .addSubcommand(
            sub =>
                sub
                    .setName("config")
                    .setDescription(
                        "Open the ticket dashboard."
                    )
        )

        .addSubcommand(
            sub =>
                sub
                    .setName("close")
                    .setDescription(
                        "Close the current ticket."
                    )
        )

        .addSubcommand(
            sub =>
                sub
                    .setName("claim")
                    .setDescription(
                        "Claim the current ticket."
                    )
        )

        .addSubcommand(
            sub =>
                sub
                    .setName("add")
                    .setDescription(
                        "Add a user to the current ticket."
                    )
                    .addUserOption(
                        option =>
                            option
                                .setName("user")
                                .setDescription(
                                    "User to add."
                                )
                                .setRequired(true)
                    )
        )

        .addSubcommand(
            sub =>
                sub
                    .setName("remove")
                    .setDescription(
                        "Remove a user from the current ticket."
                    )
                    .addUserOption(
                        option =>
                            option
                                .setName("user")
                                .setDescription(
                                    "User to remove."
                                )
                                .setRequired(true)
                    )
        )

        .addSubcommand(
            sub =>
                sub
                    .setName("rename")
                    .setDescription(
                        "Rename the current ticket."
                    )
                    .addStringOption(
                        option =>
                            option
                                .setName("name")
                                .setDescription(
                                    "New ticket name."
                                )
                                .setRequired(true)
                    )
        )

].map(
    command =>
        command.toJSON()
);

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {

    try {

        const rest =
            new REST({
                version: "10"
            }).setToken(
                DISCORD_TOKEN
            );

        console.log(
            "Registering Aperture Tickets slash commands..."
        );

        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body:
                    slashCommands
            }
        );

        console.log(
            "Slash commands registered."
        );

    } catch (error) {

        console.error(
            "Slash command registration failed:",
            error
        );

    }
}

/* =========================================================
   EXPRESS
========================================================= */

app.set(
    "trust proxy",
    1
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.json()
);

app.use(
    session({
        name:
            "aperture.sid",

        secret:
            SESSION_SECRET,

        resave:
            false,

        saveUninitialized:
            false,

        proxy:
            true,

        cookie: {
            secure:
                true,

            httpOnly:
                true,

            sameSite:
                "lax",

            maxAge:
                1000 *
                60 *
                60 *
                24
        }
    })
);

/* =========================================================
   OAUTH HELPERS
========================================================= */

function createOAuthURL(
    state
) {

    const params =
        new URLSearchParams({

            client_id:
                CLIENT_ID,

            response_type:
                "code",

            redirect_uri:
                REDIRECT_URI,

            scope:
                "identify guilds",

            state

        });

    return (
        "https://discord.com/oauth2/authorize?" +
        params.toString()
    );
}

async function discordFetch(
    url,
    options = {}
) {

    const response =
        await fetch(
            url,
            options
        );

    let data = null;

    try {
        data =
            await response.json();
    } catch {}

    return {
        response,
        data
    };
}

/* =========================================================
   LOGIN
========================================================= */

app.get(
    "/login",
    (req, res) => {

        const state =
            crypto
                .randomBytes(32)
                .toString("hex");

        req.session.oauthState =
            state;

        req.session.save(
            error => {

                if (error) {

                    console.error(
                        "OAuth session error:",
                        error
                    );

                    return res
                        .status(500)
                        .send(
                            "Could not start Discord login."
                        );
                }

                res.redirect(
                    createOAuthURL(
                        state
                    )
                );
            }
        );
    }
);

/* =========================================================
   OAUTH CALLBACK
========================================================= */

app.get(
    "/auth/callback",
    async (
        req,
        res
    ) => {

        try {

            const {
                code,
                state
            } = req.query;

            if (
                !code ||
                !state
            ) {

                return res
                    .status(400)
                    .send(
                        "Missing OAuth information."
                    );
            }

            if (
                !req.session.oauthState ||
                req.session.oauthState !== state
            ) {

                return res
                    .status(400)
                    .send(`
                        <h1>Invalid login session</h1>
                        <p>The Discord OAuth session did not match.</p>
                        <a href="/login">
                            Login Again
                        </a>
                    `);
            }

            delete req.session.oauthState;

            const tokenResult =
                await discordFetch(
                    "https://discord.com/api/oauth2/token",
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body:
                            new URLSearchParams({

                                client_id:
                                    CLIENT_ID,

                                client_secret:
                                    CLIENT_SECRET,

                                grant_type:
                                    "authorization_code",

                                code:
                                    String(code),

                                redirect_uri:
                                    REDIRECT_URI

                            })
                    }
                );

            if (
                !tokenResult.response.ok ||
                !tokenResult.data?.access_token
            ) {

                console.error(
                    "OAuth token error:",
                    tokenResult.data
                );

                return res
                    .status(500)
                    .send(
                        "Discord rejected the login request."
                    );
            }

            const authorization =
                {
                    Authorization:
                        `Bearer ${tokenResult.data.access_token}`
                };

            const userResult =
                await discordFetch(
                    "https://discord.com/api/users/@me",
                    {
                        headers:
                            authorization
                    }
                );

            const guildResult =
                await discordFetch(
                    "https://discord.com/api/users/@me/guilds",
                    {
                        headers:
                            authorization
                    }
                );

            if (
                !userResult.response.ok
            ) {

                return res
                    .status(500)
                    .send(
                        "Could not retrieve your Discord account."
                    );
            }

            req.session.user =
                userResult.data;

            req.session.guilds =
                Array.isArray(
                    guildResult.data
                )
                    ? guildResult.data
                    : [];

            req.session.save(
                error => {

                    if (error) {

                        console.error(
                            "Session save error:",
                            error
                        );

                        return res
                            .status(500)
                            .send(
                                "Could not save login session."
                            );
                    }

                    res.redirect(
                        "/dashboard"
                    );
                }
            );

        } catch (error) {

            console.error(
                "OAuth callback error:",
                error
            );

            res
                .status(500)
                .send(
                    "Discord login failed."
                );
        }
    }
);

/* =========================================================
   LOGOUT
========================================================= */

app.get(
    "/logout",
    (
        req,
        res
    ) => {

        req.session.destroy(
            () => {
                res.redirect(
                    "/"
                );
            }
        );
    }
);

/* =========================================================
   HTML
========================================================= */

function page(
    title,
    body
) {

    return `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>
    ${escapeHtml(title)}
</title>

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #070707;
    color: #ffffff;
    font-family:
        Inter,
        Arial,
        Helvetica,
        sans-serif;
}

a {
    color: inherit;
}

.top {
    min-height: 72px;
    border-bottom:
        1px solid #202020;
    background: #0a0a0a;

    display: flex;
    align-items: center;
    justify-content:
        space-between;

    padding:
        15px 5%;

    gap: 20px;
}

.brand {
    font-size: 20px;
    font-weight: 800;
}

.nav {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
}

.container {
    width:
        min(1200px, 94%);

    margin:
        35px auto 70px;
}

.hero {
    min-height:
        calc(100vh - 72px);

    display: flex;
    align-items: center;
    justify-content: center;

    text-align: center;

    padding:
        50px 20px;
}

.hero-inner {
    max-width: 850px;
}

.hero h1 {
    font-size:
        clamp(44px, 8vw, 82px);

    line-height:
        .95;

    letter-spacing:
        -4px;

    margin:
        0 0 25px;
}

.hero p {
    color: #a5a5a5;
    line-height: 1.65;
    font-size: 18px;
}

.badge {
    display:
        inline-block;

    padding:
        8px 14px;

    border:
        1px solid #30346d;

    background:
        #10122a;

    color:
        #aab0ff;

    border-radius:
        999px;

    font-size:
        12px;

    font-weight:
        700;

    margin-bottom:
        20px;
}

.btn {
    display:
        inline-flex;

    align-items:
        center;

    justify-content:
        center;

    text-decoration:
        none;

    background:
        #5865f2;

    color:
        #ffffff;

    border:
        0;

    border-radius:
        10px;

    padding:
        12px 17px;

    font-weight:
        700;

    cursor:
        pointer;

    font-size:
        14px;
}

.btn:hover {
    background:
        #4752c4;
}

.btn.secondary {
    background:
        #181818;

    border:
        1px solid #303030;
}

.card {
    background:
        #101010;

    border:
        1px solid #252525;

    border-radius:
        16px;

    padding:
        22px;
}

.card h2 {
    margin-top: 0;
}

.grid {
    display:
        grid;

    grid-template-columns:
        repeat(
            auto-fit,
            minmax(320px, 1fr)
        );

    gap:
        18px;
}

label {
    display:
        block;

    color:
        #aaa;

    font-size:
        13px;

    margin:
        15px 0 7px;
}

input,
select,
textarea {
    width:
        100%;

    background:
        #0b0b0b;

    border:
        1px solid #303030;

    border-radius:
        9px;

    color:
        #ffffff;

    padding:
        12px;

    outline:
        none;

    font:
        inherit;
}

input:focus,
select:focus,
textarea:focus {
    border-color:
        #5865f2;
}

textarea {
    min-height:
        125px;

    resize:
        vertical;
}

.notice {
    padding:
        13px 15px;

    border-radius:
        10px;

    margin:
        16px 0;
}

.success {
    background:
        #102417;

    border:
        1px solid #245d36;

    color:
        #9be5ae;
}

.error {
    background:
        #2a1414;

    border:
        1px solid #673030;

    color:
        #ffaaaa;
}

.warning {
    background:
        #28220f;

    border:
        1px solid #5c4d1e;

    color:
        #ead68d;
}

.muted {
    color:
        #999;
}

.small {
    color:
        #707070;

    font-size:
        12px;

    line-height:
        1.55;
}

.stats {
    display:
        grid;

    grid-template-columns:
        repeat(
            auto-fit,
            minmax(170px, 1fr)
        );

    gap:
        12px;

    margin:
        20px 0;
}

.stat {
    background:
        #0d0d0d;

    border:
        1px solid #252525;

    border-radius:
        12px;

    padding:
        16px;
}

.stat strong {
    display:
        block;

    font-size:
        25px;

    margin-top:
        5px;
}

.actions {
    margin-top:
        20px;
}

@media (
    max-width: 650px
) {

    .top {
        align-items:
            flex-start;

        flex-direction:
            column;
    }

    .hero {
        padding:
            50px 10px;
    }

    .hero h1 {
        letter-spacing:
            -2px;
    }

}

</style>

</head>

<body>

${body}

</body>

</html>
`;
}

/* =========================================================
   HOME
========================================================= */

app.get(
    "/",
    (
        req,
        res
    ) => {

        const loggedIn =
            Boolean(
                req.session.user
            );

        res.send(
            page(
                BOT_NAME,
                `

<header class="top">

    <div class="brand">
        ${escapeHtml(BOT_NAME)}
    </div>

    <div class="nav">

        ${
            loggedIn
                ? `
                    <a
                        class="btn secondary"
                        href="/dashboard"
                    >
                        Dashboard
                    </a>

                    <a
                        class="btn secondary"
                        href="/logout"
                    >
                        Logout
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

    </div>

</header>

<main class="hero">

    <div class="hero-inner">

        <div class="badge">
            Discord Ticket Management
        </div>

        <h1>
            ${escapeHtml(BOT_NAME)}
        </h1>

        <p>
            A complete ticket management system
            for Discord servers with a modern
            multi-server dashboard.
        </p>

        <br>

        <a
            class="btn"
            href="${
                loggedIn
                    ? "/dashboard"
                    : "/login"
            }"
        >
            ${
                loggedIn
                    ? "Open Dashboard"
                    : "Login with Discord"
            }
        </a>

    </div>

</main>

`
            )
        );
    }
);

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireLogin(
    req,
    res,
    next
) {

    if (
        !req.session.user
    ) {
        return res.redirect(
            "/login"
        );
    }

    next();
}

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
    "/dashboard",
    requireLogin,
    (
        req,
        res
    ) => {

        const userGuilds =
            Array.isArray(
                req.session.guilds
            )
                ? req.session.guilds
                : [];

        const manageableGuilds =
            userGuilds.filter(
                guild => {

                    try {

                        const permissions =
                            BigInt(
                                guild.permissions ||
                                "0"
                            );

                        return (
                            (
                                permissions &
                                PermissionsBitField.Flags.Administrator
                            ) !== 0n
                        ) ||
                        (
                            permissions &
                            PermissionsBitField.Flags.ManageGuild
                        ) !== 0n;

                    } catch {

                        return false;

                    }

                }
            );

        if (
            manageableGuilds.length === 0
        ) {

            return res.send(
                page(
                    "No Servers",
                    `

<header class="top">

    <div class="brand">
        ${escapeHtml(BOT_NAME)}
    </div>

    <a
        class="btn secondary"
        href="/logout"
    >
        Logout
    </a>

</header>

<main class="container">

    <div class="card">

        <h1>
            No Manageable Servers
        </h1>

        <p class="muted">
            You need Administrator or Manage Server
            permission in a Discord server.
        </p>

        <a
            class="btn"
            href="/logout"
        >
            Logout
        </a>

    </div>

</main>

`
                )
            );

        }

        const selectedId =
            String(
                req.query.guild ||
                manageableGuilds[0].id
            );

        const selectedGuild =
            manageableGuilds.find(
                guild =>
                    guild.id ===
                    selectedId
            ) ||
            manageableGuilds[0];

        const config =
            getConfig(
                selectedGuild.id
            );

        const botGuild =
            client.guilds.cache.get(
                selectedGuild.id
            );

        let channels = [];
        let categories = [];
        let roles = [];

        if (botGuild) {

            channels =
                [
                    ...botGuild
                        .channels
                        .cache
                        .values()
                ]
                    .filter(
                        channel =>
                            channel.type ===
                                ChannelType.GuildText ||
                            channel.type ===
                                ChannelType.GuildAnnouncement
                    )
                    .sort(
                        (a, b) =>
                            a.position -
                            b.position
                    );

            categories =
                [
                    ...botGuild
                        .channels
                        .cache
                        .values()
                ]
                    .filter(
                        channel =>
                            channel.type ===
                            ChannelType.GuildCategory
                    )
                    .sort(
                        (a, b) =>
                            a.position -
                            b.position
                    );

            roles =
                [
                    ...botGuild
                        .roles
                        .cache
                        .values()
                ]
                    .filter(
                        role =>
                            role.id !==
                            botGuild.id
                    )
                    .sort(
                        (a, b) =>
                            b.position -
                            a.position
                    );

        }

        const guildOptions =
            manageableGuilds
                .map(
                    guild =>
                        `
<option
    value="${escapeHtml(
        guild.id
    )}"
    ${
        guild.id ===
        selectedGuild.id
            ? "selected"
            : ""
    }
>
    ${escapeHtml(
        guild.name
    )}
</option>
`
                )
                .join("");

        const channelOptions =
            channels
                .map(
                    channel =>
                        `
<option
    value="${escapeHtml(
        channel.id
    )}"
    ${
        channel.id ===
        config.dashboard.panelChannelId
            ? "selected"
            : ""
    }
>
    #${escapeHtml(
        channel.name
    )}
</option>
`
                )
                .join("");

        const categoryOptions =
            categories
                .map(
                    category =>
                        `
<option
    value="${escapeHtml(
        category.id
    )}"
    ${
        category.id ===
        config.ticket.categoryId
            ? "selected"
            : ""
    }
>
    ${escapeHtml(
        category.name
    )}
</option>
`
                )
                .join("");

        const supportRoleOptions =
            roles
                .map(
                    role =>
                        `
<option
    value="${escapeHtml(
        role.id
    )}"
    ${
        role.id ===
        config.ticket.supportRoleId
            ? "selected"
            : ""
    }
>
    ${escapeHtml(
        role.name
    )}
</option>
`
                )
                .join("");

        const closeRoleOptions =
            roles
                .map(
                    role =>
                        `
<option
    value="${escapeHtml(
        role.id
    )}"
    ${
        role.id ===
        config.ticket.closeRoleId
            ? "selected"
            : ""
    }
>
    ${escapeHtml(
        role.name
    )}
</option>
`
                )
                .join("");

        const transcriptOptions =
            channels
                .map(
                    channel =>
                        `
<option
    value="${escapeHtml(
        channel.id
    )}"
    ${
        channel.id ===
        config.ticket.transcriptChannelId
            ? "selected"
            : ""
    }
>
    #${escapeHtml(
        channel.name
    )}
</option>
`
                )
                .join("");

        const logOptions =
            channels
                .map(
                    channel =>
                        `
<option
    value="${escapeHtml(
        channel.id
    )}"
    ${
        channel.id ===
        config.logging.channelId
            ? "selected"
            : ""
    }
>
    #${escapeHtml(
        channel.name
    )}
</option>
`
                )
                .join("");

        const openTickets =
            botGuild
                ? [
                    ...botGuild
                        .channels
                        .cache
                        .values()
                ].filter(
                    channel =>
                        isTicketChannel(
                            channel,
                            config
                        )
                ).length
                : 0;

        res.send(
            page(
                `${BOT_NAME} Dashboard`,
                `

<header class="top">

    <div class="brand">
        ${escapeHtml(BOT_NAME)}
    </div>

    <div class="nav">

        <span class="muted">
            ${escapeHtml(
                req.session.user.username
            )}
        </span>

        <a
            class="btn secondary"
            href="/logout"
        >
            Logout
        </a>

    </div>

</header>

<main class="container">

    <h1>
        Dashboard
    </h1>

    <p class="muted">
        Configure ${escapeHtml(
            BOT_NAME
        )} for each Discord server.
    </p>

    <div class="card">

        <label>
            Server
        </label>

        <select
            onchange="
                window.location =
                '/dashboard?guild=' +
                encodeURIComponent(this.value)
            "
        >

            ${guildOptions}

        </select>

    </div>

    ${
        !botGuild
            ? `
<div class="notice warning">

    ${escapeHtml(
        BOT_NAME
    )}
    is not currently in this server.

    <br><br>

    <a
        class="btn"
        href="https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
            CLIENT_ID
        )}&permissions=268438528&scope=bot%20applications.commands&guild_id=${encodeURIComponent(
            selectedGuild.id
        )}"
    >
        Add Bot
    </a>

</div>
`
            : ""
    }

    <div class="stats">

        <div class="stat">

            <span class="muted">
                Bot Status
            </span>

            <strong>
                ${
                    botGuild
                        ? "Connected"
                        : "Not Installed"
                }
            </strong>

        </div>

        <div class="stat">

            <span class="muted">
                Open Tickets
            </span>

            <strong>
                ${openTickets}
            </strong>

        </div>

        <div class="stat">

            <span class="muted">
                Support Role
            </span>

            <strong>
                ${
                    config.ticket.supportRoleId
                        ? "Configured"
                        : "None"
                }
            </strong>

        </div>

        <div class="stat">

            <span class="muted">
                Logging
            </span>

            <strong>
                ${
                    config.logging.enabled
                        ? "Enabled"
                        : "Disabled"
                }
            </strong>

        </div>

    </div>

    <form
        method="POST"
        action="/dashboard/save"
    >

        <input
            type="hidden"
            name="guildId"
            value="${escapeHtml(
                selectedGuild.id
            )}"
        >

        <div class="grid">

            <section class="card">

                <h2>
                    Ticket Panel
                </h2>

                <label>
                    Title
                </label>

                <input
                    name="title"
                    value="${escapeHtml(
                        config.panel.title
                    )}"
                    maxlength="256"
                >

                <label>
                    Description
                </label>

                <textarea
                    name="description"
                    maxlength="4000"
                >${escapeHtml(
                    config.panel.description
                )}</textarea>

                <label>
                    Color
                </label>

                <input
                    name="color"
                    value="${escapeHtml(
                        config.panel.color
                    )}"
                    placeholder="#5865F2"
                >

                <label>
                    Footer
                </label>

                <input
                    name="footer"
                    value="${escapeHtml(
                        config.panel.footer
                    )}"
                    maxlength="2048"
                >

                <label>
                    Button Label
                </label>

                <input
                    name="buttonLabel"
                    value="${escapeHtml(
                        config.panel.buttonLabel
                    )}"
                    maxlength="80"
                >

                <label>
                    Button Style
                </label>

                <select
                    name="buttonStyle"
                >

                    <option
                        value="primary"
                        ${
                            config.panel.buttonStyle ===
                            "primary"
                                ? "selected"
                                : ""
                        }
                    >
                        Blue
                    </option>

                    <option
                        value="success"
                        ${
                            config.panel.buttonStyle ===
                            "success"
                                ? "selected"
                                : ""
                        }
                    >
                        Green
                    </option>

                    <option
                        value="secondary"
                        ${
                            config.panel.buttonStyle ===
                            "secondary"
                                ? "selected"
                                : ""
                        }
                    >
                        Gray
                    </option>

                    <option
                        value="danger"
                        ${
                            config.panel.buttonStyle ===
                            "danger"
                                ? "selected"
                                : ""
                        }
                    >
                        Red
                    </option>

                </select>

                <label>
                    Thumbnail URL
                </label>

                <input
                    name="thumbnail"
                    value="${escapeHtml(
                        config.panel.thumbnail
                    )}"
                    placeholder="https://..."
                >

                <label>
                    Image URL
                </label>

                <input
                    name="image"
                    value="${escapeHtml(
                        config.panel.image
                    )}"
                    placeholder="https://..."
                >

            </section>

            <section class="card">

                <h2>
                    Ticket Settings
                </h2>

                <label>
                    Ticket Category
                </label>

                <select
                    name="categoryId"
                >

                    <option value="">
                        No category
                    </option>

                    ${categoryOptions}

                </select>

                <label>
                    Support Role
                </label>

                <select
                    name="supportRoleId"
                >

                    <option value="">
                        No support role
                    </option>

                    ${supportRoleOptions}

                </select>

                <label>
                    Close Permission Role
                </label>

                <select
                    name="closeRoleId"
                >

                    <option value="">
                        Administrator only
                    </option>

                    ${closeRoleOptions}

                </select>

                <label>
                    Ticket Prefix
                </label>

                <input
                    name="prefix"
                    value="${escapeHtml(
                        config.ticket.prefix
                    )}"
                    maxlength="20"
                >

                <label>
                    Maximum Open Tickets
                </label>

                <input
                    type="number"
                    name="maxOpenPerUser"
                    min="1"
                    max="10"
                    value="${Number(
                        config.ticket.maxOpenPerUser
                    ) || 1}"
                >

                <label>
                    Allow Ticket Creator To Close
                </label>

                <select
                    name="allowUserClose"
                >

                    <option
                        value="true"
                        ${
                            config.ticket.allowUserClose
                                ? "selected"
                                : ""
                        }
                    >
                        Yes
                    </option>

                    <option
                        value="false"
                        ${
                            !config.ticket.allowUserClose
                                ? "selected"
                                : ""
                        }
                    >
                        No
                    </option>

                </select>

                <label>
                    Welcome Message
                </label>

                <textarea
                    name="welcomeMessage"
                    maxlength="4000"
                >${escapeHtml(
                    config.ticket.welcomeMessage
                )}</textarea>

            </section>

            <section class="card">

                <h2>
                    Panel Channel
                </h2>

                <label>
                    Send Panel To
                </label>

                <select
                    name="panelChannelId"
                >

                    <option value="">
                        Select a channel
                    </option>

                    ${channelOptions}

                </select>

                <p class="small">
                    Ticket panels are sent from
                    the dashboard only.
                    There is no /ticket panel command.
                </p>

                <label>
                    Transcript Channel
                </label>

                <select
                    name="transcriptChannelId"
                >

                    <option value="">
                        Disabled
                    </option>

                    ${transcriptOptions}

                </select>

            </section>

            <section class="card">

                <h2>
                    Logging
                </h2>

                <label>
                    Logging
                </label>

                <select
                    name="loggingEnabled"
                >

                    <option
                        value="false"
                        ${
                            !config.logging.enabled
                                ? "selected"
                                : ""
                        }
                    >
                        Disabled
                    </option>

                    <option
                        value="true"
                        ${
                            config.logging.enabled
                                ? "selected"
                                : ""
                        }
                    >
                        Enabled
                    </option>

                </select>

                <label>
                    Log Channel
                </label>

                <select
                    name="loggingChannelId"
                >

                    <option value="">
                        Select a channel
                    </option>

                    ${logOptions}

                </select>

                <p class="small">
                    Logs ticket creation,
                    claiming, closing,
                    renaming and user changes.
                </p>

            </section>

        </div>

        <div class="actions">

            <button
                class="btn"
                type="submit"
            >
                Save & Send Panel
            </button>

        </div>

    </form>

</main>

`
            )
        );
    }
);

/* =========================================================
   SAVE DASHBOARD
========================================================= */

app.post(
    "/dashboard/save",
    requireLogin,
    async (
        req,
        res
    ) => {

        try {

            const guildId =
                text(
                    req.body.guildId
                );

            const userGuild =
                req.session.guilds?.find(
                    guild =>
                        guild.id ===
                        guildId
                );

            if (!userGuild) {

                return res
                    .status(403)
                    .send(
                        "You do not have access to this server."
                    );
            }

            const guild =
                client.guilds.cache.get(
                    guildId
                );

            if (!guild) {

                return res.redirect(
                    `/dashboard?guild=${guildId}&error=Bot%20is%20not%20in%20this%20server`
                );
            }

            const config =
                getConfig(
                    guildId
                );

            config.panel.title =
                text(
                    req.body.title,
                    "Contact Support"
                ).slice(
                    0,
                    256
                );

            config.panel.description =
                text(
                    req.body.description,
                    "Need help? Click the button below to create a private support ticket."
                ).slice(
                    0,
                    4000
                );

            config.panel.color =
                normalizeColor(
                    req.body.color
                );

            config.panel.footer =
                text(
                    req.body.footer,
                    BOT_NAME
                ).slice(
                    0,
                    2048
                );

            config.panel.buttonLabel =
                text(
                    req.body.buttonLabel,
                    "Create Ticket"
                ).slice(
                    0,
                    80
                );

            config.panel.buttonStyle =
                [
                    "primary",
                    "secondary",
                    "success",
                    "danger"
                ].includes(
                    req.body.buttonStyle
                )
                    ? req.body.buttonStyle
                    : "primary";

            config.panel.thumbnail =
                safeUrl(
                    req.body.thumbnail
                );

            config.panel.image =
                safeUrl(
                    req.body.image
                );

            config.ticket.categoryId =
                text(
                    req.body.categoryId
                );

            config.ticket.supportRoleId =
                text(
                    req.body.supportRoleId
                );

            config.ticket.closeRoleId =
                text(
                    req.body.closeRoleId
                );

            config.ticket.prefix =
                normalizePrefix(
                    req.body.prefix
                );

            config.ticket.maxOpenPerUser =
                Math.min(
                    10,
                    Math.max(
                        1,
                        Number(
                            req.body.maxOpenPerUser
                        ) || 1
                    )
                );

            config.ticket.allowUserClose =
                req.body.allowUserClose !==
                "false";

            config.ticket.welcomeMessage =
                text(
                    req.body.welcomeMessage,
                    "Welcome to your support ticket. Please explain what you need help with."
                ).slice(
                    0,
                    4000
                );

            config.ticket.transcriptChannelId =
                text(
                    req.body.transcriptChannelId
                );

            config.logging.enabled =
                req.body.loggingEnabled ===
                "true";

            config.logging.channelId =
                text(
                    req.body.loggingChannelId
                );

            config.dashboard.panelChannelId =
                text(
                    req.body.panelChannelId
                );

            saveData();

            if (
                !config.dashboard.panelChannelId
            ) {

                return res.redirect(
                    `/dashboard?guild=${guildId}&saved=1&error=Configuration%20saved%20but%20no%20panel%20channel%20was%20selected`
                );
            }

            const channel =
                guild.channels.cache.get(
                    config.dashboard.panelChannelId
                );

            if (
                !channel ||
                !channel.isTextBased()
            ) {

                return res.redirect(
                    `/dashboard?guild=${guildId}&error=The%20selected%20channel%20could%20not%20be%20found`
                );
            }

            const botMember =
                guild.members.me;

            if (!botMember) {

                return res.redirect(
                    `/dashboard?guild=${guildId}&error=Bot%20member%20could%20not%20be%20found`
                );
            }

            const permissions =
                channel.permissionsFor(
                    botMember
                );

            if (
                !permissions ||
                !permissions.has(
                    PermissionsBitField.Flags.SendMessages
                ) ||
                !permissions.has(
                    PermissionsBitField.Flags.EmbedLinks
                )
            ) {

                return res.redirect(
                    `/dashboard?guild=${guildId}&saved=1&error=Bot%20needs%20Send%20Messages%20and%20Embed%20Links%20permissions`
                );
            }

            await channel.send({
                embeds: [
                    createPanelEmbed(
                        config
                    )
                ],
                components:
                    createPanelComponents(
                        config
                    )
            });

            res.redirect(
                `/dashboard?guild=${guildId}&saved=1&sent=1`
            );

        } catch (error) {

            console.error(
                "Dashboard save error:",
                error
            );

            res
                .status(500)
                .send(
                    "Could not save the configuration."
                );
        }
    }
);

/* =========================================================
   CREATE TICKET
========================================================= */

async function createTicket(
    interaction
) {

    const guild =
        interaction.guild;

    const config =
        getConfig(
            guild.id
        );

    const prefix =
        normalizePrefix(
            config.ticket.prefix
        );

    const existingTickets =
        guild.channels.cache.filter(
            channel =>
                channel.type ===
                    ChannelType.GuildText &&
                getTicketOwner(
                    channel,
                    config
                ) ===
                    interaction.user.id
        );

    if (
        existingTickets.size >=
        Number(
            config.ticket.maxOpenPerUser
        )
    ) {

        return interaction.reply({
            content:
                `You already have ${existingTickets.size} open ticket${
                    existingTickets.size === 1
                        ? ""
                        : "s"
                }.`,
            ephemeral: true
        });
    }

    const name =
        `${prefix}-${interaction.user.id}`;

    const existing =
        guild.channels.cache.find(
            channel =>
                channel.type ===
                    ChannelType.GuildText &&
                channel.name === name
        );

    if (existing) {

        return interaction.reply({
            content:
                `You already have a ticket: ${existing}`,
            ephemeral: true
        });
    }

    const overwrites = [

        {
            id:
                guild.roles.everyone.id,

            deny: [
                PermissionsBitField.Flags.ViewChannel
            ]
        },

        {
            id:
                interaction.user.id,

            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks
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
                id:
                    role.id,

                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.AttachFiles,
                    PermissionsBitField.Flags.EmbedLinks
                ]
            });

        }

    }

    const channel =
        await guild.channels.create({

            name,

            type:
                ChannelType.GuildText,

            parent:
                config.ticket.categoryId ||
                undefined,

            permissionOverwrites:
                overwrites,

            topic:
                `Aperture ticket owned by ${interaction.user.id}`

        });

    await channel.send({

        content:
            config.ticket.supportRoleId
                ? `<@&${config.ticket.supportRoleId}> <@${interaction.user.id}>`
                : `<@${interaction.user.id}>`,

        embeds: [
            createTicketEmbed(
                config,
                interaction.user.id
            )
        ],

        components:
            createTicketControls()

    });

    await sendLog(
        guild,
        config,
        new EmbedBuilder()
            .setTitle(
                "Ticket Created"
            )
            .setColor(
                "#35b56a"
            )
            .addFields(

                {
                    name:
                        "User",

                    value:
                        `<@${interaction.user.id}>`,

                    inline:
                        true
                },

                {
                    name:
                        "Channel",

                    value:
                        `${channel}`,

                    inline:
                        true
                }

            )
            .setTimestamp()
    );

    return interaction.reply({

        content:
            `Your ticket has been created: ${channel}`,

        ephemeral:
            true

    });
}

/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(
    interaction
) {

    const guild =
        interaction.guild;

    const config =
        getConfig(
            guild.id
        );

    const channel =
        interaction.channel;

    if (
        !channel ||
        !isTicketChannel(
            channel,
            config
        )
    ) {

        return interaction.reply({
            content:
                "This is not an Aperture ticket.",
            ephemeral:
                true
        });
    }

    const ownerId =
        getTicketOwner(
            channel,
            config
        );

    const administrator =
        interaction.member.permissions.has(
            PermissionsBitField.Flags.Administrator
        );

    const closeRole =
        config.ticket.closeRoleId &&
        interaction.member.roles.cache.has(
            config.ticket.closeRoleId
        );

    const manager =
        administrator ||
        closeRole;

    const owner =
        ownerId ===
        interaction.user.id;

    if (
        !manager &&
        !(
            config.ticket.allowUserClose &&
            owner
        )
    ) {

        return interaction.reply({
            content:
                "You do not have permission to close this ticket.",
            ephemeral:
                true
        });
    }

    await interaction.reply(
        "Closing this ticket..."
    );

    await sendLog(
        guild,
        config,
        new EmbedBuilder()
            .setTitle(
                "Ticket Closed"
            )
            .setColor(
                "#d94a4a"
            )
            .addFields(

                {
                    name:
                        "Channel",

                    value:
                        `#${channel.name}`,

                    inline:
                        true
                },

                {
                    name:
                        "Closed By",

                    value:
                        `<@${interaction.user.id}>`,

                    inline:
                        true
                },

                {
                    name:
                        "Owner",

                    value:
                        ownerId
                            ? `<@${ownerId}>`
                            : "Unknown",

                    inline:
                        true
                }

            )
            .setTimestamp()
    );

    setTimeout(
        () => {

            channel
                .delete(
                    "Aperture ticket closed"
                )
                .catch(
                    () => {}
                );

        },
        1200
    );
}

/* =========================================================
   CLAIM TICKET
========================================================= */

async function claimTicket(
    interaction
) {

    const guild =
        interaction.guild;

    const config =
        getConfig(
            guild.id
        );

    const channel =
        interaction.channel;

    if (
        !channel ||
        !isTicketChannel(
            channel,
            config
        )
    ) {

        return interaction.reply({
            content:
                "This is not a ticket channel.",
            ephemeral:
                true
        });
    }

    const administrator =
        interaction.member.permissions.has(
            PermissionsBitField.Flags.Administrator
        );

    const supportRole =
        config.ticket.supportRoleId &&
        interaction.member.roles.cache.has(
            config.ticket.supportRoleId
        );

    if (
        !administrator &&
        !supportRole
    ) {

        return interaction.reply({
            content:
                "You do not have permission to claim tickets.",
            ephemeral:
                true
        });
    }

    const messages =
        await channel.messages.fetch({
            limit:
                50
        }).catch(
            () => null
        );

    if (messages) {

        const botMessage =
            messages.find(
                message =>
                    message.author.id ===
                        client.user.id &&
                    message.components.length
            );

        if (botMessage) {

            const ownerId =
                getTicketOwner(
                    channel,
                    config
                );

            await botMessage.edit({

                embeds: [
                    createTicketEmbed(
                        config,
                        ownerId ||
                            interaction.user.id,
                        interaction.user.id
                    )
                ],

                components:
                    createTicketControls()

            }).catch(
                () => {}
            );
        }

    }

    await sendLog(
        guild,
        config,
        new EmbedBuilder()
            .setTitle(
                "Ticket Claimed"
            )
            .setColor(
                "#5865F2"
            )
            .addFields(

                {
                    name:
                        "Channel",

                    value:
                        `#${channel.name}`,

                    inline:
                        true
                },

                {
                    name:
                        "Claimed By",

                    value:
                        `<@${interaction.user.id}>`,

                    inline:
                        true
                }

            )
            .setTimestamp()
    );

    return interaction.reply(
        `Ticket claimed by <@${interaction.user.id}>.`
    );
}

/* =========================================================
   ADD USER
========================================================= */

async function addUser(
    interaction,
    user
) {

    const guild =
        interaction.guild;

    const config =
        getConfig(
            guild.id
        );

    const channel =
        interaction.channel;

    if (
        !channel ||
        !isTicketChannel(
            channel,
            config
        )
    ) {

        return interaction.reply({
            content:
                "This is not a ticket channel.",
            ephemeral:
                true
        });
    }

    if (
        !isManager(
            interaction.member
        )
    ) {

        return interaction.reply({
            content:
                "You do not have permission to add users.",
            ephemeral:
                true
        });
    }

    await channel.permissionOverwrites.edit(
        user.id,
        {
            ViewChannel:
                true,

            SendMessages:
                true,

            ReadMessageHistory:
                true,

            AttachFiles:
                true,

            EmbedLinks:
                true
        }
    );

    await sendLog(
        guild,
        config,
        new EmbedBuilder()
            .setTitle(
                "User Added"
            )
            .setColor(
                "#35b56a"
            )
            .addFields(

                {
                    name:
                        "User",

                    value:
                        `<@${user.id}>`,

                    inline:
                        true
                },

                {
                    name:
                        "Added By",

                    value:
                        `<@${interaction.user.id}>`,

                    inline:
                        true
                }

            )
            .setTimestamp()
    );

    return interaction.reply(
        `<@${user.id}> was added to this ticket.`
    );
}

/* =========================================================
   REMOVE USER
========================================================= */

async function removeUser(
    interaction,
    user
) {

    const guild =
        interaction.guild;

    const config =
        getConfig(
            guild.id
        );

    const channel =
        interaction.channel;

    if (
        !channel ||
        !isTicketChannel(
            channel,
            config
        )
    ) {

        return interaction.reply({
            content:
                "This is not a ticket channel.",
            ephemeral:
                true
        });
    }

    if (
        !isManager(
            interaction.member
        )
    ) {

        return interaction.reply({
            content:
                "You do not have permission to remove users.",
            ephemeral:
                true
        });
    }

    const ownerId =
        getTicketOwner(
            channel,
            config
        );

    if (
        user.id ===
        ownerId
    ) {

        return interaction.reply({
            content:
                "The ticket owner cannot be removed.",
            ephemeral:
                true
        });
    }

    await channel.permissionOverwrites
        .delete(
            user.id
        )
        .catch(
            () => {}
        );

    await sendLog(
        guild,
        config,
        new EmbedBuilder()
            .setTitle(
                "User Removed"
            )
            .setColor(
                "#d99a35"
            )
            .addFields(

                {
                    name:
                        "User",

                    value:
                        `<@${user.id}>`,

                    inline:
                        true
                },

                {
                    name:
                        "Removed By",

                    value:
                        `<@${interaction.user.id}>`,

                    inline:
                        true
                }

            )
            .setTimestamp()
    );

    return interaction.reply(
        `<@${user.id}> was removed from this ticket.`
    );
}

/* =========================================================
   RENAME
========================================================= */

async function renameTicket(
    interaction,
    requestedName
) {

    const guild =
        interaction.guild;

    const config =
        getConfig(
            guild.id
        );

    const channel =
        interaction.channel;

    if (
        !channel ||
        !isTicketChannel(
            channel,
            config
        )
    ) {

        return interaction.reply({
            content:
                "This is not a ticket channel.",
            ephemeral:
                true
        });
    }

    if (
        !isManager(
            interaction.member
        )
    ) {

        return interaction.reply({
            content:
                "You do not have permission to rename tickets.",
            ephemeral:
                true
        });
    }

    const newName =
        String(
            requestedName
        )
            .toLowerCase()
            .replace(
                /[^a-z0-9-_]/g,
                "-"
            )
            .replace(
                /-+/g,
                "-"
            )
            .replace(
                /^-|-$/g,
                ""
            )
            .slice(
                0,
                90
            );

    if (!newName) {

        return interaction.reply({
            content:
                "That ticket name is invalid.",
            ephemeral:
                true
        });
    }

    await channel.setName(
        newName
    );

    await sendLog(
        guild,
        config,
        new EmbedBuilder()
            .setTitle(
                "Ticket Renamed"
            )
            .setColor(
                "#5865F2"
            )
            .addFields(

                {
                    name:
                        "New Name",

                    value:
                        `#${newName}`,

                    inline:
                        true
                },

                {
                    name:
                        "Renamed By",

                    value:
                        `<@${interaction.user.id}>`,

                    inline:
                        true
                }

            )
            .setTimestamp()
    );

    return interaction.reply(
        `Ticket renamed to **#${newName}**.`
    );
}

/* =========================================================
   DISCORD INTERACTIONS
========================================================= */

client.on(
    "interactionCreate",
    async interaction => {

        try {

            /* BUTTONS */

            if (
                interaction.isButton()
            ) {

                if (
                    interaction.customId ===
                    "aperture:create_ticket"
                ) {

                    return createTicket(
                        interaction
                    );
                }

                if (
                    interaction.customId ===
                    "aperture:close"
                ) {

                    return closeTicket(
                        interaction
                    );
                }

                if (
                    interaction.customId ===
                    "aperture:claim"
                ) {

                    return claimTicket(
                        interaction
                    );
                }

                if (
                    interaction.customId ===
                    "aperture:add"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "aperture:add_modal"
                            )
                            .setTitle(
                                "Add User"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "userId"
                            )
                            .setLabel(
                                "Discord User ID"
                            )
                            .setPlaceholder(
                                "123456789012345678"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                if (
                    interaction.customId ===
                    "aperture:remove"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "aperture:remove_modal"
                            )
                            .setTitle(
                                "Remove User"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "userId"
                            )
                            .setLabel(
                                "Discord User ID"
                            )
                            .setPlaceholder(
                                "123456789012345678"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                if (
                    interaction.customId ===
                    "aperture:rename"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "aperture:rename_modal"
                            )
                            .setTitle(
                                "Rename Ticket"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "name"
                            )
                            .setLabel(
                                "New Ticket Name"
                            )
                            .setPlaceholder(
                                "billing-help"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setMaxLength(
                                90
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }
            }

            /* MODALS */

            if (
                interaction.isModalSubmit()
            ) {

                if (
                    interaction.customId ===
                    "aperture:add_modal"
                ) {

                    const id =
                        interaction.fields
                            .getTextInputValue(
                                "userId"
                            )
                            .trim();

                    if (
                        !/^\d{15,25}$/.test(
                            id
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "Invalid Discord user ID.",
                            ephemeral:
                                true
                        });
                    }

                    const user =
                        await client.users
                            .fetch(id)
                            .catch(
                                () => null
                            );

                    if (!user) {

                        return interaction.reply({
                            content:
                                "That Discord user could not be found.",
                            ephemeral:
                                true
                        });
                    }

                    return addUser(
                        interaction,
                        user
                    );
                }

                if (
                    interaction.customId ===
                    "aperture:remove_modal"
                ) {

                    const id =
                        interaction.fields
                            .getTextInputValue(
                                "userId"
                            )
                            .trim();

                    if (
                        !/^\d{15,25}$/.test(
                            id
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "Invalid Discord user ID.",
                            ephemeral:
                                true
                        });
                    }

                    const user =
                        await client.users
                            .fetch(id)
                            .catch(
                                () => null
                            );

                    if (!user) {

                        return interaction.reply({
                            content:
                                "That Discord user could not be found.",
                            ephemeral:
                                true
                        });
                    }

                    return removeUser(
                        interaction,
                        user
                    );
                }

                if (
                    interaction.customId ===
                    "aperture:rename_modal"
                ) {

                    const name =
                        interaction.fields
                            .getTextInputValue(
                                "name"
                            );

                    return renameTicket(
                        interaction,
                        name
                    );
                }
            }

            /* SLASH COMMANDS */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    "ticket"
            ) {

                const subcommand =
                    interaction.options
                        .getSubcommand();

                const config =
                    getConfig(
                        interaction.guildId
                    );

                if (
                    subcommand ===
                    "status"
                ) {

                    return interaction.reply({

                        ephemeral:
                            true,

                        embeds: [

                            new EmbedBuilder()

                                .setTitle(
                                    `${BOT_NAME} Status`
                                )

                                .setColor(
                                    "#5865F2"
                                )

                                .addFields(

                                    {
                                        name:
                                            "Panel Channel",

                                        value:
                                            config.dashboard.panelChannelId
                                                ? `<#${config.dashboard.panelChannelId}>`
                                                : "Not configured",

                                        inline:
                                            true
                                    },

                                    {
                                        name:
                                            "Category",

                                        value:
                                            config.ticket.categoryId
                                                ? `<#${config.ticket.categoryId}>`
                                                : "Not configured",

                                        inline:
                                            true
                                    },

                                    {
                                        name:
                                            "Support Role",

                                        value:
                                            config.ticket.supportRoleId
                                                ? `<@&${config.ticket.supportRoleId}>`
                                                : "Not configured",

                                        inline:
                                            true
                                    },

                                    {
                                        name:
                                            "Logging",

                                        value:
                                            config.logging.enabled
                                                ? "Enabled"
                                                : "Disabled",

                                        inline:
                                            true
                                    }

                                )

                                .setFooter({
                                    text:
                                        BOT_NAME
                                })

                        ]

                    });
                }

                if (
                    subcommand ===
                    "config"
                ) {

                    return interaction.reply({

                        content:
                            `${BOT_NAME} Dashboard:\n${DASHBOARD_URL}/dashboard?guild=${interaction.guildId}`,

                        ephemeral:
                            true

                    });
                }

                if (
                    subcommand ===
                    "close"
                ) {

                    return closeTicket(
                        interaction
                    );
                }

                if (
                    subcommand ===
                    "claim"
                ) {

                    return claimTicket(
                        interaction
                    );
                }

                if (
                    subcommand ===
                    "add"
                ) {

                    const user =
                        interaction.options.getUser(
                            "user",
                            true
                        );

                    return addUser(
                        interaction,
                        user
                    );
                }

                if (
                    subcommand ===
                    "remove"
                ) {

                    const user =
                        interaction.options.getUser(
                            "user",
                            true
                        );

                    return removeUser(
                        interaction,
                        user
                    );
                }

                if (
                    subcommand ===
                    "rename"
                ) {

                    const name =
                        interaction.options.getString(
                            "name",
                            true
                        );

                    return renameTicket(
                        interaction,
                        name
                    );
                }
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

                    ephemeral:
                        true

                }).catch(
                    () => {}
                );
            }

        }

    }
);

/* =========================================================
   READY
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
            `Logged in as ${client.user.tag}`
        );
        console.log(
            `Servers: ${client.guilds.cache.size}`
        );
        console.log(
            "======================================"
        );
        console.log("");

        await registerCommands();

    }
);

/* =========================================================
   SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `${BOT_NAME} dashboard running on port ${PORT}`
        );

        console.log(
            `Dashboard: ${DASHBOARD_URL}`
        );

        console.log(
            `OAuth callback: ${REDIRECT_URI}`
        );

    }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on(
    "error",
    error => {

        console.error(
            "Discord client error:",
            error
        );

    }
);

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "Unhandled rejection:",
            error
        );

    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "Uncaught exception:",
            error
        );

    }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(
    DISCORD_TOKEN
).catch(
    error => {

        console.error(
            "Discord login failed:",
            error
        );

        process.exit(1);

    }
);
