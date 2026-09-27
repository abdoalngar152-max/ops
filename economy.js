import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
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

/* =========================================================
   SETTINGS
========================================================= */

const PREMIUM_ROLE_ID = '1544858160982917261';

const TICKET_PANEL_CHANNEL_ID = '1553675643936317520';

const TECHNICAL_SUPPORT_ROLE_ID = '1553740304958488616';

const TECHNICAL_REPORT_ROLE_ID = '1553740470625112134';

const TICKET_IMAGE =
    'https://cdn.discordapp.com/attachments/1553738433506189414/1553738495464448091/2.png?ex=6aba573c&is=6ab905bc&hm=b16510afd66e6422f197af0968c16fc8ecca8e2f855467eaa9daa2973da5864e';

const TICKET_PANEL_IMAGE =
    'https://cdn.discordapp.com/attachments/1553738433506189414/1553741567016177704/image.png?ex=6aba5a18&is=6ab90898&hm=20dac06cb79bf0c79ab439d19a4914b4b7a8e354039913f8d3295921eb457883';

/* =========================================================
   DATABASE
========================================================= */

const DB_FILE = path.join(__dirname, 'economy.json');
const DB_BACKUP_FILE = path.join(__dirname, 'economy.backup.json');
const DB_TEMP_FILE = path.join(__dirname, 'economy.tmp.json');

/* =========================================================
   TOKEN
========================================================= */

if (!TOKEN) {
    console.error(
        '❌ DISCORD_TOKEN غير موجود في .env أو Railway Variables.'
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
        GatewayIntentBits.DirectMessages
    ]
});

/* =========================================================
   DATABASE
========================================================= */

function emptyDB() {
    return {
        version: 4,
        guilds: {}
    };
}

function createEmptyGuild() {
    return {
        economyChannelId: null,
        users: {}
    };
}

