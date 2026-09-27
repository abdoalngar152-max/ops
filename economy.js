import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    SlashCommandBuilder,
    REST,
    Routes
} from 'discord.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = String(process.env.DISCORD_TOKEN || '').trim();

const PREMIUM_ROLE_ID = '1544858160982917261';
const MASS_SUMMON_ROLE_ID = '1546263383526088805';

const DB_FILE = path.join(__dirname, 'economy.json');
const DB_BACKUP_FILE = path.join(__dirname, 'economy.backup.json');
const DB_TEMP_FILE = path.join(__dirname, 'economy.tmp.json');

const DEFAULT_CURRENCY_NAME = '𝐎𝐏𝐬';

if (!TOKEN) {
    console.error('❌ DISCORD_TOKEN غير موجود في .env أو Railway Variables.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

function emptyDB() {
    return {
        version: 2,
        guilds: {}
    };
}

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            if (fs.existsSync(DB_BACKUP_FILE)) {
                fs.copyFileSync(DB_BACKUP_FILE, DB_FILE);
            } else {
                fs.writeFileSync(
                    DB_FILE,
                    JSON.stringify(emptyDB(), null, 2),
                    'utf8'
                );
            }
        }

        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const data = JSON.parse(raw);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Invalid database');
        }

        if (!data.guilds || typeof data.guilds !== 'object' || Array.isArray(data.guilds)) {
            data.guilds = {};
        }

        data.version = 2;
        return data;
    } catch (error) {
        console.error('❌ تعذر تحميل قاعدة البيانات:', error);

        try {
            if (fs.existsSync(DB_BACKUP_FILE)) {
                const backup = JSON.parse(
                    fs.readFileSync(DB_BACKUP_FILE, 'utf8')
                );

                if (backup && typeof backup === 'object') {
                    if (!backup.guilds || typeof backup.guilds !== 'object') {
                        backup.guilds = {};
                    }

                    backup.version = 2;
                    return backup;
                }
            }
        } catch (backupError) {
            console.error('❌ تعذر تحميل النسخة الاحتياطية:', backupError);
        }

        return emptyDB();
    }
}

function saveDB(data) {
    data.version = 2;

    if (!data.guilds || typeof data.guilds !== 'object') {
        data.guilds = {};
    }

    const json = JSON.stringify(data, null, 2);

    try {
        fs.writeFileSync(DB_TEMP_FILE, json, 'utf8');

        if (fs.existsSync(DB_FILE)) {
            fs.copyFileSync(DB_FILE, DB_BACKUP_FILE);
        }

        fs.renameSync(DB_TEMP_FILE, DB_FILE);
    } catch (error) {
        console.error('❌ فشل حفظ قاعدة البيانات:', error);

        try {
            if (fs.existsSync(DB_TEMP_FILE)) {
                fs.unlinkSync(DB_TEMP_FILE);
            }
        } catch {}

        try {
            if (!fs.existsSync(DB_FILE) && fs.existsSync(DB_BACKUP_FILE)) {
                fs.copyFileSync(DB_BACKUP_FILE, DB_FILE);
            }
        } catch {}
    }
}

function ensureGuild(db, guildId) {
    if (!db.guilds[guildId] || typeof db.guilds[guildId] !== 'object') {
        db.guilds[guildId] = {
            economyChannelId: null,
            users: {}
        };
    }

    const guildData = db.guilds[guildId];

    if (!Object.prototype.hasOwnProperty.call(guildData, 'economyChannelId')) {
        guildData.economyChannelId = null;
    }

    if (!guildData.users || typeof guildData.users !== 'object' || Array.isArray(guildData.users)) {
        guildData.users = {};
    }

    return guildData;
}

function ensureUser(db, guildId, userId) {
    const guildData = ensureGuild(db, guildId);

    if (!guildData.users[userId] || typeof guildData.users[userId] !== 'object') {
        guildData.users[userId] = {
            balance: 0,
            lastDaily: 0
        };
    }

    if (typeof guildData.users[userId].balance !== 'number') {
        guildData.users[userId].balance =
            Number(guildData.users[userId].balance) || 0;
    }

    if (typeof guildData.users[userId].lastDaily !== 'number') {
        guildData.users[userId].lastDaily =
            Number(guildData.users[userId].lastDaily) || 0;
    }

    return guildData.users[userId];
}

function getUser(db, guildId, userId) {
    return ensureUser(db, guildId, userId);
}

function parseAmount(value) {
    if (!value) return NaN;

    const text = String(value)
        .trim()
        .toLowerCase()
        .replace(/,/g, '');

    const match = text.match(/^(\d+(?:\.\d+)?)([kmbt])?$/);

    if (!match) return NaN;

    const number = Number(match[1]);
    const suffix = match[2] || '';

    const multipliers = {
        k: 1000,
        m: 1000000,
        b: 1000000000,
        t: 1000000000000
    };

    const amount = number * (multipliers[suffix] || 1);

    if (!Number.isFinite(amount)) return NaN;

    return Math.floor(amount);
}

