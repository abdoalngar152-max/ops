import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} from 'discord.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = String(process.env.DISCORD_TOKEN || '').trim();

const DATA_DIR = '/data';

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'economy.json');
const DB_BACKUP_FILE = path.join(DATA_DIR, 'economy.backup.json');
const DB_TEMP_FILE = path.join(DATA_DIR, 'economy.tmp.json');

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

        if (
            !data.guilds ||
            typeof data.guilds !== 'object' ||
            Array.isArray(data.guilds)
        ) {
            data.guilds = {};
        }

        data.version = 2;

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

                    backup.version = 2;

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
    data.version = 2;

    if (
        !data.guilds ||
        typeof data.guilds !== 'object'
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

function ensureGuild(db, guildId) {
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
            balance: 0
        };
    }

    if (
        typeof guildData.users[userId].balance !==
        'number'
    ) {
        guildData.users[userId].balance =
            Number(
                guildData.users[userId].balance
            ) || 0;
    }

    return guildData.users[userId];
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

function parseAmount(value) {
    if (!value) return NaN;

    const text =
        String(value)
            .trim()
            .toLowerCase()
            .replace(/,/g, '');

    const match =
        text.match(
            /^(\d+(?:\.\d+)?)([kmbt])?$/
        );

    if (!match) return NaN;

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

    if (!Number.isFinite(amount)) {
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

function isAdmin(member) {
    return Boolean(
        member &&
        member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    );
}

const pendingTransfers = new Map();

function transferKey(
    guildId,
    userId
) {
    return `${guildId}:${userId}`;
}

function cleanupPendingForGuild(guildId) {
    for (
        const [
            key,
            value
        ] of pendingTransfers.entries()
    ) {
        if (
            value.guildId ===
            guildId
        ) {
            pendingTransfers.delete(key);
        }
    }
}

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

        const db = loadDB();

        for (
            const guild of
            client.guilds.cache.values()
        ) {
            ensureGuild(
                db,
                guild.id
            );
        }

        saveDB(db);

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
    }
);

client.on(
    'guildCreate',
    guild => {
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
    }
);

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

            const db = loadDB();

            const guildData =
                ensureGuild(
                    db,
                    message.guild.id
                );

            if (
                content ===
                    'تفعيل العملة' ||
                content ===
                    'تفعيل العملات'
            ) {
                if (!isAdmin(message.member)) {
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
                                `✅ تم تفعيل نظام العملة في <#${message.channel.id}>.\n\n💾 سيتم حفظ التفعيل حتى بعد إعادة تشغيل البوت.`
                            )
                    ]
                });
            }

            if (
                content ===
                    'تعطيل العملة' ||
                content ===
                    'تعطيل العملات'
            ) {
                if (!isAdmin(message.member)) {
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
                !guildData.economyChannelId ||
                guildData.economyChannelId !==
                    message.channel.id
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

            if (
                content.startsWith(
                    'تحويل'
                )
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

            if (
                content === 'توب' ||
                content === 'التوب' ||
                content.toLowerCase() ===
                    'top' ||
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
                    (page - 1) * 10;

                const pageUsers =
                    sortedUsers.slice(
                        start,
                        start + 10
                    );

                let description =
                    '';

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

client.on(
    'interactionCreate',
    async interaction => {
        try {
            if (
                !interaction.isButton()
            ) {
                return;
            }

            if (
                !interaction.customId.startsWith(
                    'verify_transfer_'
                )
            ) {
                return;
            }

            if (!interaction.guild) {
                return interaction.reply({
                    content:
                        '❌ هذا الأمر يعمل داخل السيرفر فقط.',
                    ephemeral: true
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

            const db = loadDB();

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
    }
);

client.on(
    'messageCreate',
    async message => {
        try {
            if (message.author.bot) {
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
                pendingTransfers.has(
                    key
                )
            ) {
                const transfer =
                    pendingTransfers.get(
                        key
                    );

                if (
                    transfer.code &&
                    content ===
                        transfer.code
                ) {
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
                                        `\`\`\`fix\n${formatAmount(
                                            transfer.amount
                                        )} 𝐎𝐏𝐬\n\`\`\``
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

                    if (targetMember) {
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
    }
);

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

function gracefulSave() {
    try {
        const db =
            loadDB();

        for (
            const guild of
            client.guilds.cache.values()
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

client.login(
    TOKEN
).catch(
    error => {
        console.error(
            '❌ فشل تسجيل الدخول إلى Discord.'
        );

        console.error(error);

        process.exit(1);
    }
);