function createEmptyUser() {
    return {
        balance: 0,
        lastDaily: 0
    };
}

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

        const raw = fs.readFileSync(
            DB_FILE,
            'utf8'
        );

        if (!raw.trim()) {
            throw new Error(
                'قاعدة البيانات فارغة'
            );
        }

        const data = JSON.parse(raw);

        if (
            !data ||
            typeof data !== 'object' ||
            Array.isArray(data)
        ) {
            throw new Error(
                'قاعدة البيانات غير صحيحة'
            );
        }

        if (
            !data.guilds ||
            typeof data.guilds !== 'object' ||
            Array.isArray(data.guilds)
        ) {
            data.guilds = {};
        }

        data.version = 4;

        for (
            const guildId of Object.keys(data.guilds)
        ) {
            const guildData = data.guilds[guildId];

            if (
                !guildData ||
                typeof guildData !== 'object' ||
                Array.isArray(guildData)
            ) {
                data.guilds[guildId] =
                    createEmptyGuild();

                continue;
            }

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

            for (
                const userId of Object.keys(
                    guildData.users
                )
            ) {
                const user = guildData.users[userId];

                if (
                    !user ||
                    typeof user !== 'object' ||
                    Array.isArray(user)
                ) {
                    guildData.users[userId] =
                        createEmptyUser();

                    continue;
                }

                if (
                    typeof user.balance !== 'number'
                ) {
                    user.balance =
                        Number(user.balance) || 0;
                }

                if (
                    !Number.isFinite(user.balance)
                ) {
                    user.balance = 0;
                }

                if (user.balance < 0) {
                    user.balance = 0;
                }

                if (
                    typeof user.lastDaily !== 'number'
                ) {
                    user.lastDaily =
                        Number(user.lastDaily) || 0;
                }

                if (
                    !Number.isFinite(user.lastDaily)
                ) {
                    user.lastDaily = 0;
                }
            }
        }

        return data;
    } catch (error) {
        console.error(
            '❌ تعذر تحميل قاعدة البيانات:',
            error
        );

        try {
            if (fs.existsSync(DB_BACKUP_FILE)) {
                const backupRaw =
                    fs.readFileSync(
                        DB_BACKUP_FILE,
                        'utf8'
                    );

                const backup =
                    JSON.parse(backupRaw);

                if (
                    backup &&
                    typeof backup === 'object' &&
                    !Array.isArray(backup)
                ) {
                    if (
                        !backup.guilds ||
                        typeof backup.guilds !== 'object' ||
                        Array.isArray(backup.guilds)
                    ) {
                        backup.guilds = {};
                    }

                    backup.version = 4;

                    console.log(
                        '♻️ تم استرجاع قاعدة البيانات من النسخة الاحتياطية.'
                    );

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

function saveDB(data) {
    try {
        if (
            !data ||
            typeof data !== 'object' ||
            Array.isArray(data)
        ) {
            return false;
        }

        if (
            !data.guilds ||
            typeof data.guilds !== 'object' ||
            Array.isArray(data.guilds)
        ) {
            data.guilds = {};
        }

        data.version = 4;

        const json = JSON.stringify(
            data,
            null,
            2
        );

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

        return true;
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

        return false;
    }
}

function ensureGuild(
    db,
    guildId
) {
    if (
        !db.guilds[guildId] ||
        typeof db.guilds[guildId] !== 'object' ||
        Array.isArray(db.guilds[guildId])
    ) {
        db.guilds[guildId] =
            createEmptyGuild();
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
        typeof guildData.users[userId] !== 'object' ||
        Array.isArray(guildData.users[userId])
    ) {
        guildData.users[userId] =
            createEmptyUser();
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
        !Number.isFinite(user.balance)
    ) {
        user.balance = 0;
    }

    if (user.balance < 0) {
        user.balance = 0;
    }

    if (
        typeof user.lastDaily !== 'number'
    ) {
        user.lastDaily =
            Number(user.lastDaily) || 0;
    }

    if (
        !Number.isFinite(user.lastDaily)
    ) {
        user.lastDaily = 0;
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
   AMOUNT
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

    const suffix =
        match[2] || '';

    const multipliers = {
        k: 1000,
        m: 1000000,
        b: 1000000000,
        t: 1000000000000
    };

    const amount =
        number *
        (multipliers[suffix] || 1);

    if (
        !Number.isFinite(amount)
    ) {
        return NaN;
    }

    return Math.floor(amount);
}

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

    for (
        const unit of units
    ) {
        if (
            amount >= unit.value
        ) {
            const result =
                amount / unit.value;

            if (
                Number.isInteger(result)
            ) {
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
   HELPERS
========================================================= */

function isAdmin(member) {
    return Boolean(
        member &&
        member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    );
}

function isEconomyChannel(message) {
    if (!message.guild) {
        return false;
    }

    const db = loadDB();

    const guildData =
        ensureGuild(
            db,
            message.guild.id
        );

    return Boolean(
        guildData.economyChannelId &&
        guildData.economyChannelId ===
            message.channel.id
    );
}

const pendingTransfers = new Map();

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
        if (
            value.guildId === guildId
        ) {
            pendingTransfers.delete(key);
        }
    }
}

/* =========================================================
   TICKET HELPERS
========================================================= */

function getTicketOwner(channel) {
    if (
        !channel ||
        !channel.topic
    ) {
        return null;
    }

    const match =
        channel.topic.match(
            /owner:(\d+)/
        );

    return match
        ? match[1]
        : null;
}

function getTicketType(channel) {
    if (
        !channel ||
        !channel.topic
    ) {
        return null;
    }

    const match =
        channel.topic.match(
            /type:([a-z_]+)/
        );

    return match
        ? match[1]
        : null;
}

function isTicket(channel) {
    return Boolean(
        channel &&
        channel.type === ChannelType.GuildText &&
        channel.topic &&
        channel.topic.includes(
            'ticket:yes'
        )
    );
}

function getTicketRoleId(type) {
    if (
        type === 'technical_support'
    ) {
        return TECHNICAL_SUPPORT_ROLE_ID;
    }

    if (
        type === 'technical_report'
    ) {
        return TECHNICAL_REPORT_ROLE_ID;
    }

    return null;
}

function canManageTicket(member) {
    return Boolean(
        member &&
        (
            isAdmin(member) ||
            member.roles.cache.has(
                TECHNICAL_SUPPORT_ROLE_ID
            ) ||
            member.roles.cache.has(
                TECHNICAL_REPORT_ROLE_ID
            )
        )
    );
}

async function findExistingTicket(
    guild,
    userId
) {
    return guild.channels.cache.find(
        channel =>
            isTicket(channel) &&
            getTicketOwner(channel) ===
                userId
    );
}

function ticketPanelComponents() {
    const menu =
        new StringSelectMenuBuilder()
            .setCustomId(
                'ticket_open_menu'
            )
            .setPlaceholder(
                'اختار القسم المناسب لفتح التذكرة'
            )
            .addOptions(
                {
                    label:
                        'دعم الفني',
                    description:
                        'للدعم والاستفسارات والمساعدة',
                    value:
                        'technical_support',
                    emoji:
                        '🛠️'
                },
                {
                    label:
                        'أبلاغ عن مشكله تقنيه',
                    description:
                        'للإبلاغ عن مشكلة تقنية',
                    value:
                        'technical_report',
                    emoji:
                        '⚠️'
                }
            );

    return [
        new ActionRowBuilder().addComponents(
            menu
        )
    ];
}

function ticketControlComponents() {
    const claimButton =
        new ButtonBuilder()
            .setCustomId(
                'ticket_claim'
            )
            .setLabel(
                'استلام'
            )
            .setStyle(
                ButtonStyle.Secondary
            );

    const premiumButton =
        new ButtonBuilder()
            .setCustomId(
                'ticket_premium'
            )
            .setLabel(
                'ترقية البريميوم'
            )
            .setStyle(
                ButtonStyle.Primary
            );

    const closeButton =
        new ButtonBuilder()
            .setCustomId(
                'ticket_close'
            )
            .setLabel(
                'غلق'
            )
            .setStyle(
                ButtonStyle.Danger
            );

    const optionsMenu =
        new StringSelectMenuBuilder()
            .setCustomId(
                'ticket_options'
            )
            .setPlaceholder(
                'خــيــارات الــتــكــت'
            )
            .addOptions(
                {
                    label:
                        'استدعاء صاحب التذكرة',
                    description:
                        'استدعاء صاحب التذكرة',
                    value:
                        'summon_owner',
                    emoji:
                        '📢'
                },
                {
                    label:
                        'إضافة عضو للتذكرة',
                    description:
                        'إضافة عضو جديد للتذكرة',
                    value:
                        'add_member',
                    emoji:
                        '➕'
                },
                {
                    label:
                        'إزالة عضو من التذكرة',
                    description:
                        'إزالة عضو من التذكرة',
                    value:
                        'remove_member',
                    emoji:
                        '➖'
                },
                {
                    label:
                        'تغيير اسم التذكرة',
                    description:
                        'تغيير اسم قناة التذكرة',
                    value:
                        'rename_ticket',
                    emoji:
                        '✏️'
                },
                {
                    label:
                        'قفل الشات',
                    description:
                        'منع صاحب التذكرة من الكتابة',
                    value:
                        'lock_chat',
                    emoji:
                        '🔒'
                },
                {
                    label:
                        'فتح الشات',
                    description:
                        'السماح لصاحب التذكرة بالكتابة',
                    value:
                        'unlock_chat',
                    emoji:
                        '🔓'
                },
                {
                    label:
                        'غلق التذكرة',
                    description:
                        'إغلاق وحذف التذكرة',
                    value:
                        'close_ticket',
                    emoji:
                        '🗑️'
                }
            );

    return [
        new ActionRowBuilder().addComponents(
            claimButton,
            premiumButton,
            closeButton
        ),
        new ActionRowBuilder().addComponents(
            optionsMenu
        )
    ];
}

function createTicketPanelEmbed() {
    return new EmbedBuilder()
        .setColor('#D4AC0D')
        .setTitle(
            '📥 | قسم الدعم الفني والمساعدة'
        )
        .setDescription(
            'لـفتح تذكرة قم بالضغط على الزر اللذي بالأسفل ثم قم بتحديد إحتياجاتك. ⚠️\n\n**شروط وقوانين فتح التذاكر:**\nيُمنع منعاً باتاً فتح تذكرة بدون سبب واضح أو للتسلية (تذكرة عشوائية = تايم أوت ).'
        )
        .setImage(
            TICKET_PANEL_IMAGE
        );
}

async function setupTicketPanel() {
    try {
        const panelChannel =
            await client.channels.fetch(
                TICKET_PANEL_CHANNEL_ID
            ).catch(
                () => null
            );

        if (
            !panelChannel ||
            !panelChannel.isTextBased()
        ) {
            console.error(
                `❌ لم يتم العثور على روم التيكت ${TICKET_PANEL_CHANNEL_ID}`
            );
            return;
        }

        const panelEmbed =
            createTicketPanelEmbed();

        const messages =
            await panelChannel.messages.fetch({
                limit: 100
            }).catch(
                () => null
            );

        let oldPanel = null;

        if (messages) {
            oldPanel =
                messages.find(
                    msg =>
                        msg.author.id ===
                            client.user.id &&
                        msg.embeds.some(
                            embed =>
                                embed.title ===
                                '📥 | قسم الدعم الفني والمساعدة'
                        )
                );
        }

        if (oldPanel) {
            await oldPanel.edit({
                embeds: [
                    panelEmbed
                ],
                components:
                    ticketPanelComponents()
            });

            console.log(
                '✅ تم تحديث لوحة التيكت الموجودة.'
            );

            return;
        }

        await panelChannel.send({
            embeds: [
                panelEmbed
            ],
            components:
                ticketPanelComponents()
        });

        console.log(
            `✅ تم تسطيب لوحة التيكت في الروم ${TICKET_PANEL_CHANNEL_ID}`
        );
    } catch (error) {
        console.error(
            '❌ خطأ في تسطيب لوحة التيكت:',
            error
        );
    }
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

const slashCommands = [];

/* =========================================================
   REGISTER SLASH
========================================================= */

async function registerSlashCommands() {
    try {
        const rest =
            new REST({
                version: '10'
            }).setToken(
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
            '✅ تم تحديث أوامر السلاش.'
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

        const db =
            loadDB();

        for (
            const guild of client.guilds.cache.values()
        ) {
            ensureGuild(
                db,
                guild.id
            );
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
            1000
        );

        await setupTicketPanel();
    }
);

/* =========================================================
   GUILD CREATE
========================================================= */

client.on(
    'guildCreate',
    guild => {
        try {
            const db =
                loadDB();

            ensureGuild(
                db,
                guild.id
            );

            saveDB(db);

        } catch (error) {
            console.error(
                '❌ Guild Create Error:',
                error
            );
        }
    }
);

/* =========================================================
   MESSAGE CREATE
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

            /* =====================================================
               دعم؟
            ===================================================== */

            if (
                content === 'دعم؟'
            ) {
                return message.channel.send({
                    content:
                        '```text\nيرجى كتابة مشكلتك أو استفسارك مرة واحدة فقط وإنتظار الرد من الإدارة\n```',
                    files: [
                        TICKET_IMAGE
                    ]
                });
            }

            /* =====================================================
               #close
            ===================================================== */

            if (
                content.toLowerCase() ===
                    '#close' &&
                isTicket(
                    message.channel
                )
            ) {
                const ownerId =
                    getTicketOwner(
                        message.channel
                    );

                const canClose =
                    isAdmin(
                        message.member
                    ) ||
                    canManageTicket(
                        message.member
                    ) ||
                    (
                        ownerId &&
                        ownerId ===
                            message.author.id
                    );

                if (!canClose) {
                    return;
                }

                await message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                '🔒 سيتم غلق التذكرة.'
                            )
                    ]
                });

                setTimeout(
                    async () => {
                        await message.channel
                            .delete()
                            .catch(
                                () => {}
                            );
                    },
                    1500
                );

                return;
            }

            /* =====================================================
               #open / #Open
            ===================================================== */

            if (
                content.toLowerCase() ===
                    '#open' &&
                isTicket(
                    message.channel
                )
            ) {
                if (
                    !canManageTicket(
                        message.member
                    )
                ) {
                    return;
                }

                const ownerId =
                    getTicketOwner(
                        message.channel
                    );

                if (!ownerId) {
                    return;
                }

                await message.channel.permissionOverwrites.edit(
                    ownerId,
                    {
                        ViewChannel:
                            true,
                        SendMessages:
                            true,
                        ReadMessageHistory:
                            true
                    }
                );

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                `🔓 تم فتح الشات بواسطة ${message.author}.`
                            )
                    ]
                });
            }

            /* =====================================================
               الاقتصاد
            ===================================================== */

            const db =
                loadDB();

            const guildData =
                ensureGuild(
                    db,
                    message.guild.id
                );

            /* =====================================================
               تفعيل روم
            ===================================================== */

            if (
                content ===
                'تفعيل روم'
            ) {
                if (
                    !isAdmin(
                        message.member
                    )
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
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
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                `✅ تم تفعيل نظام العملة في <#${message.channel.id}>.\n\n💾 تم حفظ التفعيل حتى بعد إعادة تشغيل البوت.`
                            )
                    ]
                });
            }

            /* =====================================================
               تعطيل روم
            ===================================================== */

            if (
                content ===
                'تعطيل روم'
            ) {
                if (
                    !isAdmin(
                        message.member
                    )
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ هذا الأمر مخصص للإداريين فقط.'
                                )
                        ]
                    });
                }

                guildData.economyChannelId =
                    null;

                cleanupPendingForGuild(
                    message.guild.id
                );

                saveDB(db);

                return message.channel.send({
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

            if (
                !isEconomyChannel(
                    message
                )
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

            /* =====================================================
               مكافأة
            ===================================================== */

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

                if (
                    accountAge <
                    fourteenDays
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
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
                                .setColor(
                                    '#D4AC0D'
                                )
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
                            Math.random() *
                            2001
                        ) + 3000
                        : Math.floor(
                            Math.random() *
                            301
                        ) + 1700;

                user.balance +=
                    randomAmount;

                user.lastDaily =
                    now;

                saveDB(db);

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                isPremium
                                    ? `🎁 **مكافأة عضو مميز**\n\nلقد حصلت على **${formatAmount(randomAmount)} 𝐎𝐏𝐬**`
                                    : `🎁 لقد حصلت على **${formatAmount(randomAmount)} 𝐎𝐏𝐬** coin`
                            )
                    ]
                });
            }

            /* =====================================================
               رصيد
            ===================================================== */

            if (
                content.toLowerCase() ===
                    '𝐎𝐏𝐬' ||
                content.toLowerCase() ===
                    'ops' ||
                content ===
                    'رصيد' ||
                content.startsWith(
                    'رصيد '
                ) ||
                content.toLowerCase().startsWith(
                    '𝐎𝐏𝐬 '
                ) ||
                content.toLowerCase().startsWith(
                    'ops '
                )
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
                                    ? `رصيدك الحالي : ${formatAmount(targetUser.balance)} 𝐎𝐏𝐬`
                                    : `رصيد العضو ${targetMember} الحالي : ${formatAmount(targetUser.balance)} 𝐎𝐏𝐬`
                            )
                    ]
                });
            }

            /* =====================================================
               تحويل
            ===================================================== */

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

                let amount = 0;

                const currentBalance =
                    Number(
                        user.balance
                    ) || 0;

                if (
                    argValue ===
                    'كامل'
                ) {
                    amount =
                        currentBalance;
                } else if (
                    argValue ===
                    'نص'
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
                                    '❌ يرجى كتابة مبلغ صالح أو كلمة (نص) أو (كامل).\n\nالاختصارات المدعومة: `k` `m` `b` `t`'
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
                                    `verify_transfer_${userId}_${targetMember.id}_${amount}`
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

            /* =====================================================
               توب
            ===================================================== */

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
                    (page - 1) *
                    10;

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
                            `#${start + index + 1} <@${uId}> — **${formatAmount(data.balance)} 𝐎𝐏𝐬**\n`;
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
   INTERACTION CREATE
========================================================= */

client.on(
    'interactionCreate',
    async interaction => {
        try {

            /* =====================================================
               فتح التذكرة
            ===================================================== */

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    'ticket_open_menu'
            ) {
                const type =
                    interaction.values[0];

                if (
                    type !==
                        'technical_support' &&
                    type !==
                        'technical_report'
                ) {
                    return;
                }

                const existing =
                    await findExistingTicket(
                        interaction.guild,
                        interaction.user.id
                    );

                if (existing) {
                    return interaction.reply({
                        content:
                            `❌ لديك تذكرة مفتوحة بالفعل: ${existing}`,
                        ephemeral:
                            true
                    });
                }

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `ticket_reason_${type}`
                        )
                        .setTitle(
                            type ===
                                'technical_support'
                                ? 'دعم الفني'
                                : 'أبلاغ عن مشكله تقنيه'
                        );

                const reason =
                    new TextInputBuilder()
                        .setCustomId(
                            'ticket_reason_input'
                        )
                        .setLabel(
                            'اكتب سبب فتح التذكرة'
                        )
                        .setPlaceholder(
                            'اكتب مشكلتك أو استفسارك بالتفصيل...'
                        )
                        .setStyle(
                            TextInputStyle.Paragraph
                        )
                        .setRequired(
                            true
                        )
                        .setMaxLength(
                            1000
                        );

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        reason
                    )
                );

                return interaction.showModal(
                    modal
                );
            }

            /* =====================================================
               Modal فتح التذكرة
            ===================================================== */

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    'ticket_reason_'
                )
            ) {
                const type =
                    interaction.customId.replace(
                        'ticket_reason_',
                        ''
                    );

                const reason =
                    interaction.fields.getTextInputValue(
                        'ticket_reason_input'
                    );

                const existing =
                    await findExistingTicket(
                        interaction.guild,
                        interaction.user.id
                    );

                if (existing) {
                    return interaction.reply({
                        content:
                            `❌ لديك تذكرة مفتوحة بالفعل: ${existing}`,
                        ephemeral:
                            true
                    });
                }

                const panelChannel =
                    await interaction.guild.channels.fetch(
                        TICKET_PANEL_CHANNEL_ID
                    ).catch(
                        () => null
                    );

                const parentId =
                    panelChannel &&
                    panelChannel.parentId
                        ? panelChannel.parentId
                        : undefined;

                const roleId =
                    getTicketRoleId(
                        type
                    );

                const permissionOverwrites = [
                    {
                        id:
                            interaction.guild.roles.everyone.id,
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

                if (roleId) {
                    permissionOverwrites.push({
                        id:
                            roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    });
                }

                permissionOverwrites.push({
                    id:
                        client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.ManageRoles
                    ]
                });

                const safeName =
                    interaction.user.username
                        .toLowerCase()
                        .replace(
                            /[^a-z0-9\u0600-\u06ff_-]/g,
                            ''
                        )
                        .slice(
                            0,
                            70
                        ) ||
                    interaction.user.id;

                const ticketPrefix =
                    type ===
                        'technical_support'
                        ? 'دعم'
                        : 'بلاغ';

                const ticketChannel =
                    await interaction.guild.channels.create({
                        name:
                            `${ticketPrefix}-${safeName}`,
                        type:
                            ChannelType.GuildText,
                        parent:
                            parentId,
                        topic:
                            `ticket:yes owner:${interaction.user.id} type:${type}`,
                        permissionOverwrites
                    });

                const roleMention =
                    roleId
                        ? `<@&${roleId}>`
                        : '';

                const ticketEmbed =
                    new EmbedBuilder()
                        .setColor(
                            '#D4AC0D'
                        )
                        .setDescription(
                            `**دعم الفني**\n\nيرجى انتظار مسؤولين التذكرة الرد عليك\n\nالسبب\n\`\`\`diff\n${reason}\n\`\`\``
                        )
                        .setImage(
                            TICKET_IMAGE
                        );

                await ticketChannel.send({
                    content:
                        `${roleMention} <@${interaction.user.id}>`,
                    embeds: [
                        ticketEmbed
                    ],
                    components:
                        ticketControlComponents()
                });

                await interaction.reply({
                    content:
                        `✅ تم فتح تذكرتك: ${ticketChannel}`,
                    ephemeral:
                        true
                });

                return;
            }

            /* =====================================================
               Ticket buttons
            ===================================================== */

            if (
                interaction.isButton() &&
                (
                    interaction.customId ===
                        'ticket_claim' ||
                    interaction.customId ===
                        'ticket_close' ||
                    interaction.customId ===
                        'ticket_premium'
                )
            ) {
                if (
                    !isTicket(
                        interaction.channel
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الزر يعمل داخل التذاكر فقط.',
                        ephemeral:
                            true
                    });
                }

                /* =================================================
                   غلق التذكرة
                ================================================= */

                if (
                    interaction.customId ===
                    'ticket_close'
                ) {
                    const ownerId =
                        getTicketOwner(
                            interaction.channel
                        );

                    const canClose =
                        isAdmin(
                            interaction.member
                        ) ||
                        canManageTicket(
                            interaction.member
                        ) ||
                        (
                            ownerId &&
                            ownerId ===
                                interaction.user.id
                        );

                    if (!canClose) {
                        return interaction.reply({
                            content:
                                '❌ ليس لديك صلاحية غلق التذكرة.',
                            ephemeral:
                                true
                        });
                    }

                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '🔒 سيتم غلق التذكرة.'
                                )
                        ]
                    });

                    setTimeout(
                        async () => {
                            await interaction.channel
                                .delete()
                                .catch(
                                    () => {}
                                );
                        },
                        1500
                    );

                    return;
                }

                /* =================================================
                   استلام
                ================================================= */

                if (
                    interaction.customId ===
                    'ticket_claim'
                ) {
                    if (
                        !canManageTicket(
                            interaction.member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الزر مخصص لفريق الدعم.',
                            ephemeral:
                                true
                        });
                    }

                    const ownerId =
                        getTicketOwner(
                            interaction.channel
                        );

                    const type =
                        getTicketType(
                            interaction.channel
                        );

                    await interaction.channel.setTopic(
                        `ticket:yes owner:${ownerId} type:${type} claimed:${interaction.user.id}`
                    ).catch(
                        () => {}
                    );

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    `✅ تم استلام التذكرة بواسطة ${interaction.user}.`
                                )
                        ]
                    });
                }

                /* =================================================
                   البريميوم
                ================================================= */

                if (
                    interaction.customId ===
                    'ticket_premium'
                ) {
                    return interaction.reply({
                        content:
                            '⭐ البريميوم',
                        ephemeral:
                            true
                    });
                }
            }

            /* =====================================================
               Ticket options
            ===================================================== */

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    'ticket_options'
            ) {
                if (
                    !isTicket(
                        interaction.channel
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذه القائمة تعمل داخل التذاكر فقط.',
                        ephemeral:
                            true
                    });
                }

                const selected =
                    interaction.values[0];

                const canManage =
                    canManageTicket(
                        interaction.member
                    );

                /* =================================================
                   استدعاء صاحب التذكرة
                ================================================= */

                if (
                    selected ===
                    'summon_owner'
                ) {
                    if (!canManage) {
                        return interaction.reply({
                            content:
                                '❌ هذا الخيار مخصص لفريق الدعم.',
                            ephemeral:
                                true
                        });
                    }

                    const ownerId =
                        getTicketOwner(
                            interaction.channel
                        );

                    if (!ownerId) {
                        return interaction.reply({
                            content:
                                '❌ تعذر العثور على صاحب التذكرة.',
                            ephemeral:
                                true
                        });
                    }

                    const owner =
                        await interaction.guild.members
                            .fetch(
                                ownerId
                            )
                            .catch(
                                () => null
                            );

                    if (!owner) {
                        return interaction.reply({
                            content:
                                '❌ صاحب التذكرة غير موجود.',
                            ephemeral:
                                true
                        });
                    }

                    return interaction.reply({
                        content:
                            `<@${ownerId}>`,
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    `📢 تم استدعاء صاحب التذكرة ${owner}.`
                                )
                        ]
                    });
                }

                if (!canManage) {
                    return interaction.reply({
                        content:
                            '❌ هذا الخيار مخصص لفريق الدعم.',
                        ephemeral:
                            true
                    });
                }

                /* =================================================
                   إضافة عضو
                ================================================= */

                if (
                    selected ===
                    'add_member'
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'ticket_add_member'
                            )
                            .setTitle(
                                'إضافة عضو للتذكرة'
                            );

                    const memberInput =
                        new TextInputBuilder()
                            .setCustomId(
                                'member_id'
                            )
                            .setLabel(
                                'ID العضو'
                            )
                            .setPlaceholder(
                                'ضع ID العضو هنا'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            memberInput
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /* =================================================
                   إزالة عضو
                ================================================= */

                if (
                    selected ===
                    'remove_member'
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'ticket_remove_member'
                            )
                            .setTitle(
                                'إزالة عضو من التذكرة'
                            );

                    const memberInput =
                        new TextInputBuilder()
                            .setCustomId(
                                'member_id'
                            )
                            .setLabel(
                                'ID العضو'
                            )
                            .setPlaceholder(
                                'ضع ID العضو هنا'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            memberInput
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /* =================================================
                   تغيير اسم التذكرة
                ================================================= */

                if (
                    selected ===
                    'rename_ticket'
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'ticket_rename'
                            )
                            .setTitle(
                                'تغيير اسم التذكرة'
                            );

                    const nameInput =
                        new TextInputBuilder()
                            .setCustomId(
                                'ticket_name'
                            )
                            .setLabel(
                                'اسم التذكرة الجديد'
                            )
                            .setPlaceholder(
                                'اكتب الاسم الجديد'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                90
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            nameInput
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /* =================================================
                   قفل الشات
                ================================================= */

                if (
                    selected ===
                    'lock_chat'
                ) {
                    const ownerId =
                        getTicketOwner(
                            interaction.channel
                        );

                    if (ownerId) {
                        await interaction.channel.permissionOverwrites.edit(
                            ownerId,
                            {
                                SendMessages:
                                    false
                            }
                        );
                    }

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '🔒 تم قفل الشات.'
                                )
                        ]
                    });
                }

                /* =================================================
                   فتح الشات
                ================================================= */

                if (
                    selected ===
                    'unlock_chat'
                ) {
                    const ownerId =
                        getTicketOwner(
                            interaction.channel
                        );

                    if (ownerId) {
                        await interaction.channel.permissionOverwrites.edit(
                            ownerId,
                            {
                                ViewChannel:
                                    true,
                                SendMessages:
                                    true,
                                ReadMessageHistory:
                                    true
                            }
                        );
                    }

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '🔓 تم فتح الشات.'
                                )
                        ]
                    });
                }

                /* =================================================
                   غلق التذكرة
                ================================================= */

                if (
                    selected ===
                    'close_ticket'
                ) {
                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '🔒 سيتم غلق التذكرة.'
                                )
                        ]
                    });

                    setTimeout(
                        async () => {
                            await interaction.channel
                                .delete()
                                .catch(
                                    () => {}
                                );
                        },
                        1500
                    );

                    return;
                }
            }

            /* =====================================================
               Ticket modals
            ===================================================== */

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                    'ticket_add_member'
            ) {
                if (
                    !isTicket(
                        interaction.channel
                    ) ||
                    !canManageTicket(
                        interaction.member
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ ليس لديك صلاحية استخدام هذا الخيار.',
                        ephemeral:
                            true
                    });
                }

                const memberId =
                    interaction.fields
                        .getTextInputValue(
                            'member_id'
                        )
                        .trim();

                const member =
                    await interaction.guild.members
                        .fetch(
                            memberId
                        )
                        .catch(
                            () => null
                        );

                if (!member) {
                    return interaction.reply({
                        content:
                            '❌ لم يتم العثور على العضو.',
                        ephemeral:
                            true
                    });
                }

                await interaction.channel.permissionOverwrites.edit(
                    member.id,
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

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                `✅ تم إضافة ${member} إلى التذكرة.`
                            )
                    ]
                });
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                    'ticket_remove_member'
            ) {
                if (
                    !isTicket(
                        interaction.channel
                    ) ||
                    !canManageTicket(
                        interaction.member
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ ليس لديك صلاحية استخدام هذا الخيار.',
                        ephemeral:
                            true
                    });
                }

                const memberId =
                    interaction.fields
                        .getTextInputValue(
                            'member_id'
                        )
                        .trim();

                const ownerId =
                    getTicketOwner(
                        interaction.channel
                    );

                if (
                    memberId === ownerId
                ) {
                    return interaction.reply({
                        content:
                            '❌ لا يمكنك إزالة صاحب التذكرة.',
                        ephemeral:
                            true
                    });
                }

                const member =
                    await interaction.guild.members
                        .fetch(
                            memberId
                        )
                        .catch(
                            () => null
                        );

                if (!member) {
                    return interaction.reply({
                        content:
                            '❌ لم يتم العثور على العضو.',
                        ephemeral:
                            true
                    });
                }

                await interaction.channel.permissionOverwrites
                    .delete(
                        member.id
                    )
                    .catch(
                        () => {}
                    );

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                `✅ تم إزالة ${member} من التذكرة.`
                            )
                    ]
                });
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                    'ticket_rename'
            ) {
                if (
                    !isTicket(
                        interaction.channel
                    ) ||
                    !canManageTicket(
                        interaction.member
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ ليس لديك صلاحية استخدام هذا الخيار.',
                        ephemeral:
                            true
                    });
                }

                let newName =
                    interaction.fields
                        .getTextInputValue(
                            'ticket_name'
                        )
                        .trim();

                newName =
                    newName
                        .replace(
                            /[^a-zA-Z0-9\u0600-\u06ff_-]/g,
                            '-'
                        )
                        .replace(
                            /-+/g,
                            '-'
                        )
                        .slice(
                            0,
                            90
                        );

                if (!newName) {
                    return interaction.reply({
                        content:
                            '❌ اسم التذكرة غير صالح.',
                        ephemeral:
                            true
                    });
                }

                await interaction.channel.setName(
                    newName
                );

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                `✅ تم تغيير اسم التذكرة إلى **${newName}**.`
                            )
                    ]
                });
            }

            /* =====================================================
               Slash
            ===================================================== */

            if (
                interaction.isChatInputCommand()
            ) {
                return;
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
   TRANSFER BUTTON
========================================================= */

client.on(
    'interactionCreate',
    async interaction => {
        try {
            if (
                !interaction.isButton() ||
                !interaction.customId.startsWith(
                    'verify_transfer_'
                )
            ) {
                return;
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
                parseInt(
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
                    ephemeral:
                        true
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

        } catch (error) {
            console.error(
                '❌ Transfer Button Error:',
                error
            );
        }
    }
);

/* =========================================================
   TRANSFER CONFIRMATION
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
                !message.guild ||
                !isEconomyChannel(
                    message
                )
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

            await message.delete()
                .catch(
                    () => {}
                );

            if (transfer.botMsg) {
                await transfer.botMsg
                    .delete()
                    .catch(
                        () => {}
                    );
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
                    .addFields(
                        {
                            name:
                                'المبلغ',
                            value:
                                `\`\`\`fix\n${formatAmount(transfer.amount)} 𝐎𝐏𝐬\n\`\`\``
                        },
                        {
                            name:
                                'إلى',
                            value:
                                `\`\`\`ini\n[ ${
                                    targetMember
                                        ? targetMember.user.tag
                                        : transfer.targetId
                                } ]\n\`\`\``
                        },
                        {
                            name:
                                'من',
                            value:
                                `\`\`\`ini\n[ ${message.author.tag} ]\n\`\`\``
                        }
                    )
                    .setTimestamp();

            await message.author.send({
                embeds: [
                    receiptEmbed
                ]
            }).catch(
                () => {}
            );

            if (
                targetMember
            ) {
                await targetMember.send({
                    embeds: [
                        receiptEmbed
                    ]
                }).catch(
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
                            `✅ تم التحويل بنجاح بقيمة **${formatAmount(transfer.amount)} 𝐎𝐏𝐬**.`
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
   CLIENT ERROR
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
        const db =
            loadDB();

        for (
            const guild of client.guilds.cache.values()
        ) {
            ensureGuild(
                db,
                guild.id
            );
        }

        saveDB(db);

        console.log(
            '💾 تم حفظ بيانات الاقتصاد لكل السيرفرات قبل الإغلاق.'
        );
    } catch (error) {
        console.error(
            '❌ خطأ أثناء الحفظ قبل الإغلاق:',
            error
        );
    }
}

/* =========================================================
   SHUTDOWN
========================================================= */

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