import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder
} from 'discord.js';

import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import sharp from 'sharp';

/* =========================================================
   TOKEN
========================================================= */

const TOKEN = String(
    process.env.DISCORD_TOKEN || ''
).trim();

/* =========================================================
   DATA
========================================================= */

const DATA_DIR = '/data';

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

const DB_FILE = path.join(
    DATA_DIR,
    'economy.json'
);

const DB_BACKUP_FILE = path.join(
    DATA_DIR,
    'economy.backup.json'
);

const DB_TEMP_FILE = path.join(
    DATA_DIR,
    'economy.tmp.json'
);

if (!TOKEN) {
    console.error(
        '❌ DISCORD_TOKEN غير موجود في Railway Variables.'
    );

    process.exit(1);
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages
    ]
});

/* =========================================================
   RANK SETTINGS
========================================================= */

const TEXT_XP_PER_MESSAGE = 15;

const TEXT_XP_COOLDOWN = 30 * 1000;

const VOICE_XP_PER_MINUTE = 10;

const VOICE_TICK = 60 * 1000;

/* =========================================================
   MEMORY
========================================================= */

const textCooldowns = new Map();

const pendingTransfers = new Map();

/* =========================================================
   DATABASE
========================================================= */

const db = loadDB();

/* =========================================================
   EMPTY DATABASE
========================================================= */

function emptyDB() {
    return {
        version: 3,
        guilds: {}
    };
}

/* =========================================================
   LOAD DATABASE
========================================================= */

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            if (fs.existsSync(DB_BACKUP_FILE)) {
                fs.copyFileSync(
                    DB_BACKUP_FILE,
                    DB_FILE
                );
            } else {
                fs.writeFileSync(
                    DB_FILE,
                    JSON.stringify(
                        emptyDB(),
                        null,
                        2
                    ),
                    'utf8'
                );
            }
        }

        const data = JSON.parse(
            fs.readFileSync(
                DB_FILE,
                'utf8'
            )
        );

        if (
            !data ||
            typeof data !== 'object' ||
            Array.isArray(data)
        ) {
            throw new Error(
                'Invalid database'
            );
        }

        if (
            !data.guilds ||
            typeof data.guilds !== 'object' ||
            Array.isArray(data.guilds)
        ) {
            data.guilds = {};
        }

        data.version = 3;

        return data;

    } catch (error) {

        console.error(
            '❌ تعذر تحميل قاعدة البيانات:',
            error
        );

        try {

            if (
                fs.existsSync(
                    DB_BACKUP_FILE
                )
            ) {

                const backup =
                    JSON.parse(
                        fs.readFileSync(
                            DB_BACKUP_FILE,
                            'utf8'
                        )
                    );

                if (
                    backup &&
                    typeof backup === 'object'
                ) {

                    if (
                        !backup.guilds ||
                        typeof backup.guilds !== 'object'
                    ) {
                        backup.guilds = {};
                    }

                    backup.version = 3;

                    return backup;
                }
            }

        } catch (backupError) {

            console.error(
                '❌ تعذر تحميل النسخة الاحتياطية:',
                backupError
            );
        }

        return emptyDB();
    }
}

/* =========================================================
   SAVE DATABASE
========================================================= */

function saveDB(data) {

    data.version = 3;

    if (
        !data.guilds ||
        typeof data.guilds !== 'object' ||
        Array.isArray(data.guilds)
    ) {
        data.guilds = {};
    }

    const json =
        JSON.stringify(
            data,
            null,
            2
        );

    try {

        fs.writeFileSync(
            DB_TEMP_FILE,
            json,
            'utf8'
        );

        if (
            fs.existsSync(DB_FILE)
        ) {
            fs.copyFileSync(
                DB_FILE,
                DB_BACKUP_FILE
            );
        }

        fs.renameSync(
            DB_TEMP_FILE,
            DB_FILE
        );

    } catch (error) {

        console.error(
            '❌ فشل حفظ قاعدة البيانات:',
            error
        );

        try {

            if (
                fs.existsSync(
                    DB_TEMP_FILE
                )
            ) {
                fs.unlinkSync(
                    DB_TEMP_FILE
                );
            }

        } catch {}

        try {

            if (
                !fs.existsSync(DB_FILE) &&
                fs.existsSync(DB_BACKUP_FILE)
            ) {
                fs.copyFileSync(
                    DB_BACKUP_FILE,
                    DB_FILE
                );
            }

        } catch {}
    }
}

/* =========================================================
   GUILD DATA
========================================================= */

function ensureGuild(
    db,
    guildId
) {

    if (
        !db.guilds[guildId] ||
        typeof db.guilds[guildId] !== 'object'
    ) {

        db.guilds[guildId] = {
            economyChannelId: null,
            users: {}
        };
    }

    const guildData =
        db.guilds[guildId];

    if (
        !Object.prototype.hasOwnProperty.call(
            guildData,
            'economyChannelId'
        )
    ) {
        guildData.economyChannelId = null;
    }

    if (
        !guildData.users ||
        typeof guildData.users !== 'object' ||
        Array.isArray(guildData.users)
    ) {
        guildData.users = {};
    }

    return guildData;
}

/* =========================================================
   USER DATA
========================================================= */

function ensureUser(
    db,
    guildId,
    userId
) {

    const guildData =
        ensureGuild(
            db,
            guildId
        );

    if (
        !guildData.users[userId] ||
        typeof guildData.users[userId] !== 'object'
    ) {

        guildData.users[userId] = {
            balance: 0,
            textXP: 0,
            voiceXP: 0,
            voiceLastTickAt: null
        };
    }

    const user =
        guildData.users[userId];

    if (
        typeof user.balance !== 'number'
    ) {

        user.balance =
            Number(
                user.balance
            ) || 0;
    }

    if (
        typeof user.textXP !== 'number'
    ) {

        user.textXP =
            Number(
                user.textXP
            ) || 0;
    }

    if (
        typeof user.voiceXP !== 'number'
    ) {

        user.voiceXP =
            Number(
                user.voiceXP
            ) || 0;
    }

    if (
        !Object.prototype.hasOwnProperty.call(
            user,
            'voiceLastTickAt'
        )
    ) {

        user.voiceLastTickAt = null;
    }

    return user;
}

