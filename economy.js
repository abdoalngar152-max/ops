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

async function createRankCard(member) {

    const user = await member.user.fetch(true).catch(() => member.user);

    const userData = getUser(
        db,
        member.guild.id,
        user.id
    );

    if (isCountedVoice(member.voice.channel, member.guild)) {
        if (awardVoiceXP(member.guild.id, user.id)) {
            saveDB(db);
        }
    }

    const textLevel = levelInfo(userData.textXP);
    const voiceLevel = levelInfo(userData.voiceXP);

    const avatarURL = user.displayAvatarURL({
        extension: 'png',
        size: 512
    });

    const avatar = await imageToPNG(
        avatarURL,
        360,
        360
    );

    const avatarData = dataURI(avatar);

    const voiceWidth = Math.max(
        8,
        Math.round(496 * (voiceLevel.percent / 100))
    );

    const textWidth = Math.max(
        8,
        Math.round(496 * (textLevel.percent / 100))
    );

    const svg = `
<svg
    width="1000"
    height="1000"
    viewBox="0 0 1000 1000"
    xmlns="http://www.w3.org/2000/svg"
>

    <defs>

        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#07080b"/>
            <stop offset="50%" stop-color="#12151c"/>
            <stop offset="100%" stop-color="#050609"/>
        </linearGradient>

        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#805b12"/>
            <stop offset="35%" stop-color="#d9a936"/>
            <stop offset="55%" stop-color="#ffe28a"/>
            <stop offset="75%" stop-color="#d3a12d"/>
            <stop offset="100%" stop-color="#76500d"/>
        </linearGradient>

        <linearGradient id="voiceBar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#245f91"/>
            <stop offset="65%" stop-color="#39709e"/>
            <stop offset="100%" stop-color="#bd921b"/>
        </linearGradient>

        <linearGradient id="textBar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#245f91"/>
            <stop offset="65%" stop-color="#39709e"/>
            <stop offset="100%" stop-color="#bd921b"/>
        </linearGradient>

        <pattern id="dots" width="42" height="42" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.2" fill="#ffffff" opacity="0.035"/>
        </pattern>

        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
                dx="0"
                dy="12"
                stdDeviation="18"
                flood-color="#000000"
                flood-opacity="0.7"
            />
        </filter>

        <clipPath id="avatarClip">
            <circle cx="500" cy="205" r="142"/>
        </clipPath>

    </defs>

    <!-- BACKGROUND -->

    <rect
        width="1000"
        height="1000"
        rx="34"
        fill="url(#bg)"
    />

    <rect
        width="1000"
        height="1000"
        rx="34"
        fill="url(#dots)"
    />

    <rect
        x="17"
        y="17"
        width="966"
        height="966"
        rx="28"
        fill="none"
        stroke="#272c35"
        stroke-width="2"
    />

    <path
        d="M70 18 H310"
        stroke="url(#gold)"
        stroke-width="3"
    />

    <path
        d="M690 982 H930"
        stroke="url(#gold)"
        stroke-width="3"
    />

    <!-- AVATAR -->

    <circle
        cx="500"
        cy="205"
        r="164"
        fill="#000000"
        opacity="0.65"
        filter="url(#shadow)"
    />

    <circle
        cx="500"
        cy="205"
        r="158"
        fill="#090b0f"
        stroke="url(#gold)"
        stroke-width="5"
    />

    ${
        avatarData
            ? `
                <g clip-path="url(#avatarClip)">
                    <image
                        href="${avatarData}"
                        x="358"
                        y="63"
                        width="284"
                        height="284"
                        preserveAspectRatio="xMidYMid slice"
                    />
                </g>
            `
            : `
                <circle
                    cx="500"
                    cy="205"
                    r="142"
                    fill="#171a20"
                />
            `
    }

    <circle
        cx="500"
        cy="205"
        r="142"
        fill="none"
        stroke="#ffffff"
        stroke-opacity="0.10"
        stroke-width="2"
    />

    <!-- CROWN -->

    <path
        d="M447 54 L463 29 L500 51 L537 29 L553 54 L544 74 H456 Z"
        fill="url(#gold)"
    />

    <circle cx="463" cy="29" r="5" fill="#ffe39a"/>
    <circle cx="500" cy="51" r="5" fill="#ffe39a"/>
    <circle cx="537" cy="29" r="5" fill="#ffe39a"/>

    <!-- ONLINE -->

    <circle
        cx="614"
        cy="318"
        r="22"
        fill="#090b0f"
        stroke="#050608"
        stroke-width="5"
    />

    <circle
        cx="614"
        cy="318"
        r="13"
        fill="#d5a536"
    />

    <!-- USERNAME -->

    <text
        x="500"
        y="415"
        text-anchor="middle"
        fill="#ffffff"
        font-size="48"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${escapeXML(user.username)}
    </text>

    <path
        d="M255 442 H420 M580 442 H745"
        stroke="url(#gold)"
        stroke-width="2"
    />

    <circle
        cx="500"
        cy="442"
        r="4"
        fill="#e3b84d"
    />

    <!-- VOICE CARD -->

    <rect
        x="70"
        y="490"
        width="860"
        height="165"
        rx="25"
        fill="#090b0f"
        stroke="#3a414d"
        stroke-width="2"
        filter="url(#shadow)"
    />

    <rect
        x="70"
        y="490"
        width="860"
        height="4"
        rx="2"
        fill="url(#gold)"
    />

    <!-- Voice level -->

    <rect
        x="95"
        y="523"
        width="105"
        height="62"
        rx="15"
        fill="#11151c"
        stroke="#a87c21"
        stroke-width="2"
    />

    <text
        x="147"
        y="562"
        text-anchor="middle"
        fill="#f4d171"
        font-size="23"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        Lv.${voiceLevel.level}
    </text>

    <!-- Voice progress -->

    <rect
        x="220"
        y="523"
        width="500"
        height="62"
        rx="31"
        fill="#202832"
        stroke="#555c67"
        stroke-width="2"
    />

    <rect
        x="222"
        y="525"
        width="${voiceWidth}"
        height="58"
        rx="29"
        fill="url(#voiceBar)"
    />

    <rect
        x="222"
        y="525"
        width="${voiceWidth}"
        height="10"
        rx="5"
        fill="#ffffff"
        opacity="0.12"
    />

    <text
        x="470"
        y="562"
        text-anchor="middle"
        fill="#ffffff"
        font-size="21"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${voiceLevel.currentXP.toLocaleString('en-US')} / ${voiceLevel.nextXP.toLocaleString('en-US')}
    </text>

    <text
        x="890"
        y="562"
        text-anchor="end"
        fill="#ffffff"
        font-size="14"
        font-family="Arial, sans-serif"
        opacity="0.75"
    >
        ${voiceLevel.percent}%
    </text>

    <!-- MICROPHONE -->

    <circle
        cx="825"
        cy="554"
        r="49"
        fill="#0b0f15"
        stroke="url(#gold)"
        stroke-width="3"
    />

    <rect
        x="814"
        y="527"
        width="22"
        height="38"
        rx="11"
        fill="none"
        stroke="#f0c95f"
        stroke-width="5"
    />

    <path
        d="M802 550 C802 572 815 584 825 584 C835 584 848 572 848 550"
        fill="none"
        stroke="#f0c95f"
        stroke-width="5"
        stroke-linecap="round"
    />

    <path
        d="M825 584 V596 M812 598 H838"
        stroke="#f0c95f"
        stroke-width="5"
        stroke-linecap="round"
    />

    <text
        x="780"
        y="627"
        text-anchor="end"
        fill="#f0c95f"
        font-size="20"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ترتيب الصوتي
    </text>

    <text
        x="110"
        y="627"
        fill="#c0c5cd"
        font-size="17"
        font-family="Arial, sans-serif"
    >
        إجمالي النقاط: ${Number(userData.voiceXP || 0).toLocaleString('en-US')}
    </text>

    <!-- TEXT CARD -->

    <rect
        x="70"
        y="690"
        width="860"
        height="165"
        rx="25"
        fill="#090b0f"
        stroke="#3a414d"
        stroke-width="2"
        filter="url(#shadow)"
    />

    <rect
        x="70"
        y="690"
        width="860"
        height="4"
        rx="2"
        fill="url(#gold)"
    />

    <!-- Text level -->

    <rect
        x="95"
        y="723"
        width="105"
        height="62"
        rx="15"
        fill="#11151c"
        stroke="#a87c21"
        stroke-width="2"
    />

    <text
        x="147"
        y="762"
        text-anchor="middle"
        fill="#f4d171"
        font-size="23"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        Lv.${textLevel.level}
    </text>

    <!-- Text progress -->

    <rect
        x="220"
        y="723"
        width="500"
        height="62"
        rx="31"
        fill="#202832"
        stroke="#555c67"
        stroke-width="2"
    />

    <rect
        x="222"
        y="725"
        width="${textWidth}"
        height="58"
        rx="29"
        fill="url(#textBar)"
    />

    <rect
        x="222"
        y="725"
        width="${textWidth}"
        height="10"
        rx="5"
        fill="#ffffff"
        opacity="0.12"
    />

    <text
        x="470"
        y="762"
        text-anchor="middle"
        fill="#ffffff"
        font-size="21"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ${textLevel.currentXP.toLocaleString('en-US')} / ${textLevel.nextXP.toLocaleString('en-US')}
    </text>

    <text
        x="890"
        y="762"
        text-anchor="end"
        fill="#ffffff"
        font-size="14"
        font-family="Arial, sans-serif"
        opacity="0.75"
    >
        ${textLevel.percent}%
    </text>

    <!-- CHAT -->

    <circle
        cx="825"
        cy="754"
        r="49"
        fill="#0b0f15"
        stroke="url(#gold)"
        stroke-width="3"
    />

    <path
        d="M798 743
           C798 730 809 721 825 721
           H838
           C854 721 865 730 865 743
           V756
           C865 769 854 778 838 778
           H823
           L811 789
           V778
           C803 774 798 766 798 756 Z"
        fill="none"
        stroke="#f0c95f"
        stroke-width="5"
        stroke-linejoin="round"
    />

    <circle cx="814" cy="749" r="4" fill="#f0c95f"/>
    <circle cx="825" cy="749" r="4" fill="#f0c95f"/>
    <circle cx="836" cy="749" r="4" fill="#f0c95f"/>

    <text
        x="780"
        y="827"
        text-anchor="end"
        fill="#f0c95f"
        font-size="20"
        font-family="Arial, sans-serif"
        font-weight="700"
    >
        ترتيب الكتابي
    </text>

    <text
        x="110"
        y="827"
        fill="#c0c5cd"
        font-size="17"
        font-family="Arial, sans-serif"
    >
        إجمالي النقاط: ${Number(userData.textXP || 0).toLocaleString('en-US')}
    </text>

    <!-- FOOTER -->

    <path
        d="M270 914 H730"
        stroke="#292e36"
        stroke-width="2"
    />

    <circle
        cx="500"
        cy="914"
        r="34"
        fill="#090b0f"
        stroke="url(#gold)"
        stroke-width="3"
    />

    <path
        d="M478 914 L488 893 L500 904 L512 893 L522 914 L518 925 H482 Z"
        fill="url(#gold)"
    />

    <text
        x="500"
        y="965"
        text-anchor="middle"
        fill="#707883"
        font-size="14"
        font-family="Arial, sans-serif"
        letter-spacing="4"
    >
        OPS SYSTEM
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