function formatAmount(amount) {
    amount = Number(amount) || 0;

    if (amount < 1000) return String(amount);

    const units = [
        { value: 1000000000000, suffix: 't' },
        { value: 1000000000, suffix: 'b' },
        { value: 1000000, suffix: 'm' },
        { value: 1000, suffix: 'k' }
    ];

    for (const unit of units) {
        if (amount >= unit.value) {
            const result = amount / unit.value;

            if (Number.isInteger(result)) {
                return `${result}${unit.suffix}`;
            }

            return `${Number(result.toFixed(2))}${unit.suffix}`;
        }
    }

    return String(amount);
}

function isEconomyChannel(message) {
    if (!message.guild) return false;

    const db = loadDB();
    const guildData = ensureGuild(db, message.guild.id);

    return Boolean(
        guildData.economyChannelId &&
        guildData.economyChannelId === message.channel.id
    );
}

function isAdmin(member) {
    return Boolean(
        member &&
        member.permissions.has(PermissionFlagsBits.Administrator)
    );
}

const pendingTransfers = new Map();
const pendingRewards = new Map();

function transferKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function cleanupPendingForGuild(guildId) {
    for (const [key, value] of pendingTransfers.entries()) {
        if (value.guildId === guildId) {
            pendingTransfers.delete(key);
        }
    }

    for (const [key, value] of pendingRewards.entries()) {
        if (value.guildId === guildId) {
            pendingRewards.delete(key);
        }
    }
}

/* =========================================================
   SLASH COMMANDS
   فقط /currency enable
   و /currency disable
========================================================= */

const slashCommands = [
    new SlashCommandBuilder()
        .setName('currency')
        .setDescription('تفعيل أو تعطيل نظام العملة')
        .addSubcommand(sub =>
            sub
                .setName('enable')
                .setDescription('تفعيل العملة في الروم الحالي')
        )
        .addSubcommand(sub =>
            sub
                .setName('disable')
                .setDescription('تعطيل العملة في السيرفر')
        )
];

async function registerSlashCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);

        /*
        حذف جميع أوامر السلاش القديمة Global
        */

        await rest.put(
            Routes.applicationCommands(client.user.id),
            {
                body: []
            }
        );

        /*
        حذف جميع أوامر السلاش القديمة من كل السيرفرات
        */

        for (const guild of client.guilds.cache.values()) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(
                        client.user.id,
                        guild.id
                    ),
                    {
                        body: []
                    }
                );
            } catch (error) {
                console.error(
                    `❌ تعذر حذف أوامر السلاش القديمة من السيرفر ${guild.id}:`,
                    error
                );
            }
        }

        /*
        تسجيل /currency فقط
        */

        await rest.put(
            Routes.applicationCommands(client.user.id),
            {
                body: slashCommands.map(command =>
                    command.toJSON()
                )
            }
        );

        console.log(
            '✅ تم حذف أوامر السلاش القديمة وتسجيل /currency فقط.'
        );

    } catch (error) {
        console.error(
            '❌ فشل تسجيل أوامر السلاش:',
            error
        );
    }
}

client.once('ready', async () => {
    console.log('======================================');
    console.log(`✅ البوت اشتغل: ${client.user.tag}`);
    console.log('======================================');

    const db = loadDB();

    for (const guild of client.guilds.cache.values()) {
        ensureGuild(db, guild.id);
    }

    saveDB(db);

    await registerSlashCommands();

    const statuses = [
        'نظام العملات',
        'افضل بوت عملات',
        'سبحان الله وبحمده',
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
            (index + 1) %
            statuses.length;
    };

    updatePresence();

    setInterval(
        updatePresence,
        1000
    );
});

client.on('guildCreate', guild => {
    try {
        const db = loadDB();

        ensureGuild(
            db,
            guild.id
        );

        saveDB(db);

        console.log(
            `💾 تم إنشاء بيانات اقتصاد منفصلة للسيرفر: ${guild.id}`
        );
    } catch (error) {
        console.error(
            '❌ خطأ في إنشاء بيانات السيرفر:',
            error
        );
    }
});