function getUser(
    db,
    guildId,
    userId
) {

    return ensureUser(
        db,
        guildId,
        userId
    );
}

/* =========================================================
   BALANCE
========================================================= */

function userBalance(
    db,
    guildId,
    userId
) {

    const user =
        getUser(
            db,
            guildId,
            userId
        );

    return Number(
        user.balance
    ) || 0;
}

/* =========================================================
   AMOUNT PARSER
========================================================= */

function parseAmount(value) {

    if (!value) {
        return NaN;
    }

    const text =
        String(value)
            .trim()
            .toLowerCase()
            .replace(/,/g, '');

    const match =
        text.match(
            /^(\d+(?:\.\d+)?)([kmbt])?$/
        );

    if (!match) {
        return NaN;
    }

    const number =
        Number(
            match[1]
        );

    const multipliers = {
        k: 1000,
        m: 1000000,
        b: 1000000000,
        t: 1000000000000
    };

    const amount =
        number *
        (
            multipliers[
                match[2] || ''
            ] || 1
        );

    if (
        !Number.isFinite(amount)
    ) {
        return NaN;
    }

    return Math.floor(
        amount
    );
}

/* =========================================================
   FORMAT AMOUNT
========================================================= */

function formatAmount(
    amount
) {

    amount =
        Number(amount) || 0;

    if (
        amount < 1000
    ) {
        return String(
            amount
        );
    }

    const units = [
        {
            value: 1000000000000,
            suffix: 't'
        },
        {
            value: 1000000000,
            suffix: 'b'
        },
        {
            value: 1000000,
            suffix: 'm'
        },
        {
            value: 1000,
            suffix: 'k'
        }
    ];

    for (
        const unit of units
    ) {

        if (
            amount >= unit.value
        ) {

            const result =
                amount /
                unit.value;

            if (
                Number.isInteger(
                    result
                )
            ) {

                return `${result}${unit.suffix}`;
            }

            return `${Number(
                result.toFixed(2)
            )}${unit.suffix}`;
        }
    }

    return String(
        amount
    );
}

/* =========================================================
   ADMIN
========================================================= */

function isAdmin(member) {

    return Boolean(
        member &&
        member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    );
}

/* =========================================================
   TRANSFER
========================================================= */

function transferKey(
    guildId,
    userId
) {

    return `${guildId}:${userId}`;
}

function cleanupPendingForGuild(
    guildId
) {

    for (
        const [
            key,
            value
        ] of pendingTransfers.entries()
    ) {

        if (
            value.guildId === guildId
        ) {

            pendingTransfers.delete(
                key
            );
        }
    }
}

/* =========================================================
   RANK SYSTEM
========================================================= */

function xpNeeded(level) {

    return (
        100 +
        (
            (level - 1) *
            50
        )
    );
}

/* =========================================================
   LEVEL INFO
========================================================= */

function levelInfo(
    totalXP
) {

    let level = 1;

    let remainingXP =
        Math.max(
            0,
            Math.floor(
                Number(
                    totalXP
                ) || 0
            )
        );

    while (
        remainingXP >=
        xpNeeded(level)
    ) {

        remainingXP -=
            xpNeeded(level);

        level++;
    }

    const needed =
        xpNeeded(level);

    const percent =
        Math.min(
            100,
            Math.floor(
                (
                    remainingXP /
                    needed
                ) *
                100
            )
        );

    return {
        level,
        currentXP:
            remainingXP,
        nextXP:
            needed,
        percent
    };
}

/* =========================================================
   VOICE CHECK
========================================================= */

function isCountedVoice(
    channel,
    guild
) {

    return Boolean(
        channel &&
        channel.isVoiceBased() &&
        channel.id !== guild.afkChannelId
    );
}

/* =========================================================
   TEXT XP
========================================================= */

function addTextXP(
    guildId,
    userId
) {

    const key =
        transferKey(
            guildId,
            userId
        );

    const now =
        Date.now();

    const last =
        textCooldowns.get(
            key
        ) || 0;

    if (
        now - last <
        TEXT_XP_COOLDOWN
    ) {

        return false;
    }

    textCooldowns.set(
        key,
        now
    );

    const user =
        getUser(
            db,
            guildId,
            userId
        );

    user.textXP +=
        TEXT_XP_PER_MESSAGE;

    saveDB(db);

    return true;
}

/* =========================================================
   VOICE XP
========================================================= */

function awardVoiceXP(
    guildId,
    userId,
    now = Date.now()
) {

    const user =
        getUser(
            db,
            guildId,
            userId
        );

    if (
        !user.voiceLastTickAt
    ) {

        user.voiceLastTickAt =
            now;

        return false;
    }

    const elapsed =
        Math.max(
            0,
            now -
            Number(
                user.voiceLastTickAt
            )
        );

    const minutes =
        Math.floor(
            elapsed /
            60000
        );

    if (
        minutes <= 0
    ) {

        return false;
    }

    user.voiceXP +=
        minutes *
        VOICE_XP_PER_MINUTE;

    user.voiceLastTickAt +=
        minutes *
        60000;

    return true;
}

/* =========================================================
   UPDATE ALL VOICE XP
========================================================= */

async function updateAllVoiceXP() {

    let changed = false;

    const now =
        Date.now();

    for (
        const guild of
        client.guilds.cache.values()
    ) {

        for (
            const member of
            guild.members.cache.values()
        ) {

            if (
                member.user.bot
            ) {
                continue;
            }

            if (
                !isCountedVoice(
                    member.voice.channel,
                    guild
                )
            ) {
                continue;
            }

            if (
                awardVoiceXP(
                    guild.id,
                    member.id,
                    now
                )
            ) {

                changed = true;
            }
        }
    }

    if (
        changed
    ) {

        saveDB(db);
    }
}

/* =========================================================
   SVG HELPERS
========================================================= */

