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

const DB_FILE = path.join(DATA_DIR, 'economy.json');
const DB_BACKUP_FILE = path.join(DATA_DIR, 'economy.backup.json');
const DB_TEMP_FILE = path.join(DATA_DIR, 'economy.tmp.json');

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
            throw new Error('Invalid database');
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

            if (fs.existsSync(DB_BACKUP_FILE)) {

                const backup = JSON.parse(
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

    const json = JSON.stringify(
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

        if (fs.existsSync(DB_FILE)) {
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
            if (fs.existsSync(DB_TEMP_FILE)) {
                fs.unlinkSync(DB_TEMP_FILE);
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
            Number(user.balance) || 0;
    }

    if (
        typeof user.textXP !== 'number'
    ) {
        user.textXP =
            Number(user.textXP) || 0;
    }

    if (
        typeof user.voiceXP !== 'number'
    ) {
        user.voiceXP =
            Number(user.voiceXP) || 0;
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
        Number(match[1]);

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

    if (!Number.isFinite(amount)) {
        return NaN;
    }

    return Math.floor(amount);
}

/* =========================================================
   FORMAT AMOUNT
========================================================= */

function formatAmount(amount) {

    amount =
        Number(amount) || 0;

    if (amount < 1000) {
        return String(amount);
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

    for (const unit of units) {

        if (amount >= unit.value) {

            const result =
                amount / unit.value;

            if (Number.isInteger(result)) {
                return `${result}${unit.suffix}`;
            }

            return `${Number(
                result.toFixed(2)
            )}${unit.suffix}`;
        }
    }

    return String(amount);
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
        const [key, value]
        of pendingTransfers.entries()
    ) {

        if (value.guildId === guildId) {
            pendingTransfers.delete(key);
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

function levelInfo(totalXP) {

    let level = 1;

    let remainingXP =
        Math.max(
            0,
            Math.floor(
                Number(totalXP) || 0
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
        currentXP: remainingXP,
        nextXP: needed,
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
        textCooldowns.get(key) || 0;

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

    if (!user.voiceLastTickAt) {

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
            elapsed / 60000
        );

    if (minutes <= 0) {
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

            if (member.user.bot) {
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

    if (changed) {
        saveDB(db);
    }
}

/* =========================================================
   SVG HELPERS
========================================================= */

function escapeXML(value) {

    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
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

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const buffer =
            Buffer.from(
                await response.arrayBuffer()
            );

        return await sharp(buffer)
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

function dataURI(buffer) {

    if (!buffer) {
        return '';
    }

    return (
        'data:image/png;base64,' +
        buffer.toString('base64')
    );
}

/* =========================================================
   PROGRESS BAR
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
            height="18"
            rx="9"
            fill="#252525"
        />

        <rect
            x="0"
            y="0"
            width="${filled}"
            height="18"
            rx="9"
            fill="${color}"
        />
    `;
}

/* =========================================================
   NEW RANK CARD DESIGN
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
            320,
            320
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
            1400,
            360
        );

    const avatarData =
        dataURI(avatar);

    const bannerData =
        dataURI(banner);

    const textFilled =
        Math.round(
            555 *
            (
                Math.max(
                    0,
                    Math.min(
                        100,
                        textLevel.percent
                    )
                ) / 100
            )
        );

    const voiceFilled =
        Math.round(
            555 *
            (
                Math.max(
                    0,
                    Math.min(
                        100,
                        voiceLevel.percent
                    )
                ) / 100
            )
        );

    const svg = `

<svg
    width="1400"
    height="900"
    viewBox="0 0 1400 900"
    xmlns="http://www.w3.org/2000/svg"
>

    <defs>

        <linearGradient
            id="bg"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
        >

            <stop
                offset="0%"
                stop-color="#050505"
            />

            <stop
                offset="50%"
                stop-color="#10100f"
            />

            <stop
                offset="100%"
                stop-color="#050505"
            />

        </linearGradient>

        <linearGradient
            id="bannerOverlay"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
        >

            <stop
                offset="0%"
                stop-color="#000000"
                stop-opacity="0.10"
            />

            <stop
                offset="100%"
                stop-color="#000000"
                stop-opacity="0.82"
            />

        </linearGradient>

        <linearGradient
            id="gold"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
        >

            <stop
                offset="0%"
                stop-color="#8b6817"
            />

            <stop
                offset="50%"
                stop-color="#f0c64d"
            />

            <stop
                offset="100%"
                stop-color="#a87d1c"
            />

        </linearGradient>

        <linearGradient
            id="goldXP"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
        >

            <stop
                offset="0%"
                stop-color="#9b741b"
            />

            <stop
                offset="50%"
                stop-color="#e7bb42"
            />

            <stop
                offset="100%"
                stop-color="#ffd96a"
            />

        </linearGradient>

        <linearGradient
            id="blueXP"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
        >

            <stop
                offset="0%"
                stop-color="#2167c9"
            />

            <stop
                offset="50%"
                stop-color="#3d9cff"
            />

            <stop
                offset="100%"
                stop-color="#70c1ff"
            />

        </linearGradient>

        <clipPath id="bannerClip">

            <rect
                x="35"
                y="35"
                width="1330"
                height="330"
                rx="30"
            />

        </clipPath>

        <clipPath id="avatarClip">

            <circle
                cx="190"
                cy="360"
                r="118"
            />

        </clipPath>

        <filter
            id="softGlow"
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

        <filter
            id="shadow"
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
        >

            <feDropShadow
                dx="0"
                dy="12"
                stdDeviation="18"
                flood-color="#000000"
                flood-opacity="0.65"
            />

        </filter>

    </defs>


    <!-- BACKGROUND -->

    <rect
        width="1400"
        height="900"
        fill="url(#bg)"
    />

    <circle
        cx="1250"
        cy="90"
        r="180"
        fill="#d4ac0d"
        opacity="0.025"
    />

    <circle
        cx="80"
        cy="820"
        r="220"
        fill="#d4ac0d"
        opacity="0.018"
    />


    <!-- MAIN CARD -->

    <rect
        x="25"
        y="25"
        width="1350"
        height="850"
        rx="34"
        fill="#0b0b0b"
        stroke="#242424"
        stroke-width="2"
        filter="url(#shadow)"
    />


    <!-- BANNER -->

    <rect
        x="35"
        y="35"
        width="1330"
        height="330"
        rx="30"
        fill="#151515"
    />

    ${
        bannerData
        ? `
            <g clip-path="url(#bannerClip)">

                <image
                    href="${bannerData}"
                    x="35"
                    y="35"
                    width="1330"
                    height="330"
                    preserveAspectRatio="xMidYMid slice"
                />

                <rect
                    x="35"
                    y="35"
                    width="1330"
                    height="330"
                    fill="url(#bannerOverlay)"
                />

            </g>
        `
        : `
            <rect
                x="35"
                y="35"
                width="1330"
                height="330"
                rx="30"
                fill="#111111"
            />

            <circle
                cx="1180"
                cy="100"
                r="210"
                fill="#d4ac0d"
                opacity="0.045"
            />
        `
    }


    <!-- GOLD LINE -->

    <rect
        x="65"
        y="348"
        width="1270"
        height="2"
        rx="1"
        fill="url(#gold)"
        opacity="0.65"
    />


    <!-- AVATAR -->

    <circle
        cx="190"
        cy="360"
        r="137"
        fill="#080808"
        stroke="#171717"
        stroke-width="8"
    />

    <circle
        cx="190"
        cy="360"
        r="128"
        fill="none"
        stroke="url(#gold)"
        stroke-width="4"
        filter="url(#softGlow)"
    />

    ${
        avatarData
        ? `
            <g clip-path="url(#avatarClip)">

                <image
                    href="${avatarData}"
                    x="72"
                    y="242"
                    width="236"
                    height="236"
                    preserveAspectRatio="xMidYMid slice"
                />

            </g>
        `
        : ''
    }

    <circle
        cx="190"
        cy="360"
        r="118"
        fill="none"
        stroke="#ffffff"
        stroke-opacity="0.08"
        stroke-width="2"
    />


    <!-- ONLINE -->

    <circle
        cx="280"
        cy="448"
        r="20"
        fill="#0b0b0b"
        stroke="#0b0b0b"
        stroke-width="7"
    />

    <circle
        cx="280"
        cy="448"
        r="12"
        fill="#35d17b"
    />


    <!-- USER INFO -->

    <text
        x="355"
        y="295"
        fill="#ffffff"
        font-size="48"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${escapeXML(user.username)}
    </text>

    <text
        x="357"
        y="335"
        fill="#858585"
        font-size="22"
        font-family="Arial, sans-serif"
    >
        @${escapeXML(user.username)}
    </text>


    <!-- MEMBER BADGE -->

    <rect
        x="355"
        y="375"
        width="148"
        height="42"
        rx="21"
        fill="#151515"
        stroke="#3a2d0e"
        stroke-width="1"
    />

    <circle
        cx="380"
        cy="396"
        r="6"
        fill="#d4ac0d"
    />

    <text
        x="397"
        y="404"
        fill="#d8b348"
        font-size="17"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        OPS MEMBER
    </text>


    <!-- TOP RIGHT -->

    <text
        x="1290"
        y="290"
        fill="#6e6e6e"
        text-anchor="end"
        font-size="17"
        font-family="Arial, sans-serif"
        letter-spacing="4"
    >
        RANK PROFILE
    </text>

    <text
        x="1290"
        y="325"
        fill="#d4ac0d"
        text-anchor="end"
        font-size="25"
        font-family="Arial, sans-serif"
        font-weight="700"
        letter-spacing="2"
    >
        OPS SYSTEM
    </text>


    <!-- TEXT LEVEL CARD -->

    <rect
        x="55"
        y="535"
        width="625"
        height="245"
        rx="25"
        fill="#111111"
        stroke="#252525"
        stroke-width="2"
    />

    <rect
        x="55"
        y="535"
        width="5"
        height="245"
        rx="2"
        fill="url(#blueXP)"
    />

    <text
        x="90"
        y="585"
        fill="#7abfff"
        font-size="20"
        font-family="Arial, sans-serif"
        font-weight="700"
        letter-spacing="1"
    >
        TEXT LEVEL
    </text>

    <text
        x="90"
        y="640"
        fill="#ffffff"
        font-size="43"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        LV. ${textLevel.level}
    </text>

    <text
        x="640"
        y="640"
        fill="#676767"
        text-anchor="end"
        font-size="17"
        font-family="Arial, sans-serif"
    >
        ${textLevel.percent}% COMPLETE
    </text>


    <!-- TEXT XP -->

    <g transform="translate(90 665)">

        <rect
            x="0"
            y="0"
            width="555"
            height="15"
            rx="7.5"
            fill="#222222"
        />

        <rect
            x="0"
            y="0"
            width="${textFilled}"
            height="15"
            rx="7.5"
            fill="url(#blueXP)"
        />

    </g>

    <text
        x="90"
        y="720"
        fill="#b9b9b9"
        font-size="18"
        font-family="Arial, sans-serif"
    >
        ${textLevel.currentXP.toLocaleString('en-US')}
        /
        ${textLevel.nextXP.toLocaleString('en-US')}
        XP
    </text>

    <text
        x="640"
        y="720"
        fill="#555555"
        text-anchor="end"
        font-size="16"
        font-family="Arial, sans-serif"
    >
        CHAT ACTIVITY
    </text>


    <!-- VOICE LEVEL CARD -->

    <rect
        x="720"
        y="535"
        width="625"
        height="245"
        rx="25"
        fill="#111111"
        stroke="#252525"
        stroke-width="2"
    />

    <rect
        x="720"
        y="535"
        width="5"
        height="245"
        rx="2"
        fill="url(#gold)"
    />

    <text
        x="755"
        y="585"
        fill="#e1b83f"
        font-size="20"
        font-family="Arial, sans-serif"
        font-weight="700"
        letter-spacing="1"
    >
        VOICE LEVEL
    </text>

    <text
        x="755"
        y="640"
        fill="#ffffff"
        font-size="43"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        LV. ${voiceLevel.level}
    </text>

    <text
        x="1305"
        y="640"
        fill="#676767"
        text-anchor="end"
        font-size="17"
        font-family="Arial, sans-serif"
    >
        ${voiceLevel.percent}% COMPLETE
    </text>


    <!-- VOICE XP -->

    <g transform="translate(755 665)">

        <rect
            x="0"
            y="0"
            width="555"
            height="15"
            rx="7.5"
            fill="#222222"
        />

        <rect
            x="0"
            y="0"
            width="${voiceFilled}"
            height="15"
            rx="7.5"
            fill="url(#goldXP)"
        />

    </g>

    <text
        x="755"
        y="720"
        fill="#b9b9b9"
        font-size="18"
        font-family="Arial, sans-serif"
    >
        ${voiceLevel.currentXP.toLocaleString('en-US')}
        /
        ${voiceLevel.nextXP.toLocaleString('en-US')}
        XP
    </text>

    <text
        x="1305"
        y="720"
        fill="#555555"
        text-anchor="end"
        font-size="16"
        font-family="Arial, sans-serif"
    >
        VOICE ACTIVITY
    </text>


    <!-- FOOTER -->

    <rect
        x="55"
        y="810"
        width="1290"
        height="1"
        fill="#242424"
    />

    <text
        x="70"
        y="842"
        fill="#454545"
        font-size="15"
        font-family="Arial, sans-serif"
        letter-spacing="3"
    >
        OPS SYSTEM
    </text>

    <text
        x="1330"
        y="842"
        fill="#444444"
        text-anchor="end"
        font-size="14"
        font-family="Arial, sans-serif"
    >
        PROFILE
    </text>

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
                .setToken(TOKEN);

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

                if (member.user.bot) {
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
                        name: 'customstatus',
                        type: 4,
                        state: statuses[index]
                    }
                ],

                status: 'online'
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

            if (message.author.bot) {
                return;
            }

            if (!message.guild) {
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

            /* =================================================
               رصيد
            ================================================= */

            const balanceCommand =
                content === 'رصيد' ||
                content.toLowerCase() === 'ops' ||
                content === '𝐎𝐏𝐬' ||
                content.startsWith('رصيد ') ||
                content.toLowerCase().startsWith('ops ') ||
                content.startsWith('𝐎𝐏𝐬 ');

            if (balanceCommand) {

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
                            .setColor('#D4AC0D')

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

            /* =================================================
               تحويل
            ================================================= */

            if (
                content.startsWith('تحويل')
            ) {

                const args =
                    content.split(/\s+/);

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
                                .setColor('#D4AC0D')

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
                                .setColor('#D4AC0D')

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
                                .setColor('#D4AC0D')

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
                                .setColor('#D4AC0D')

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

                        code: '',

                        botMsg:
                            sentMsg
                    }
                );

                return;
            }

            /* =================================================
               توب
            ================================================= */

            if (
                content === 'توب' ||
                content === 'التوب' ||
                content.toLowerCase() === 'top' ||
                /^توب\s+[1-5]$/i.test(content)
            ) {

                let page = 1;

                if (
                    content.startsWith('توب ')
                ) {

                    page =
                        parseInt(
                            content.split(/\s+/)[1]
                        );
                }

                if (
                    page < 1 ||
                    page > 5
                ) {

                    return message.channel.send({

                        embeds: [

                            new EmbedBuilder()
                                .setColor('#D4AC0D')

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
                    ) * 10;

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

                if (!description) {
                    description =
                        `الصفحة **${page}** فارغة.`;
                }

                return message.channel.send({

                    embeds: [

                        new EmbedBuilder()
                            .setColor('#D4AC0D')

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

            if (message.author.bot) {
                return;
            }

            if (!message.guild) {
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

            if (!isRankCommand) {
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
                        name: 'rank.png'
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
                        .setColor('#D4AC0D')

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

            if (message.author.bot) {
                return;
            }

            if (!message.guild) {
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

            if (!pendingTransfers.has(key)) {
                return;
            }

            const transfer =
                pendingTransfers.get(key);

            if (
                !transfer.code ||
                content !== transfer.code
            ) {
                return;
            }

            pendingTransfers.delete(key);

            await message
                .delete()
                .catch(() => {});

            if (transfer.botMsg) {

                await transfer.botMsg
                    .delete()
                    .catch(() => {});
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
                            .setColor('#D4AC0D')

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
                    .setColor('#D4AC0D')

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
                .catch(() => {});

            if (targetMember) {

                await targetMember
                    .send({
                        embeds: [
                            receiptEmbed
                        ]
                    })
                    .catch(() => {});
            }

            return message.channel.send({

                embeds: [

                    new EmbedBuilder()
                        .setColor('#D4AC0D')

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

            /* =================================================
               SLASH
            ================================================= */

            if (
                interaction.isChatInputCommand()
            ) {

                if (!interaction.guild) {

                    return interaction.reply({

                        content:
                            '❌ هذا الأمر يعمل داخل السيرفر فقط.',

                        ephemeral: true
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

                        ephemeral: true
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

                /* ENABLE */

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
                                .setColor('#D4AC0D')

                                .setDescription(
                                    `✅ تم تفعيل نظام العملة في <#${interaction.channel.id}>.\n\n💾 تم حفظ التفعيل للسيرفر.`
                                )
                        ]
                    });
                }

                /* DISABLE */

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
                                .setColor('#D4AC0D')

                                .setDescription(
                                    '✅ تم تعطيل نظام العملة في هذا السيرفر.'
                                )
                        ]
                    });
                }

                return;
            }

            /* =================================================
               VERIFY TRANSFER BUTTON
            ================================================= */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'verify_transfer_'
                )
            ) {

                if (!interaction.guild) {

                    return interaction.reply({

                        content:
                            '❌ هذا الزر داخل السيرفر فقط.',

                        ephemeral: true
                    });
                }

                const parts =
                    interaction.customId.split('_');

                const senderId =
                    parts[2];

                const targetId =
                    parts[3];

                const amount =
                    Number(parts[4]);

                if (
                    interaction.user.id !==
                    senderId
                ) {

                    return interaction.reply({

                        content:
                            '❌ هذا الزر ليس مخصصاً لك.',

                        ephemeral: true
                    });
                }

                const key =
                    transferKey(
                        interaction.guild.id,
                        senderId
                    );

                const transfer =
                    pendingTransfers.get(key);

                if (!transfer) {

                    return interaction.reply({

                        content:
                            '❌ عملية التحويل انتهت أو غير موجودة.',

                        ephemeral: true
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

                        ephemeral: true
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
                            Math.random() * 10
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

                    ephemeral: true
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

                        ephemeral: true
                    })
                    .catch(() => {});
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