client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const content =
            message.content.trim();

        if (
            message.guild &&
            content.startsWith('استدعاء')
        ) {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.Administrator
                )
            ) {
                return;
            }

            const targetUser =
                message.mentions.users.first();

            if (!targetUser) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ الاستخدام الصحيح:\n`استدعاء @العضو`'
                            )
                    ]
                });
            }

            const targetMember =
                await message.guild.members
                    .fetch(targetUser.id)
                    .catch(() => null);

            if (!targetMember) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ العضو غير موجود في السيرفر.'
                            )
                    ]
                });
            }

            if (targetMember.user.bot) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ لا يمكنك استدعاء بوت.'
                            )
                    ]
                });
            }

            const embed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle('📢 نظام الاستدعاء')
                    .setDescription(
                        `اضغط على الزر أدناه لإرسال استدعاء إلى ${targetMember}.`
                    )
                    .setFooter({
                        text: message.guild.name
                    });

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                `summon_open_${message.author.id}_${targetMember.id}`
                            )
                            .setLabel('استدعاء العضو')
                            .setEmoji('📢')
                            .setStyle(ButtonStyle.Secondary)
                    );

            return message.channel.send({
                embeds: [embed],
                components: [row]
            });
        }

        if (
            message.guild &&
            content === 'شعار تسليم'
        ) {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.Administrator
                )
            ) {
                return;
            }

            return message.channel.send({
                content:
                    '📨 اضغط على الزر أدناه لإكمال شعار التسليم.',
                components: [
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `delivery_open_${message.author.id}`
                                )
                                .setLabel('شعار تسليم')
                                .setEmoji('📨')
                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                        )
                ]
            });
        }

        if (
            message.guild &&
            (
                content === 'شعار كل' ||
                content.toLowerCase() === 'شعار all' ||
                content === 'شعار كامل'
            )
        ) {
            if (
                !message.member.roles.cache.has(
                    MASS_SUMMON_ROLE_ID
                )
            ) {
                return;
            }

            const embed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle('📩 إشعار استدعاء')
                    .setDescription(
                        'اضغط على الزر أدناه لإرسال إشعار استدعاء إلى جميع أعضاء السيرفر.'
                    )
                    .setTimestamp();

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                `mass_summon_open_${message.author.id}_${message.guild.id}`
                            )
                            .setLabel('إشعار استدعاء')
                            .setEmoji('📩')
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );

            return message.channel.send({
                embeds: [embed],
                components: [row]
            });
        }

        if (!message.guild) return;

        const db = loadDB();

        const guildData =
            ensureGuild(
                db,
                message.guild.id
            );

        /* =========================================================
           تفعيل روم
        ========================================================= */

        if (content === 'تفعيل روم') {
            if (!isAdmin(message.member)) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ هذا الأمر مخصص للإداريين فقط.'
                            )
                    ]
                });
            }

            guildData.economyChannelId =
                message.channel.id;

            saveDB(db);

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setDescription(
                            `✅ تم تفعيل نظام العملة في <#${message.channel.id}>.\n\n💾 سيتم حفظ التفعيل حتى بعد إعادة تشغيل البوت.`
                        )
                ]
            });
        }

        /* =========================================================
           تعطيل روم
        ========================================================= */

        if (content === 'تعطيل روم') {
            if (!isAdmin(message.member)) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ هذا الأمر مخصص للإداريين فقط.'
                            )
                    ]
                });
            }

            guildData.economyChannelId = null;

            cleanupPendingForGuild(
                message.guild.id
            );

            saveDB(db);

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setDescription(
                            '✅ تم تعطيل نظام العملة في هذا السيرفر.'
                        )
                ]
            });
        }

        if (
            !guildData.economyChannelId ||
            guildData.economyChannelId !== message.channel.id
        ) {
            return;
        }

        const userId =
            message.author.id;

        const user =
            getUser(
                db,
                message.guild.id,
                userId
            );

        /* =========================================================
           مكافأة
        ========================================================= */

        if (
            content === 'مكافاة' ||
            content === 'مكافأة'
        ) {
            const accountAge =
                Date.now() -
                message.author.createdTimestamp;

            const fourteenDays =
                14 *
                24 *
                60 *
                60 *
                1000;

            if (accountAge < fourteenDays) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                'لا يمكنك أخذ المكافأة اليومية لأن عمر حسابك أقل من 14 يومًا.'
                            )
                    ]
                });
            }

            const now =
                Date.now();

            const cooldown =
                24 *
                60 *
                60 *
                1000;

            if (
                now -
                    user.lastDaily <
                cooldown
            ) {
                const remaining =
                    cooldown -
                    (
                        now -
                        user.lastDaily
                    );

                const hours =
                    Math.floor(
                        remaining /
                        (
                            60 *
                            60 *
                            1000
                        )
                    );

                const minutes =
                    Math.floor(
                        (
                            remaining %
                            (
                                60 *
                                60 *
                                1000
                            )
                        ) /
                        (
                            60 *
                            1000
                        )
                    );

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                `⏳ لقد استلمت مكافأتك مسبقاً. يمكنك الاستلام بعد **${hours} ساعة و ${minutes} دقيقة**.`
                            )
                    ]
                });
            }

            const isPremium =
                message.member.roles.cache.has(
                    PREMIUM_ROLE_ID
                );

            const randomAmount =
                isPremium
                    ? Math.floor(
                        Math.random() * 2001
                    ) + 3000
                    : Math.floor(
                        Math.random() * 301
                    ) + 1700;

            user.balance +=
                randomAmount;

            user.lastDaily =
                now;

            saveDB(db);

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setDescription(
                            isPremium
                                ? `🎁 **مكافأة عضو مميز**\n\nلقد حصلت على **${formatAmount(
                                    randomAmount
                                )} 𝐎𝐏𝐬**`
                                : `🎁 لقد حصلت على **${formatAmount(
                                    randomAmount
                                )} 𝐎𝐏𝐬** coin`
                        )
                ]
            });
        }

        /* =========================================================
           رصيد
        ========================================================= */

        if (
            content.toLowerCase() === '𝐎𝐏𝐬' ||
            content.toLowerCase() === 'ops' ||
            content === 'رصيد' ||
            content.startsWith('رصيد ') ||
            content.toLowerCase().startsWith('𝐎𝐏𝐬 ') ||
            content.toLowerCase().startsWith('ops ')
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
                        .setColor('#D4AC0D')
                        .setDescription(
                            targetMember.id === message.author.id
                                ? `رصيدك الحالي : ${formatAmount(
                                    targetUser.balance
                                )} 𝐎𝐏𝐬`
                                : `رصيد العضو ${targetMember} الحالي : ${formatAmount(
                                    targetUser.balance
                                )} 𝐎𝐏𝐬`
                        )
                ]
            });
        }

        /* =========================================================
           تحويل
        ========================================================= */

        if (content.startsWith('تحويل')) {
            const args =
                content.split(/\s+/);

            const targetMember =
                message.mentions.members.first();

            const argValue =
                args[2]
                    ? args[2].toLowerCase()
                    : '';

            if (!targetMember || !argValue) {
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

            if (targetMember.id === message.author.id) {
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

            let amount = 0;

            const currentBalance =
                Number(user.balance) || 0;

            if (argValue === 'كامل') {
                amount =
                    currentBalance;
            } else if (argValue === 'نص') {
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
                                '❌ يرجى كتابة مبلغ صالح أو كلمة (نص) أو (كامل).\n\nالاختصارات المدعومة: `k` `m` `b` `t`'
                            )
                    ]
                });
            }

            if (currentBalance < amount) {
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
                                `verify_transfer_${userId}_${targetMember.id}_${amount}`
                            )
                            .setLabel('إظهار رمز التحقق')
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );

            const sentMsg =
                await message.channel.send({
                    content:
                        '🔒 يرجى الضغط على الزر أدناه لإظهار رمز التحقق وإرساله في الشات لتأكيد عملية التحويل.',
                    components: [row]
                });

            pendingTransfers.set(
                transferKey(
                    message.guild.id,
                    userId
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

        /* =========================================================
           توب
        ========================================================= */

        if (
            content === 'توب' ||
            content === 'التوب' ||
            content.toLowerCase() === 'top' ||
            /^توب\s+[1-5]$/i.test(content)
        ) {
            let page = 1;

            if (content.startsWith('توب ')) {
                page =
                    parseInt(
                        content.split(/\s+/)[1]
                    );
            }

            if (page < 1 || page > 5) {
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
                            Number(data.balance) > 0
                    )
                    .sort(
                        (a, b) =>
                            Number(b[1].balance) -
                            Number(a[1].balance)
                    );

            const start =
                (page - 1) * 10;

            const pageUsers =
                sortedUsers.slice(
                    start,
                    start + 10
                );

            let description = '';

            pageUsers.forEach(
                (
                    [uId, data],
                    index
                ) => {
                    description +=
                        `#${start + index + 1} <@${uId}> — **${formatAmount(
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

        /* =========================================================
           معلومات
        ========================================================= */

        if (
            content === 'معلومات' ||
            content === 'المعلومات'
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

            let lastTimeText =
                'لم يستلم أبداً';

            let nextTimeText =
                'متاح الآن';

            if (targetUser.lastDaily > 0) {
                const lastDate =
                    new Date(
                        targetUser.lastDaily
                    );

                lastTimeText =
                    lastDate.toLocaleString();

                const nextTime =
                    targetUser.lastDaily +
                    24 *
                    60 *
                    60 *
                    1000;

                if (Date.now() < nextTime) {
                    const diff =
                        nextTime -
                        Date.now();

                    const h =
                        Math.floor(
                            diff /
                            (
                                60 *
                                60 *
                                1000
                            )
                        );

                    const m =
                        Math.floor(
                            (
                                diff %
                                (
                                    60 *
                                    60 *
                                    1000
                                )
                            ) /
                            (
                                60 *
                                1000
                            )
                        );

                    nextTimeText =
                        `${h} ساعة و ${m} دقيقة`;
                }
            }

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle('معلومات حسابك')
                        .addFields(
                            {
                                name: 'العضو',
                                value: `${targetMember}`
                            },
                            {
                                name: 'رصيدك',
                                value:
                                    `𝐎𝐏𝐬 ${formatAmount(
                                        targetUser.balance
                                    )}`
                            },
                            {
                                name:
                                    'آخر مكافأة حصلت عليها',
                                value:
                                    lastTimeText
                            },
                            {
                                name:
                                    'موعد المكافأة القادمة',
                                value:
                                    nextTimeText
                            }
                        )
                ]
            });
        }

        /* =========================================================
           اعطي
        ========================================================= */

        if (content.startsWith('اعطي')) {
            if (!isAdmin(message.member)) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ هذا الأمر مخصص للإداريين فقط.'
                            )
                    ]
                });
            }

            const args =
                content.split(/\s+/);

            const targetMember =
                message.mentions.members.first();

            const amount =
                parseAmount(args[2]);

            if (
                !targetMember ||
                isNaN(amount) ||
                amount <= 0
            ) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ الاستخدام الصحيح: `اعطي @العضو المبلغ`\nمثال: `اعطي @العضو 20k`'
                            )
                    ]
                });
            }

            const targetUser =
                getUser(
                    db,
                    message.guild.id,
                    targetMember.id
                );

            targetUser.balance +=
                amount;

            saveDB(db);

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setDescription(
                            `✅ تم إضافة **${formatAmount(
                                amount
                            )} 𝐎𝐏𝐬** إلى رصيد العضو ${targetMember}`
                        )
                ]
            });
        }

        /* =========================================================
           سحب
        ========================================================= */

        if (content.startsWith('سحب')) {
            if (!isAdmin(message.member)) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ هذا الأمر مخصص للإداريين فقط.'
                            )
                    ]
                });
            }

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
                                '❌ الاستخدام الصحيح: `سحب @العضو المبلغ` أو `سحب @العضو نص` أو `سحب @العضو كامل`'
                            )
                    ]
                });
            }

            const targetUser =
                getUser(
                    db,
                    message.guild.id,
                    targetMember.id
                );

            const balance =
                Number(targetUser.balance) || 0;

            let amount = 0;

            if (argValue === 'كامل') {
                amount =
                    balance;
            } else if (argValue === 'نص') {
                amount =
                    Math.floor(
                        balance / 2
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
                                '❌ يرجى كتابة مبلغ صالح أو كلمة (نص) أو (كامل).\n\nالاختصارات المدعومة: `k` `m` `b` `t`'
                            )
                    ]
                });
            }

            targetUser.balance =
                Math.max(
                    0,
                    balance - amount
                );

            saveDB(db);

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setDescription(
                            `✅ تم سحب **${formatAmount(
                                amount
                            )} 𝐎𝐏𝐬** من رصيد العضو ${targetMember}`
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
});

client.on('interactionCreate', async interaction => {
    try {

        /* =========================================================
           SLASH
           فقط /currency
        ========================================================= */

        if (interaction.isChatInputCommand()) {
            const db =
                loadDB();

            if (!interaction.guild) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر يعمل داخل السيرفر فقط.',
                    ephemeral: true
                });
            }

            const guildId =
                interaction.guild.id;

            const guildData =
                ensureGuild(
                    db,
                    guildId
                );

            if (interaction.commandName !== 'currency') {
                return;
            }

            if (!isAdmin(interaction.member)) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر مخصص للإداريين فقط.',
                    ephemeral: true
                });
            }

            const subcommand =
                interaction.options.getSubcommand();

            if (subcommand === 'enable') {
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

            if (subcommand === 'disable') {
                guildData.economyChannelId =
                    null;

                cleanupPendingForGuild(
                    guildId
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

        if (
            interaction.isButton() &&
            interaction.customId.startsWith('delivery_open_')
        ) {
            const adminId =
                interaction.customId.split('_')[2];

            if (interaction.user.id !== adminId) {
                return interaction.reply({
                    content:
                        '❌ هذا الزر ليس مخصصاً لك.',
                    ephemeral: true
                });
            }

            if (!isAdmin(interaction.member)) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر مخصص للإداريين فقط.',
                    ephemeral: true
                });
            }

            const modal =
                new ModalBuilder()
                    .setCustomId(
                        `delivery_modal_${adminId}`
                    )
                    .setTitle('📨 شعار تسليم');

            const memberInput =
                new TextInputBuilder()
                    .setCustomId(
                        'delivery_member_id'
                    )
                    .setLabel('ايدي العضو')
                    .setPlaceholder(
                        'اكتب ايدي العضو هنا...'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
                    .setMaxLength(25);

            const amountInput =
                new TextInputBuilder()
                    .setCustomId(
                        'delivery_amount'
                    )
                    .setLabel('المبلغ')
                    .setPlaceholder(
                        'مثال: 20k أو 2m'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
                    .setMaxLength(30);

            const reasonInput =
                new TextInputBuilder()
                    .setCustomId(
                        'delivery_reason'
                    )
                    .setLabel('السبب')
                    .setPlaceholder(
                        'اكتب سبب التسليم هنا...'
                    )
                    .setStyle(
                        TextInputStyle.Paragraph
                    )
                    .setRequired(true)
                    .setMaxLength(1000);

            modal.addComponents(
                new ActionRowBuilder()
                    .addComponents(memberInput),
                new ActionRowBuilder()
                    .addComponents(amountInput),
                new ActionRowBuilder()
                    .addComponents(reasonInput)
            );

            return interaction.showModal(modal);
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId.startsWith('delivery_modal_')
        ) {
            const adminId =
                interaction.customId.split('_')[2];

            if (interaction.user.id !== adminId) {
                return interaction.reply({
                    content:
                        '❌ هذا الطلب ليس مخصصاً لك.',
                    ephemeral: true
                });
            }

            if (!isAdmin(interaction.member)) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر مخصص للإداريين فقط.',
                    ephemeral: true
                });
            }

            const memberId =
                interaction.fields
                    .getTextInputValue(
                        'delivery_member_id'
                    )
                    .trim();

            const amountText =
                interaction.fields
                    .getTextInputValue(
                        'delivery_amount'
                    )
                    .trim();

            const reason =
                interaction.fields
                    .getTextInputValue(
                        'delivery_reason'
                    )
                    .trim();

            if (!/^\d{17,20}$/.test(memberId)) {
                return interaction.reply({
                    content:
                        '❌ ايدي العضو غير صحيح.',
                    ephemeral: true
                });
            }

            const amount =
                parseAmount(amountText);

            if (
                isNaN(amount) ||
                amount <= 0
            ) {
                return interaction.reply({
                    content:
                        '❌ المبلغ غير صحيح.',
                    ephemeral: true
                });
            }

            const targetMember =
                await interaction.guild.members
                    .fetch(memberId)
                    .catch(() => null);

            if (!targetMember) {
                return interaction.reply({
                    content:
                        '❌ العضو غير موجود في السيرفر.',
                    ephemeral: true
                });
            }

            const rewardId =
                `${interaction.guild.id}_${interaction.user.id}_${targetMember.id}_${Date.now()}_${Math.floor(
                    Math.random() * 100000
                )}`;

            pendingRewards.set(
                rewardId,
                {
                    targetId:
                        targetMember.id,
                    amount,
                    reason,
                    guildId:
                        interaction.guild.id
                }
            );

            const rewardEmbed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle(
                        '📨 إشعار استلام مكافأة'
                    )
                    .addFields(
                        {
                            name: 'المبلغ',
                            value:
                                `**${formatAmount(
                                    amount
                                )} 𝐎𝐏𝐬**`
                        },
                        {
                            name: 'السبب',
                            value: reason
                        }
                    )
                    .setTimestamp();

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                `reward_receive_${rewardId}`
                            )
                            .setLabel(
                                'استلام المكافأة'
                            )
                            .setEmoji('📩')
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );

            try {
                await targetMember.send({
                    embeds: [rewardEmbed],
                    components: [row]
                });

                return interaction.reply({
                    content:
                        `✅ تم إرسال شعار التسليم إلى ${targetMember}.`,
                    ephemeral: true
                });
            } catch {
                pendingRewards.delete(
                    rewardId
                );

                return interaction.reply({
                    content:
                        '❌ تعذر إرسال شعار التسليم في الخاص للعضو.',
                    ephemeral: true
                });
            }
        }

        if (
            interaction.isButton() &&
            (
                interaction.customId.startsWith(
                    'request_status_delivered_'
                ) ||
                interaction.customId.startsWith(
                    'request_status_not_delivered_'
                )
            )
        ) {
            return interaction.reply({
                content:
                    '❌ نظام الطلبات تم إزالته.',
                ephemeral: true
            });
        }

        if (
            interaction.isButton() &&
            interaction.customId.startsWith('reward_receive_')
        ) {
            const rewardId =
                interaction.customId.replace(
                    'reward_receive_',
                    ''
                );

            const reward =
                pendingRewards.get(
                    rewardId
                );

            if (!reward) {
                return interaction.reply({
                    content:
                        '❌ إشعار المكافأة انتهى أو تم استلامه مسبقاً.',
                    ephemeral: true
                });
            }

            if (
                interaction.user.id !==
                reward.targetId
            ) {
                return interaction.reply({
                    content:
                        '❌ هذا الإشعار ليس مخصصاً لك.',
                    ephemeral: true
                });
            }

            const db =
                loadDB();

            const user =
                getUser(
                    db,
                    reward.guildId,
                    reward.targetId
                );

            user.balance +=
                reward.amount;

            saveDB(db);

            pendingRewards.delete(
                rewardId
            );

            const receivedEmbed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle(
                        '📨 تم استلام المكافأة'
                    )
                    .setDescription(
                        `تمت إضافة **${formatAmount(
                            reward.amount
                        )} 𝐎𝐏𝐬** إلى رصيدك بنجاح.\n\n**السبب :** ${reward.reason}\n**رصيدك الحالي :** ${formatAmount(
                            user.balance
                        )} 𝐎𝐏𝐬`
                    )
                    .setTimestamp();

            return interaction.update({
                embeds: [receivedEmbed],
                components: [
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `reward_received_${rewardId}`
                                )
                                .setLabel(
                                    'تم استلام المكافأة'
                                )
                                .setEmoji('✅')
                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                                .setDisabled(true)
                        )
                ]
            });
        }

        if (
            interaction.isButton() &&
            interaction.customId.startsWith('summon_open_')
        ) {
            const parts =
                interaction.customId.split('_');

            const adminId =
                parts[2];

            const targetId =
                parts[3];

            if (interaction.user.id !== adminId) {
                return interaction.reply({
                    content:
                        '❌ هذا الزر ليس مخصصاً لك.',
                    ephemeral: true
                });
            }

            if (!isAdmin(interaction.member)) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر مخصص للإداريين فقط.',
                    ephemeral: true
                });
            }

            const modal =
                new ModalBuilder()
                    .setCustomId(
                        `summon_modal_${adminId}_${targetId}`
                    )
                    .setTitle('📩 إشعار استدعاء');

            const destinationInput =
                new TextInputBuilder()
                    .setCustomId(
                        'summon_destination'
                    )
                    .setLabel('التوجه')
                    .setPlaceholder(
                        'اكتب ايدي الروم أو لينك الروم هنا...'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
                    .setMaxLength(200);

            const reasonInput =
                new TextInputBuilder()
                    .setCustomId(
                        'summon_reason'
                    )
                    .setLabel('السبب')
                    .setPlaceholder(
                        'اكتب سبب الاستدعاء هنا...'
                    )
                    .setStyle(
                        TextInputStyle.Paragraph
                    )
                    .setRequired(true)
                    .setMaxLength(1000);

            modal.addComponents(
                new ActionRowBuilder()
                    .addComponents(destinationInput),
                new ActionRowBuilder()
                    .addComponents(reasonInput)
            );

            return interaction.showModal(modal);
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId.startsWith('summon_modal_')
        ) {
            const parts =
                interaction.customId.split('_');

            const adminId =
                parts[2];

            const targetId =
                parts[3];

            if (interaction.user.id !== adminId) {
                return interaction.reply({
                    content:
                        '❌ هذا الاستدعاء ليس مخصصاً لك.',
                    ephemeral: true
                });
            }

            if (!isAdmin(interaction.member)) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر مخصص للإداريين فقط.',
                    ephemeral: true
                });
            }

            const destination =
                interaction.fields
                    .getTextInputValue(
                        'summon_destination'
                    )
                    .trim();

            const reason =
                interaction.fields
                    .getTextInputValue(
                        'summon_reason'
                    )
                    .trim();

            const validChannelId =
                /^\d{17,20}$/.test(
                    destination
                );

            const validChannelLink =
                /^https?:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/\d+\/\d+(?:\/\d+)?$/i.test(
                    destination
                );

            if (
                !validChannelId &&
                !validChannelLink
            ) {
                return interaction.reply({
                    content:
                        '❌ التوجه يجب أن يكون ايدي روم صحيح أو لينك روم صحيح.',
                    ephemeral: true
                });
            }

            const targetMember =
                await interaction.guild.members
                    .fetch(targetId)
                    .catch(() => null);

            if (!targetMember) {
                return interaction.reply({
                    content:
                        '❌ العضو غير موجود في السيرفر.',
                    ephemeral: true
                });
            }

            let destinationText =
                destination;

            if (validChannelId) {
                destinationText =
                    `<#${destination}>`;
            }

            const summonEmbed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle(
                        '📩 إشعار استدعاء'
                    )
                    .addFields(
                        {
                            name: '🌐 السيرفر',
                            value:
                                `**${interaction.guild.name}**`
                        },
                        {
                            name: '📍 التوجه',
                            value:
                                destinationText
                        },
                        {
                            name: '📌 السبب',
                            value:
                                reason
                        }
                    )
                    .setFooter({
                        text:
                            'نظام الاستدعاء'
                    })
                    .setTimestamp();

            try {
                await targetMember.send({
                    embeds: [summonEmbed]
                });

                return interaction.reply({
                    content:
                        `✅ تم إرسال إشعار الاستدعاء إلى ${targetMember}.`,
                    ephemeral: true
                });
            } catch {
                return interaction.reply({
                    content:
                        '❌ تعذر إرسال الاستدعاء في الخاص. قد تكون رسائل الخاص مغلقة لدى العضو.',
                    ephemeral: true
                });
            }
        }

        if (
            interaction.isButton() &&
            interaction.customId.startsWith('mass_summon_open_')
        ) {
            const parts =
                interaction.customId.split('_');

            const adminId =
                parts[3];

            if (interaction.user.id !== adminId) {
                return interaction.reply({
                    content:
                        '❌ هذا الزر ليس مخصصاً لك.',
                    ephemeral: true
                });
            }

            if (
                !interaction.member.roles.cache.has(
                    MASS_SUMMON_ROLE_ID
                )
            ) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر ليس متاحاً لك.',
                    ephemeral: true
                });
            }

            const modal =
                new ModalBuilder()
                    .setCustomId(
                        `mass_summon_modal_${interaction.guild.id}`
                    )
                    .setTitle('📩 إشعار استدعاء');

            const destinationInput =
                new TextInputBuilder()
                    .setCustomId(
                        'mass_summon_destination'
                    )
                    .setLabel('التوجه')
                    .setPlaceholder(
                        'اكتب ايدي الروم أو لينك الروم هنا...'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
                    .setMaxLength(200);

            const reasonInput =
                new TextInputBuilder()
                    .setCustomId(
                        'mass_summon_reason'
                    )
                    .setLabel('السبب')
                    .setPlaceholder(
                        'اكتب سبب الاستدعاء هنا...'
                    )
                    .setStyle(
                        TextInputStyle.Paragraph
                    )
                    .setRequired(true)
                    .setMaxLength(1000);

            modal.addComponents(
                new ActionRowBuilder()
                    .addComponents(destinationInput),
                new ActionRowBuilder()
                    .addComponents(reasonInput)
            );

            return interaction.showModal(modal);
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId.startsWith('mass_summon_modal_')
        ) {
            const destination =
                interaction.fields
                    .getTextInputValue(
                        'mass_summon_destination'
                    )
                    .trim();

            const reason =
                interaction.fields
                    .getTextInputValue(
                        'mass_summon_reason'
                    )
                    .trim();

            const validChannelId =
                /^\d{17,20}$/.test(
                    destination
                );

            const validChannelLink =
                /^https?:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/\d+\/\d+(?:\/\d+)?$/i.test(
                    destination
                );

            if (
                !validChannelId &&
                !validChannelLink
            ) {
                return interaction.reply({
                    content:
                        '❌ التوجه يجب أن يكون ايدي روم صحيح أو لينك روم صحيح.',
                    ephemeral: true
                });
            }

            let destinationText =
                destination;

            if (validChannelId) {
                destinationText =
                    `<#${destination}>`;
            }

            const summonEmbed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle(
                        '📩 إشعار استدعاء'
                    )
                    .addFields(
                        {
                            name: '🌐 السيرفر',
                            value:
                                `**${interaction.guild.name}**`
                        },
                        {
                            name: '📍 التوجه',
                            value:
                                destinationText
                        },
                        {
                            name: '📌 السبب',
                            value:
                                reason
                        }
                    )
                    .setTimestamp();

            await interaction.reply({
                content:
                    '📩 جاري إرسال إشعار الاستدعاء لجميع أعضاء السيرفر.',
                ephemeral: true
            });

            const members =
                await interaction.guild.members.fetch();

            for (
                const member
                of members.values()
            ) {
                if (member.user.bot) {
                    continue;
                }

                await member.send({
                    embeds: [summonEmbed]
                }).catch(
                    () => {}
                );
            }

            return;
        }

        if (
            interaction.isButton() &&
            interaction.customId.startsWith('verify_transfer_')
        ) {
            const parts =
                interaction.customId.split('_');

            const senderId =
                parts[2];

            const targetId =
                parts[3];

            const amount =
                parseInt(parts[4]);

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
                pendingTransfers.get(
                    key
                );

            if (!transfer) {
                return interaction.reply({
                    content:
                        '❌ عملية التحويل انتهت أو غير موجودة.',
                    ephemeral: true
                });
            }

            const db =
                loadDB();

            const sender =
                getUser(
                    db,
                    interaction.guild.id,
                    senderId
                );

            getUser(
                db,
                interaction.guild.id,
                targetId
            );

            if (
                sender.balance <
                amount
            ) {
                pendingTransfers.delete(
                    key
                );

                return interaction.reply({
                    content:
                        '❌ لم يعد لديك رصيد كافٍ لإتمام العملية.',
                    ephemeral: true
                });
            }

            let code = '';

            for (
                let i = 0;
                i < 6;
                i++
            ) {
                code += Math.floor(
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
            await interaction.reply({
                content:
                    '❌ حدث خطأ أثناء تنفيذ العملية.',
                ephemeral: true
            }).catch(
                () => {}
            );
        }
    }
});