function escapeXML(
    value
) {

    return String(
        value ?? ''
    )
        .replace(
            /&/g,
            '&amp;'
        )
        .replace(
            /</g,
            '&lt;'
        )
        .replace(
            />/g,
            '&gt;'
        )
        .replace(
            /"/g,
            '&quot;'
        )
        .replace(
            /'/g,
            '&apos;'
        );
}

/* =========================================================
   DOWNLOAD IMAGE
========================================================= */

async function imageToPNG(
    url,
    width,
    height
) {

    if (!url) {
        return null;
    }

    try {

        const response =
            await fetch(url);

        if (
            !response.ok
        ) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const buffer =
            Buffer.from(
                await response.arrayBuffer()
            );

        return await sharp(
            buffer
        )
            .resize(
                width,
                height,
                {
                    fit: 'cover'
                }
            )
            .png()
            .toBuffer();

    } catch {

        return null;
    }
}

/* =========================================================
   DATA URI
========================================================= */

function dataURI(
    buffer
) {

    if (!buffer) {
        return '';
    }

    return (
        'data:image/png;base64,' +
        buffer.toString(
            'base64'
        )
    );
}

/* =========================================================
   PREMIUM PROGRESS BAR
========================================================= */

function progressBar(
    percent,
    color
) {

    const width = 430;

    const filled =
        Math.round(
            width *
            (
                Math.max(
                    0,
                    Math.min(
                        100,
                        percent
                    )
                ) / 100
            )
        );

    return `
        <rect
            x="0"
            y="0"
            width="${width}"
            height="16"
            rx="8"
            fill="#202632"
        />

        <rect
            x="0"
            y="0"
            width="${filled}"
            height="16"
            rx="8"
            fill="${color}"
        />

        <rect
            x="0"
            y="0"
            width="${filled}"
            height="5"
            rx="3"
            fill="#ffffff"
            opacity="0.16"
        />
    `;
}

/* =========================================================
   CREATE RANK IMAGE
========================================================= */

async function createRankCard(
    member
) {

    const user =
        await member.user.fetch(
            true
        ).catch(
            () => member.user
        );

    const userData =
        getUser(
            db,
            member.guild.id,
            user.id
        );

    if (
        isCountedVoice(
            member.voice.channel,
            member.guild
        )
    ) {

        if (
            awardVoiceXP(
                member.guild.id,
                user.id
            )
        ) {

            saveDB(db);
        }
    }

    const textLevel =
        levelInfo(
            userData.textXP
        );

    const voiceLevel =
        levelInfo(
            userData.voiceXP
        );

    /* =====================================================
       AVATAR
    ===================================================== */

    const avatarURL =
        user.displayAvatarURL({
            extension: 'png',
            size: 512
        });

    const avatar =
        await imageToPNG(
            avatarURL,
            280,
            280
        );

    /* =====================================================
       BANNER
    ===================================================== */

    const bannerURL =
        user.bannerURL({
            extension: 'png',
            size: 1024
        }) ||
        member.guild.bannerURL({
            extension: 'png',
            size: 1024
        });

    const banner =
        await imageToPNG(
            bannerURL,
            1200,
            310
        );

    const avatarData =
        dataURI(
            avatar
        );

    const bannerData =
        dataURI(
            banner
        );

    /* =====================================================
       PREMIUM LUXURY SVG
    ===================================================== */

    const svg = `
<svg
    width="1200"
    height="920"
    viewBox="0 0 1200 920"
    xmlns="http://www.w3.org/2000/svg"
>

    <defs>

        <!-- Main background -->
        <linearGradient
            id="bg"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
        >
            <stop
                offset="0%"
                stop-color="#050608"
            />

            <stop
                offset="48%"
                stop-color="#0c0e13"
            />

            <stop
                offset="100%"
                stop-color="#030405"
            />
        </linearGradient>

        <!-- Banner overlay -->
        <linearGradient
            id="bannerOverlay"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
        >
            <stop
                offset="0%"
                stop-color="#050608"
                stop-opacity="0.15"
            />

            <stop
                offset="55%"
                stop-color="#050608"
                stop-opacity="0.42"
            />

            <stop
                offset="100%"
                stop-color="#050608"
                stop-opacity="0.96"
            />
        </linearGradient>

        <!-- Gold -->
        <linearGradient
            id="gold"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
        >
            <stop
                offset="0%"
                stop-color="#8d6819"
            />

            <stop
                offset="45%"
                stop-color="#f0ca63"
            />

            <stop
                offset="70%"
                stop-color="#d6a936"
            />

            <stop
                offset="100%"
                stop-color="#76530f"
            />
        </linearGradient>

        <!-- Gold vertical -->
        <linearGradient
            id="goldVertical"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
        >
            <stop
                offset="0%"
                stop-color="#f4d276"
            />

            <stop
                offset="100%"
                stop-color="#9b711c"
            />
        </linearGradient>

        <!-- Panel -->
        <linearGradient
            id="panel"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
        >
            <stop
                offset="0%"
                stop-color="#15181e"
            />

            <stop
                offset="100%"
                stop-color="#0b0d11"
            />
        </linearGradient>

        <!-- Gold glow -->
        <filter
            id="goldGlow"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
        >
            <feGaussianBlur
                stdDeviation="7"
                result="blur"
            />

            <feMerge>
                <feMergeNode
                    in="blur"
                />

                <feMergeNode
                    in="SourceGraphic"
                />
            </feMerge>
        </filter>

        <!-- Soft shadow -->
        <filter
            id="shadow"
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
        >
            <feDropShadow
                dx="0"
                dy="10"
                stdDeviation="18"
                flood-color="#000000"
                flood-opacity="0.55"
            />
        </filter>

        <!-- Banner -->
        <clipPath
            id="bannerClip"
        >
            <rect
                x="34"
                y="34"
                width="1132"
                height="300"
                rx="30"
            />
        </clipPath>

        <!-- Avatar -->
        <clipPath
            id="avatarClip"
        >
            <circle
                cx="165"
                cy="365"
                r="113"
            />
        </clipPath>

        <!-- Subtle pattern -->
        <pattern
            id="pattern"
            width="70"
            height="70"
            patternUnits="userSpaceOnUse"
        >
            <circle
                cx="2"
                cy="2"
                r="1"
                fill="#ffffff"
                opacity="0.035"
            />
        </pattern>

    </defs>

    <!-- =================================================
         BACKGROUND
    ================================================== -->

    <rect
        width="1200"
        height="920"
        fill="url(#bg)"
    />

    <rect
        width="1200"
        height="920"
        fill="url(#pattern)"
    />

    <!-- Outer frame -->

    <rect
        x="18"
        y="18"
        width="1164"
        height="884"
        rx="38"
        fill="none"
        stroke="#242932"
        stroke-width="2"
    />

    <!-- Small gold accent -->

    <rect
        x="72"
        y="18"
        width="190"
        height="2"
        fill="url(#gold)"
        opacity="0.8"
    />

    <rect
        x="938"
        y="900"
        width="190"
        height="2"
        fill="url(#gold)"
        opacity="0.8"
    />

    <!-- =================================================
         BANNER
    ================================================== -->

    <rect
        x="34"
        y="34"
        width="1132"
        height="300"
        rx="30"
        fill="#0b0d11"
        stroke="#2a2d34"
        stroke-width="2"
        filter="url(#shadow)"
    />

    ${
        bannerData
        ? `
            <g clip-path="url(#bannerClip)">
                <image
                    href="${bannerData}"
                    x="34"
                    y="34"
                    width="1132"
                    height="300"
                    preserveAspectRatio="xMidYMid slice"
                />

                <rect
                    x="34"
                    y="34"
                    width="1132"
                    height="300"
                    fill="url(#bannerOverlay)"
                />
            </g>
        `
        : `
            <rect
                x="34"
                y="34"
                width="1132"
                height="300"
                rx="30"
                fill="#0d1016"
            />

            <rect
                x="34"
                y="34"
                width="1132"
                height="300"
                rx="30"
                fill="url(#bannerOverlay)"
            />
        `
    }

    <!-- Banner border -->

    <rect
        x="34"
        y="34"
        width="1132"
        height="300"
        rx="30"
        fill="none"
        stroke="#363a43"
        stroke-width="2"
    />

    <!-- Gold line -->

    <rect
        x="100"
        y="326"
        width="1000"
        height="2"
        rx="1"
        fill="url(#gold)"
        opacity="0.75"
    />

    <!-- OPS badge -->

    <rect
        x="80"
        y="70"
        width="112"
        height="38"
        rx="19"
        fill="#050608"
        fill-opacity="0.68"
        stroke="#d3a63b"
        stroke-opacity="0.6"
    />

    <text
        x="136"
        y="96"
        text-anchor="middle"
        fill="#e5bc55"
        font-size="16"
        font-family="Arial, sans-serif"
        font-weight="700"
        letter-spacing="4"
    >
        OPS
    </text>

    <!-- Banner username -->

    <text
        x="600"
        y="178"
        text-anchor="middle"
        fill="#ffffff"
        font-size="47"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${escapeXML(user.username)}
    </text>

    <text
        x="600"
        y="216"
        text-anchor="middle"
        fill="#d5d8de"
        opacity="0.8"
        font-size="17"
        font-family="Arial, sans-serif"
        letter-spacing="5"
    >
        RANK PROFILE
    </text>

    <!-- =================================================
         PROFILE AREA
    ================================================== -->

    <!-- Avatar outer shadow -->

    <circle
        cx="165"
        cy="365"
        r="130"
        fill="#000000"
        opacity="0.5"
        filter="url(#shadow)"
    />

    <!-- Avatar gold outer -->

    <circle
        cx="165"
        cy="365"
        r="128"
        fill="#080a0d"
        stroke="url(#gold)"
        stroke-width="4"
    />

    <!-- Avatar blue/gold secondary ring -->

    <circle
        cx="165"
        cy="365"
        r="119"
        fill="none"
        stroke="#555b65"
        stroke-width="2"
        opacity="0.75"
    />

    ${
        avatarData
        ? `
            <g clip-path="url(#avatarClip)">
                <image
                    href="${avatarData}"
                    x="52"
                    y="252"
                    width="226"
                    height="226"
                    preserveAspectRatio="xMidYMid slice"
                />
            </g>
        `
        : `
            <circle
                cx="165"
                cy="365"
                r="113"
                fill="#171a20"
            />
        `
    }

    <!-- Avatar inner border -->

    <circle
        cx="165"
        cy="365"
        r="113"
        fill="none"
        stroke="#ffffff"
        stroke-opacity="0.08"
        stroke-width="2"
    />

    <!-- Online status -->

    <circle
        cx="252"
        cy="452"
        r="18"
        fill="#090b0f"
    />

    <circle
        cx="252"
        cy="452"
        r="11"
        fill="#d6ad43"
    />

    <!-- Identity -->

    <text
        x="335"
        y="360"
        fill="#ffffff"
        font-size="39"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${escapeXML(user.username)}
    </text>

    <text
        x="338"
        y="397"
        fill="#7f8793"
        font-size="20"
        font-family="Arial, sans-serif"
    >
        @${escapeXML(user.username)}
    </text>

    <!-- Divider -->

    <rect
        x="337"
        y="421"
        width="700"
        height="1"
        fill="#292d34"
    />

    <!-- Status -->

    <circle
        cx="350"
        cy="450"
        r="5"
        fill="#d7ad43"
    />

    <text
        x="366"
        y="457"
        fill="#aeb4be"
        font-size="18"
        font-family="Arial, sans-serif"
    >
        متصل الآن
    </text>

    <!-- Profile rank -->

    <text
        x="1020"
        y="457"
        text-anchor="end"
        fill="#686f7a"
        font-size="17"
        font-family="Arial, sans-serif"
    >
        OPS MEMBER
    </text>

    <!-- =================================================
         TEXT LEVEL CARD
    ================================================== -->

    <rect
        x="42"
        y="525"
        width="540"
        height="250"
        rx="26"
        fill="url(#panel)"
        stroke="#292d34"
        stroke-width="2"
        filter="url(#shadow)"
    />

    <!-- Gold top -->

    <rect
        x="42"
        y="525"
        width="540"
        height="3"
        rx="2"
        fill="url(#gold)"
    />

    <!-- Icon -->

    <circle
        cx="86"
        cy="576"
        r="18"
        fill="#171a20"
        stroke="#a77d25"
        stroke-width="1"
    />

    <text
        x="86"
        y="583"
        text-anchor="middle"
        fill="#e5bb57"
        font-size="17"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        T
    </text>

    <text
        x="118"
        y="584"
        fill="#d8dbe0"
        font-size="21"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        المستوى الكتابي
    </text>

    <!-- Level -->

    <text
        x="80"
        y="650"
        fill="#ffffff"
        font-size="55"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${textLevel.level}
    </text>

    <text
        x="132"
        y="649"
        fill="#8d949e"
        font-size="17"
        font-family="Arial, sans-serif"
        letter-spacing="2"
    >
        LEVEL
    </text>

    <!-- XP -->

    <text
        x="500"
        y="649"
        text-anchor="end"
        fill="#b8bdc5"
        font-size="18"
        font-family="Arial, sans-serif"
    >
        ${textLevel.currentXP.toLocaleString('en-US')}
        /
        ${textLevel.nextXP.toLocaleString('en-US')}
        XP
    </text>

    <!-- Progress -->

    <g transform="translate(80 674)">
        ${progressBar(
            textLevel.percent,
            'url(#gold)'
        )}
    </g>

    <text
        x="80"
        y="730"
        fill="#737b87"
        font-size="16"
        font-family="Arial, sans-serif"
    >
        التقدم إلى المستوى التالي
    </text>

    <text
        x="500"
        y="730"
        text-anchor="end"
        fill="#d8b04d"
        font-size="16"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${textLevel.percent}%
    </text>

    <!-- =================================================
         VOICE LEVEL CARD
    ================================================== -->

    <rect
        x="618"
        y="525"
        width="540"
        height="250"
        rx="26"
        fill="url(#panel)"
        stroke="#292d34"
        stroke-width="2"
        filter="url(#shadow)"
    />

    <!-- Gold top -->

    <rect
        x="618"
        y="525"
        width="540"
        height="3"
        rx="2"
        fill="url(#gold)"
    />

    <!-- Icon -->

    <circle
        cx="662"
        cy="576"
        r="18"
        fill="#171a20"
        stroke="#a77d25"
        stroke-width="1"
    />

    <text
        x="662"
        y="583"
        text-anchor="middle"
        fill="#e5bb57"
        font-size="17"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        V
    </text>

    <text
        x="694"
        y="584"
        fill="#d8dbe0"
        font-size="21"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        المستوى الصوتي
    </text>

    <!-- Level -->

    <text
        x="656"
        y="650"
        fill="#ffffff"
        font-size="55"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${voiceLevel.level}
    </text>

    <text
        x="708"
        y="649"
        fill="#8d949e"
        font-size="17"
        font-family="Arial, sans-serif"
        letter-spacing="2"
    >
        LEVEL
    </text>

    <!-- XP -->

    <text
        x="1076"
        y="649"
        text-anchor="end"
        fill="#b8bdc5"
        font-size="18"
        font-family="Arial, sans-serif"
    >
        ${voiceLevel.currentXP.toLocaleString('en-US')}
        /
        ${voiceLevel.nextXP.toLocaleString('en-US')}
        XP
    </text>

    <!-- Progress -->

    <g transform="translate(656 674)">
        ${progressBar(
            voiceLevel.percent,
            'url(#goldVertical)'
        )}
    </g>

    <text
        x="656"
        y="730"
        fill="#737b87"
        font-size="16"
        font-family="Arial, sans-serif"
    >
        التقدم إلى المستوى التالي
    </text>

    <text
        x="1076"
        y="730"
        text-anchor="end"
        fill="#d8b04d"
        font-size="16"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${voiceLevel.percent}%
    </text>

    <!-- =================================================
         FOOTER
    ================================================== -->

    <rect
        x="80"
        y="823"
        width="1040"
        height="1"
        fill="#272b32"
    />

    <circle
        cx="566"
        cy="858"
        r="4"
        fill="#d5a73d"
    />

    <text
        x="600"
        y="864"
        text-anchor="middle"
        fill="#777e89"
        font-size="16"
        font-family="Arial, sans-serif"
        letter-spacing="4"
    >
        OPS SYSTEM
    </text>

    <circle
        cx="634"
        cy="858"
        r="4"
        fill="#d5a73d"
    />

</svg>
`;

    return Buffer.from(
        await sharp(
            Buffer.from(svg)
        )
            .png()
            .toBuffer()
    );
}