client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        if (
            !message.guild ||
            !isEconomyChannel(message)
        ) {
            return;
        }

        const content =
            message.content.trim();

        if (
            pendingTransfers.has(
                transferKey(
                    message.guild.id,
                    message.author.id
                )
            )
        ) {
            const key =
                transferKey(
                    message.guild.id,
                    message.author.id
                );

            const transfer =
                pendingTransfers.get(
                    key
                );

            if (
                transfer.code &&
                content === transfer.code
            ) {
                pendingTransfers.delete(
                    key
                );

                await message.delete()
                    .catch(() => {});

                if (transfer.botMsg) {
                    await transfer.botMsg.delete()
                        .catch(() => {});
                }

                const db =
                    loadDB();

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
                        .catch(() => null);

                const receiptEmbed =
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle(
                            'إيصال تحويل'
                        )
                        .addFields(
                            {
                                name: 'المبلغ',
                                value:
                                    `\`\`\`fix\n${formatAmount(
                                        transfer.amount
                                    )} 𝐎𝐏𝐬\n\`\`\``
                            },
                            {
                                name: 'إلى',
                                value:
                                    `\`\`\`ini\n[ ${
                                        targetMember
                                            ? targetMember.user.tag
                                            : transfer.targetId
                                    } ]\n\`\`\``
                            },
                            {
                                name: 'من',
                                value:
                                    `\`\`\`ini\n[ ${message.author.tag} ]\n\`\`\``
                            }
                        )
                        .setTimestamp();

                await message.author.send({
                    embeds: [receiptEmbed]
                }).catch(() => {});

                if (targetMember) {
                    await targetMember.send({
                        embeds: [receiptEmbed]
                    }).catch(() => {});
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
            }
        }
    } catch (error) {
        console.error(
            '❌ Transfer Error:',
            error
        );
    }
});

client.on('error', error => {
    console.error(
        '❌ Discord Client Error:',
        error
    );
});

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

function gracefulSave() {
    try {
        const db =
            loadDB();

        for (
            const guild
            of client.guilds.cache.values()
        ) {
            ensureGuild(
                db,
                guild.id
            );
        }

        saveDB(db);

        console.log(
            '💾 تم حفظ بيانات الاقتصاد.'
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

client.login(TOKEN).catch(
    error => {
        console.error(
            '❌ فشل تسجيل الدخول إلى Discord.'
        );

        console.error(error);

        process.exit(1);
    }
);