/* =========================================================
   SLASH COMMANDS
   فقط العملة
========================================================= */

const slashCommands = [

    new SlashCommandBuilder()
        .setName('currency')
        .setDescription(
            'إدارة روم نظام العملة'
        )

        .addSubcommand(
            sub =>
                sub
                    .setName('enable')
                    .setDescription(
                        'تفعيل نظام العملة في الروم الحالي'
                    )
        )

        .addSubcommand(
            sub =>
                sub
                    .setName('disable')
                    .setDescription(
                        'تعطيل نظام العملة في السيرفر'
                    )
        )
];

/* =========================================================
   REGISTER SLASH
========================================================= */

async function registerSlashCommands() {

    try {

        const rest =
            new REST({
                version: '10'
            })
                .setToken(
                    TOKEN
                );

        await rest.put(
            Routes.applicationCommands(
                client.user.id
            ),
            {
                body:
                    slashCommands.map(
                        command =>
                            command.toJSON()
                    )
            }
        );

        console.log(
            '✅ تم تسجيل أوامر السلاش.'
        );

    } catch (error) {

        console.error(
            '❌ فشل تسجيل أوامر السلاش:',
            error
        );
    }
}

/* =========================================================
   READY
========================================================= */

client.once(
    'ready',
    async () => {

        console.log(
            '======================================'
        );

        console.log(
            `✅ البوت اشتغل: ${client.user.tag}`
        );

        console.log(
            '======================================'
        );

        for (
            const guild of
            client.guilds.cache.values()
        ) {

            ensureGuild(
                db,
                guild.id
            );

            for (
                const member of
                guild.members.cache.values()
            ) {

                if (
                    member.user.bot
                ) {
                    continue;
                }

                if (
                    isCountedVoice(
                        member.voice.channel,
                        guild
                    )
                ) {

                    const user =
                        ensureUser(
                            db,
                            guild.id,
                            member.id
                        );

                    user.voiceLastTickAt =
                        Date.now();
                }
            }
        }

        saveDB(db);

        await registerSlashCommands();

        const statuses = [
            'نظام العملات',
            'نظام الرانك',
            'OPS SYSTEM',
            'استغفر الله'
        ];

        let index = 0;

        const updatePresence = () => {

            client.user.setPresence({

                activities: [
                    {
                        name:
                            'customstatus',

                        type: 4,

                        state:
                            statuses[index]
                    }
                ],

                status:
                    'online'
            });

            index =
                (
                    index + 1
                ) %
                statuses.length;
        };

        updatePresence();

        setInterval(
            updatePresence,
            10000
        );

        setInterval(
            updateAllVoiceXP,
            VOICE_TICK
        );
    }
);

/* =========================================================
   GUILD CREATE
========================================================= */

client.on(
    'guildCreate',
    guild => {

        try {

            ensureGuild(
                db,
                guild.id
            );

            saveDB(db);

            console.log(
                `💾 تم إنشاء بيانات السيرفر: ${guild.id}`
            );

        } catch (error) {

            console.error(
                '❌ خطأ في إنشاء بيانات السيرفر:',
                error
            );
        }
    }
);

/* =========================================================
   MESSAGE COMMANDS
========================================================= */

client.on(
    'messageCreate',
    async message => {

        try {

            if (
                message.author.bot
            ) {
                return;
            }

            if (
                !message.guild
            ) {
                return;
            }

            const content =
                message.content.trim();

            addTextXP(
                message.guild.id,
                message.author.id
            );

            const guildData =
                ensureGuild(
                    db,
                    message.guild.id
                );

            if (
                !guildData.economyChannelId ||
                guildData.economyChannelId !==
                    message.channel.id
            ) {

                return;
            }

            const balanceCommand =
                content === 'رصيد' ||
                content.toLowerCase() === 'ops' ||
                content === '𝐎𝐏𝐬' ||
                content.startsWith('رصيد ') ||
                content
                    .toLowerCase()
                    .startsWith('ops ') ||
                content.startsWith('𝐎𝐏𝐬 ');

            if (
                balanceCommand
            ) {

                const targetMember =
                    message.mentions.members.first() ||
                    message.member;

                const targetUser =
                    getUser(
                        db,
                        message.guild.id,
                        targetMember.id
                    );

                return message.channel.send({

                    embeds: [

                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )

                            .setDescription(

                                targetMember.id ===
                                message.author.id

                                    ? `رصيدك الحالي : **${formatAmount(
                                        targetUser.balance
                                    )} 𝐎𝐏𝐬**`

                                    : `رصيد العضو ${targetMember} الحالي : **${formatAmount(
                                        targetUser.balance
                                    )} 𝐎𝐏𝐬**`
                            )
                    ]
                });
            }

            if (
                content.startsWith(
                    'تحويل'
                )
            ) {

                const args =
                    content.split(
                        /\s+/
                    );

                const targetMember =
                    message.mentions.members.first();

                const argValue =
                    args[2]
                        ? args[2].toLowerCase()
                        : '';

                if (
                    !targetMember ||
                    !argValue
                ) {

                    return message.channel.send({

                        embeds: [

                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )

                                .setDescription(
                                    '❌ الاستخدام الصحيح: `تحويل @منشن المبلغ` أو `تحويل @منشن نص` أو `تحويل @منشن كامل`'
                                )
                        ]
                    });
                }

                if (
                    targetMember.id ===
                    message.author.id
                ) {

                    return message.channel.send({

                        embeds: [

                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )

                                .setDescription(
                                    '❌ لا يمكنك التحويل لنفسك!'
                                )
                        ]
                    });
                }

                const currentBalance =
                    userBalance(
                        db,
                        message.guild.id,
                        message.author.id
                    );

                let amount = 0;

                if (
                    argValue === 'كامل'
                ) {

                    amount =
                        currentBalance;

                } else if (
                    argValue === 'نص'
                ) {

                    amount =
                        Math.floor(
                            currentBalance / 2
                        );

                } else {

                    amount =
                        parseAmount(
                            argValue
                        );
                }

                if (
                    isNaN(amount) ||
                    amount <= 0
                ) {

                    return message.channel.send({

                        embeds: [

                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )

                                .setDescription(
                                    '❌ يرجى كتابة مبلغ صالح.'
                                )
                        ]
                    });
                }

                if (
                    currentBalance <
                    amount
                ) {

                    return message.channel.send({

                        embeds: [

                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )

                                .setDescription(
                                    '❌ ليس لديك رصيد كافٍ لإتمام عملية التحويل.'
                                )
                        ]
                    });
                }

                const row =
                    new ActionRowBuilder()
                        .addComponents(

                            new ButtonBuilder()
                                .setCustomId(
                                    `verify_transfer_${message.author.id}_${targetMember.id}_${amount}`
                                )

                                .setLabel(
                                    'إظهار رمز التحقق'
                                )

                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                        );

                const sentMsg =
                    await message.channel.send({

                        content:
                            '🔒 يرجى الضغط على الزر أدناه لإظهار رمز التحقق وإرساله في الشات لتأكيد عملية التحويل.',

                        components: [
                            row
                        ]
                    });

                pendingTransfers.set(

                    transferKey(
                        message.guild.id,
                        message.author.id
                    ),

                    {
                        guildId:
                            message.guild.id,

                        targetId:
                            targetMember.id,

                        amount,

                        code:
                            '',

                        botMsg:
                            sentMsg
                    }
                );

                return;
            }

            if (
                content === 'توب' ||
                content === 'التوب' ||
                content.toLowerCase() === 'top' ||
                /^توب\s+[1-5]$/i.test(
                    content
                )
            ) {

                let page = 1;

                if (
                    content.startsWith(
                        'توب '
                    )
                ) {

                    page =
                        parseInt(
                            content.split(
                                /\s+/
                            )[1]
                        );
                }

                if (
                    page < 1 ||
                    page > 5
                ) {

                    return message.channel.send({

                        embeds: [

                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )

                                .setDescription(
                                    '❌ صفحات التوب من 1 إلى 5 فقط.'
                                )
                        ]
                    });
                }

                const sortedUsers =
                    Object.entries(
                        guildData.users
                    )
                        .filter(
                            ([, data]) =>
                                Number(
                                    data.balance
                                ) > 0
                        )

                        .sort(
                            (a, b) =>
                                Number(
                                    b[1].balance
                                ) -
                                Number(
                                    a[1].balance
                                )
                        );

                const start =
                    (
                        page - 1
                    ) *
                    10;

                const pageUsers =
                    sortedUsers.slice(
                        start,
                        start + 10
                    );

                let description = '';

                pageUsers.forEach(
                    (
                        [userId, data],
                        index
                    ) => {

                        description +=
                            `#${start + index + 1} <@${userId}> — **${formatAmount(
                                data.balance
                            )} 𝐎𝐏𝐬**\n`;
                    }
                );

                if (
                    !description
                ) {

                    description =
                        `الصفحة **${page}** فارغة.`;
                }

                return message.channel.send({

                    embeds: [

                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )

                            .setTitle(
                                `قائمة التوب — الصفحة ${page}`
                            )

                            .setDescription(
                                description
                            )
                    ]
                });
            }

        } catch (error) {

            console.error(
                '❌ Message Error:',
                error
            );
        }
    }
);

/* =========================================================
   RANK COMMAND
========================================================= */

client.on(
    'messageCreate',
    async message => {

        try {

            if (
                message.author.bot
            ) {
                return;
            }

            if (
                !message.guild
            ) {
                return;
            }

            const content =
                message.content.trim();

            const isRankCommand =
                content === 'رانك' ||
                content === 'r' ||
                content === 'R' ||
                content.startsWith('رانك ') ||
                content.startsWith('r ') ||
                content.startsWith('R ');

            if (
                !isRankCommand
            ) {
                return;
            }

            const targetMember =
                message.mentions.members.first() ||
                message.member;

            const image =
                await createRankCard(
                    targetMember
                );

            const attachment =
                new AttachmentBuilder(
                    image,
                    {
                        name:
                            'rank.png'
                    }
                );

            return message.channel.send({
                files: [
                    attachment
                ]
            });

        } catch (error) {

            console.error(
                '❌ Rank Error:',
                error
            );

            return message.channel.send({

                embeds: [

                    new EmbedBuilder()
                        .setColor(
                            '#D4AC0D'
                        )

                        .setDescription(
                            '❌ تعذر إنشاء صورة الرانك حالياً.'
                        )
                ]
            });
        }
    }
);

/* =========================================================
   CONFIRM TRANSFER
========================================================= */

client.on(
    'messageCreate',
    async message => {

        try {

            if (
                message.author.bot
            ) {
                return;
            }

            if (
                !message.guild
            ) {
                return;
            }

            const guildData =
                ensureGuild(
                    db,
                    message.guild.id
                );

            if (
                guildData.economyChannelId !==
                message.channel.id
            ) {
                return;
            }

            const content =
                message.content.trim();

            const key =
                transferKey(
                    message.guild.id,
                    message.author.id
                );

            if (
                !pendingTransfers.has(
                    key
                )
            ) {
                return;
            }

            const transfer =
                pendingTransfers.get(
                    key
                );

            if (
                !transfer.code ||
                content !==
                    transfer.code
            ) {
                return;
            }

            pendingTransfers.delete(
                key
            );

            await message
                .delete()
                .catch(
                    () => {}
                );

            if (
                transfer.botMsg
            ) {

                await transfer.botMsg
                    .delete()
                    .catch(
                        () => {}
                    );
            }

            const sender =
                getUser(
                    db,
                    message.guild.id,
                    message.author.id
                );

            const target =
                getUser(
                    db,
                    message.guild.id,
                    transfer.targetId
                );

            if (
                sender.balance <
                transfer.amount
            ) {

                return message.channel.send({

                    embeds: [

                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )

                            .setDescription(
                                '❌ ليس لديك رصيد كافٍ لإتمام عملية التحويل.'
                            )
                    ]
                });
            }

            sender.balance -=
                transfer.amount;

            target.balance +=
                transfer.amount;

            saveDB(db);

            const targetMember =
                await message.guild.members
                    .fetch(
                        transfer.targetId
                    )
                    .catch(
                        () => null
                    );

            const receiptEmbed =
                new EmbedBuilder()
                    .setColor(
                        '#D4AC0D'
                    )

                    .setTitle(
                        'إيصال تحويل'
                    )

                    .setDescription(
                        `**${formatAmount(
                            transfer.amount
                        )} 𝐎𝐏𝐬**\n\nمن: ${message.author}\nإلى: ${
                            targetMember ||
                            `<@${transfer.targetId}>`
                        }`
                    )

                    .setTimestamp();

            await message.author
                .send({
                    embeds: [
                        receiptEmbed
                    ]
                })
                .catch(
                    () => {}
                );

            if (
                targetMember
            ) {

                await targetMember
                    .send({
                        embeds: [
                            receiptEmbed
                        ]
                    })
                    .catch(
                        () => {}
                    );
            }

            return message.channel.send({

                embeds: [

                    new EmbedBuilder()
                        .setColor(
                            '#D4AC0D'
                        )

                        .setDescription(
                            `✅ تم التحويل بنجاح بقيمة **${formatAmount(
                                transfer.amount
                            )} 𝐎𝐏𝐬**.`
                        )
                ]
            });

        } catch (error) {

            console.error(
                '❌ Transfer Error:',
                error
            );
        }
    }
);

/* =========================================================
   VOICE XP
========================================================= */

client.on(
    'voiceStateUpdate',
    (
        oldState,
        newState
    ) => {

        try {

            const member =
                newState.member ||
                oldState.member;

            if (
                !member ||
                member.user.bot
            ) {
                return;
            }

            const guild =
                member.guild;

            const user =
                getUser(
                    db,
                    guild.id,
                    member.id
                );

            const now =
                Date.now();

            if (
                isCountedVoice(
                    oldState.channel,
                    guild
                )
            ) {

                if (
                    awardVoiceXP(
                        guild.id,
                        member.id,
                        now
                    )
                ) {

                    saveDB(db);
                }
            }

            if (
                isCountedVoice(
                    newState.channel,
                    guild
                )
            ) {

                user.voiceLastTickAt =
                    now;

                saveDB(db);

            } else {

                user.voiceLastTickAt =
                    null;

                saveDB(db);
            }

        } catch (error) {

            console.error(
                '❌ Voice XP Error:',
                error
            );
        }
    }
);

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
    'interactionCreate',
    async interaction => {

        try {

            if (
                interaction.isChatInputCommand()
            ) {

                if (
                    !interaction.guild
                ) {

                    return interaction.reply({

                        content:
                            '❌ هذا الأمر يعمل داخل السيرفر فقط.',

                        ephemeral:
                            true
                    });
                }

                if (
                    interaction.commandName !==
                    'currency'
                ) {
                    return;
                }

                if (
                    !isAdmin(
                        interaction.member
                    )
                ) {

                    return interaction.reply({

                        content:
                            '❌ هذا الأمر مخصص للإداريين فقط.',

                        ephemeral:
                            true
                    });
                }

                const guildData =
                    ensureGuild(
                        db,
                        interaction.guild.id
                    );

                const subcommand =
                    interaction.options
                        .getSubcommand();

                if (
                    subcommand ===
                    'enable'
                ) {

                    guildData.economyChannelId =
                        interaction.channel.id;

                    saveDB(db);

                    return interaction.reply({

                        embeds: [

                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )

                                .setDescription(
                                    `✅ تم تفعيل نظام العملة في <#${interaction.channel.id}>.\n\n💾 تم حفظ التفعيل للسيرفر.`
                                )
                        ]
                    });
                }

                if (
                    subcommand ===
                    'disable'
                ) {

                    guildData.economyChannelId =
                        null;

                    cleanupPendingForGuild(
                        interaction.guild.id
                    );

                    saveDB(db);

                    return interaction.reply({

                        embeds: [

                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )

                                .setDescription(
                                    '✅ تم تعطيل نظام العملة في هذا السيرفر.'
                                )
                        ]
                    });
                }

                return;
            }

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'verify_transfer_'
                )
            ) {

                if (
                    !interaction.guild
                ) {

                    return interaction.reply({

                        content:
                            '❌ هذا الزر داخل السيرفر فقط.',

                        ephemeral:
                            true
                    });
                }

                const parts =
                    interaction.customId.split(
                        '_'
                    );

                const senderId =
                    parts[2];

                const targetId =
                    parts[3];

                const amount =
                    Number(
                        parts[4]
                    );

                if (
                    interaction.user.id !==
                    senderId
                ) {

                    return interaction.reply({

                        content:
                            '❌ هذا الزر ليس مخصصاً لك.',

                        ephemeral:
                            true
                    });
                }

                const key =
                    transferKey(
                        interaction.guild.id,
                        senderId
                    );

                const transfer =
                    pendingTransfers.get(
                        key
                    );

                if (
                    !transfer
                ) {

                    return interaction.reply({

                        content:
                            '❌ عملية التحويل انتهت أو غير موجودة.',

                        ephemeral:
                            true
                    });
                }

                const balance =
                    userBalance(
                        db,
                        interaction.guild.id,
                        senderId
                    );

                if (
                    balance <
                    amount
                ) {

                    pendingTransfers.delete(
                        key
                    );

                    return interaction.reply({

                        content:
                            '❌ لم يعد لديك رصيد كافٍ.',

                        ephemeral:
                            true
                    });
                }

                let code = '';

                for (
                    let i = 0;
                    i < 6;
                    i++
                ) {

                    code +=
                        Math.floor(
                            Math.random() *
                            10
                        );
                }

                transfer.code =
                    code;

                pendingTransfers.set(
                    key,
                    transfer
                );

                return interaction.reply({

                    content:
                        `🔐 رمز التحقق الخاص بالتحويل:\n\n**${code}**\n\nقم بإرسال الرمز في روم العملات لتأكيد العملية.`,

                    ephemeral:
                        true
                });
            }

        } catch (error) {

            console.error(
                '❌ Interaction Error:',
                error
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {

                await interaction
                    .reply({

                        content:
                            '❌ حدث خطأ أثناء تنفيذ العملية.',

                        ephemeral:
                            true
                    })

                    .catch(
                        () => {}
                    );
            }
        }
    }
);

/* =========================================================
   ERRORS
========================================================= */

client.on(
    'error',
    error => {

        console.error(
            '❌ Discord Client Error:',
            error
        );
    }
);

process.on(
    'unhandledRejection',
    error => {

        console.error(
            '❌ Unhandled Rejection:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {

        console.error(
            '❌ Uncaught Exception:',
            error
        );
    }
);

/* =========================================================
   SAVE BEFORE SHUTDOWN
========================================================= */

function gracefulSave() {

    try {

        saveDB(db);

        console.log(
            '💾 تم حفظ جميع البيانات.'
        );

    } catch (error) {

        console.error(
            '❌ خطأ أثناء الحفظ قبل الإغلاق:',
            error
        );
    }
}

process.on(
    'SIGINT',
    () => {

        gracefulSave();

        client.destroy();

        process.exit(0);
    }
);

process.on(
    'SIGTERM',
    () => {

        gracefulSave();

        client.destroy();

        process.exit(0);
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
            '❌ فشل تسجيل الدخول إلى Discord.'
        );

        console.error(
            error
        );

        process.exit(1);
    }
);