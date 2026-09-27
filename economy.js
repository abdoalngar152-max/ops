import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = String(process.env.DISCORD_TOKEN || '').trim();

const PREMIUM_ROLE_ID = '1544858160982917261';

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
    GatewayIntentBits.MessageContent
  ]
});

function emptyDB() {
  return {
    version: 3,
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

    const data = JSON.parse(
      fs.readFileSync(DB_FILE, 'utf8')
    );

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      throw new Error('Invalid DB');
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
        const data = JSON.parse(
          fs.readFileSync(
            DB_BACKUP_FILE,
            'utf8'
          )
        );

        if (
          data &&
          typeof data === 'object' &&
          !Array.isArray(data)
        ) {
          if (
            !data.guilds ||
            typeof data.guilds !== 'object' ||
            Array.isArray(data.guilds)
          ) {
            data.guilds = {};
          }

          data.version = 3;

          return data;
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
    data.version = 3;

    if (
      !data.guilds ||
      typeof data.guilds !== 'object' ||
      Array.isArray(data.guilds)
    ) {
      data.guilds = {};
    }

    fs.writeFileSync(
      DB_TEMP_FILE,
      JSON.stringify(data, null, 2),
      'utf8'
    );

    if (fs.existsSync(DB_FILE)) {
      fs.copyFileSync(
        DB_FILE,
        DB_BACKUP_FILE
      );
    }

    if (
      process.platform === 'win32' &&
      fs.existsSync(DB_FILE)
    ) {
      fs.unlinkSync(DB_FILE);
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
  }
}

function ensureGuild(db, guildId) {
  if (
    !db.guilds[guildId] ||
    typeof db.guilds[guildId] !== 'object' ||
    Array.isArray(db.guilds[guildId])
  ) {
    db.guilds[guildId] = {
      currencyName: DEFAULT_CURRENCY_NAME,
      economyChannelId: null,
      users: {}
    };
  }

  const guild = db.guilds[guildId];

  guild.currencyName =
    DEFAULT_CURRENCY_NAME;

  if (
    !Object.prototype.hasOwnProperty.call(
      guild,
      'economyChannelId'
    )
  ) {
    guild.economyChannelId = null;
  }

  if (
    !guild.users ||
    typeof guild.users !== 'object' ||
    Array.isArray(guild.users)
  ) {
    guild.users = {};
  }

  return guild;
}

function ensureUser(
  db,
  guildId,
  userId
) {
  const guild = ensureGuild(
    db,
    guildId
  );

  if (
    !guild.users[userId] ||
    typeof guild.users[userId] !== 'object' ||
    Array.isArray(guild.users[userId])
  ) {
    guild.users[userId] = {
      balance: 0,
      lastDaily: 0
    };
  }

  const user =
    guild.users[userId];

  user.balance =
    Number(user.balance) || 0;

  user.lastDaily =
    Number(user.lastDaily) || 0;

  return user;
}

function parseAmount(value) {
  if (!value) return NaN;

  const text = String(value)
    .trim()
    .toLowerCase()
    .replace(/,/g, '');

  const match =
    text.match(
      /^(\d+(?:\.\d+)?)([kmbt])?$/
    );

  if (!match) return NaN;

  const multipliers = {
    k: 1000,
    m: 1000000,
    b: 1000000000,
    t: 1000000000000
  };

  const amount =
    Number(match[1]) *
    (multipliers[match[2] || ''] || 1);

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
    [1000000000000, 't'],
    [1000000000, 'b'],
    [1000000, 'm'],
    [1000, 'k']
  ];

  for (const unit of units) {
    if (amount >= unit[0]) {
      const value =
        amount / unit[0];

      return `${
        Number.isInteger(value)
          ? value
          : Number(value.toFixed(2))
      }${unit[1]}`;
    }
  }

  return String(amount);
}

function economyAllowed(
  db,
  guildId,
  channelId
) {
  const guild =
    ensureGuild(
      db,
      guildId
    );

  if (!guild.economyChannelId) {
    return {
      ok: false,
      message:
        '❌ نظام العملة غير مفعّل في هذا السيرفر.'
    };
  }

  if (
    guild.economyChannelId !==
    channelId
  ) {
    return {
      ok: false,
      message:
        `❌ أوامر العملة تعمل فقط في <#${guild.economyChannelId}>.`
    };
  }

  return {
    ok: true
  };
}

function dailyAmount(member) {
  return member?.roles.cache.has(
    PREMIUM_ROLE_ID
  )
    ? Math.floor(
        Math.random() * 2001
      ) + 3000
    : Math.floor(
        Math.random() * 301
      ) + 1700;
}

async function claimDaily({
  guild,
  user,
  member,
  reply
}) {
  const db = loadDB();

  const check =
    economyAllowed(
      db,
      guild.id,
      reply.channelId || null
    );

  if (!check.ok) {
    return reply({
      content: check.message,
      ephemeral: true
    });
  }

  const accountAge =
    Date.now() -
    user.createdTimestamp;

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
    return reply({
      content:
        '❌ لا يمكنك أخذ المكافأة لأن عمر حسابك أقل من 14 يومًا.',
      ephemeral: true
    });
  }

  const data =
    ensureUser(
      db,
      guild.id,
      user.id
    );

  const cooldown =
    24 *
    60 *
    60 *
    1000;

  const remaining =
    cooldown -
    (Date.now() -
      data.lastDaily);

  if (remaining > 0) {
    const hours =
      Math.floor(
        remaining /
          3600000
      );

    const minutes =
      Math.floor(
        (remaining %
          3600000) /
          60000
      );

    return reply({
      content:
        `⏳ يمكنك استلام المكافأة بعد **${hours} ساعة و ${minutes} دقيقة**.`,
      ephemeral: true
    });
  }

  const amount =
    dailyAmount(member);

  data.balance +=
    amount;

  data.lastDaily =
    Date.now();

  saveDB(db);

  const premium =
    member?.roles.cache.has(
      PREMIUM_ROLE_ID
    );

  return reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#D4AC0D')
        .setDescription(
          premium
            ? `🎁 **مكافأة عضو مميز**\n\nلقد حصلت على **${formatAmount(amount)} 𝐎𝐏𝐬**`
            : `🎁 لقد حصلت على **${formatAmount(amount)} 𝐎𝐏𝐬**`
        )
    ]
  });
}

const slashCommands = [
  new SlashCommandBuilder()
    .setName('currency')
    .setDescription(
      'تفعيل أو تعطيل نظام العملة'
    )
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription(
          'تفعيل العملة في الروم الحالي'
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription(
          'تعطيل العملة في السيرفر'
        )
    ),

  new SlashCommandBuilder()
    .setName('daily')
    .setDescription(
      'استلام المكافأة اليومية'
    ),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription(
      'عرض توب العملات'
    )
    .addIntegerOption(
      option =>
        option
          .setName('page')
          .setDescription(
            'صفحة التوب من 1 إلى 5'
          )
          .setMinValue(1)
          .setMaxValue(5)
    )
].map(command =>
  command.toJSON()
);

async function registerCommands() {
  for (
    const guild of
    client.guilds.cache.values()
  ) {
    try {
      await guild.commands.set(
        slashCommands
      );

      console.log(
        `✅ تم تسجيل أوامر السلاش في: ${guild.name}`
      );
    } catch (error) {
      console.error(
        `❌ فشل تسجيل الأوامر في ${guild.name}:`,
        error
      );
    }
  }
}

async function sendTop(
  messageOrInteraction,
  guild,
  channel
) {
  const db = loadDB();

  const check =
    economyAllowed(
      db,
      guild.id,
      channel.id
    );

  if (!check.ok) {
    if (
      typeof messageOrInteraction.reply ===
      'function'
    ) {
      return messageOrInteraction.reply({
        content: check.message,
        ephemeral: true
      });
    }

    return channel.send({
      content: check.message
    });
  }

  const page =
    messageOrInteraction
      .options
      ?.getInteger
      ?.('page') || 1;

  const guildData =
    ensureGuild(
      db,
      guild.id
    );

  const users =
    Object.entries(
      guildData.users
    )
      .map(
        ([id, data]) => ({
          id,
          balance:
            Number(data.balance) ||
            0
        })
      )
      .sort(
        (a, b) =>
          b.balance -
          a.balance
      );

  const start =
    (page - 1) * 10;

  const rows =
    users.slice(
      start,
      start + 10
    );

  if (!rows.length) {
    const payload = {
      embeds: [
        new EmbedBuilder()
          .setColor('#D4AC0D')
          .setDescription(
            '❌ لا توجد بيانات كافية في التوب.'
          )
      ],
      ephemeral:
        Boolean(
          messageOrInteraction.reply
        )
    };

    if (
      typeof messageOrInteraction.reply ===
      'function'
    ) {
      return messageOrInteraction.reply(
        payload
      );
    }

    return channel.send(
      payload
    );
  }

  const lines = [];

  for (
    let i = 0;
    i < rows.length;
    i++
  ) {
    const row =
      rows[i];

    const member =
      await guild.members
        .fetch(row.id)
        .catch(() => null);

    const name =
      member
        ? member.user.username
        : `<@${row.id}>`;

    lines.push(
      `**${start + i + 1}.** ${name} — **${formatAmount(row.balance)} 𝐎𝐏𝐬**`
    );
  }

  const embed =
    new EmbedBuilder()
      .setColor('#D4AC0D')
      .setTitle(
        '🏆 توب العملات'
      )
      .setDescription(
        lines.join('\n')
      )
      .setFooter({
        text:
          `الصفحة ${page} من 5`
      });

  if (
    typeof messageOrInteraction.reply ===
    'function'
  ) {
    return messageOrInteraction.reply({
      embeds: [embed]
    });
  }

  return channel.send({
    embeds: [embed]
  });
}

client.once(
  'ready',
  async () => {
    console.log(
      `✅ البوت اشتغل: ${client.user.tag}`
    );

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

    await registerCommands();

    const statuses = [
      'نظام العملات',
      'افضل بوت عملات',
      'سبحان الله وبحمده',
      'استغفر الله'
    ];

    let index = 0;

    client.user.setPresence({
      activities: [
        {
          name: 'customstatus',
          type: 4,
          state:
            statuses[0]
        }
      ],
      status:
        'online'
    });

    setInterval(() => {
      index =
        (index + 1) %
        statuses.length;

      client.user.setPresence({
        activities: [
          {
            name: 'customstatus',
            type: 4,
            state:
              statuses[index]
          }
        ],
        status:
          'online'
      });
    }, 1000);
  }
);

client.on(
  'guildCreate',
  async guild => {
    const db =
      loadDB();

    ensureGuild(
      db,
      guild.id
    );

    saveDB(db);

    try {
      await guild.commands.set(
        slashCommands
      );
    } catch {}
  }
);

client.on(
  'messageCreate',
  async message => {
    try {
      if (
        message.author.bot ||
        !message.guild
      ) {
        return;
      }

      const content =
        message.content.trim();

      const db =
        loadDB();

      const check =
        economyAllowed(
          db,
          message.guild.id,
          message.channel.id
        );

      if (!check.ok) {
        return;
      }

      if (
        content === 'مكافاة' ||
        content === 'مكافأة'
      ) {
        const member =
          await message.guild.members
            .fetch(
              message.author.id
            )
            .catch(
              () => message.member
            );

        return claimDaily({
          guild:
            message.guild,
          user:
            message.author,
          member,
          reply:
            payload =>
              message.channel.send(
                payload
              )
        });
      }

      if (
        content === 'توب' ||
        content === 'التوب' ||
        content.toLowerCase() ===
          'top' ||
        content.toLowerCase() ===
          '/top' ||
        /^توب\s+[1-5]$/i.test(
          content
        )
      ) {
        let page = 1;

        const match =
          content.match(
            /^توب\s+([1-5])$/i
          );

        if (match) {
          page =
            Number(
              match[1]
            );
        }

        const fake = {
          reply:
            payload =>
              message.channel.send(
                payload
              ),
          options: {
            getInteger:
              () => page
          }
        };

        return sendTop(
          fake,
          message.guild,
          message.channel
        );
      }

      const transferMatch =
        content.match(
          /^(?:تحويل|تحويل رصيد)\s+<@!?([0-9]{17,20})>\s+(\S+)$/i
        );

      if (transferMatch) {
        const targetId =
          transferMatch[1];

        const amountText =
          transferMatch[2];

        if (
          targetId ===
          message.author.id
        ) {
          return message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  '#D4AC0D'
                )
                .setDescription(
                  '❌ لا يمكنك التحويل لنفسك.'
                )
            ]
          });
        }

        const target =
          await message.guild.members
            .fetch(targetId)
            .catch(
              () => null
            );

        if (!target) {
          return message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  '#D4AC0D'
                )
                .setDescription(
                  '❌ العضو غير موجود في السيرفر.'
                )
            ]
          });
        }

        if (
          target.user.bot
        ) {
          return message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  '#D4AC0D'
                )
                .setDescription(
                  '❌ لا يمكنك التحويل إلى بوت.'
                )
            ]
          });
        }

        const sender =
          ensureUser(
            db,
            message.guild.id,
            message.author.id
          );

        let amount;

        if (
          amountText ===
          'كامل'
        ) {
          amount =
            sender.balance;
        } else if (
          amountText ===
          'نص'
        ) {
          amount =
            Math.floor(
              sender.balance /
                2
            );
        } else {
          amount =
            parseAmount(
              amountText
            );
        }

        if (
          !Number.isFinite(
            amount
          ) ||
          amount <= 0
        ) {
          return message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  '#D4AC0D'
                )
                .setDescription(
                  '❌ اكتب مبلغًا صالحًا مثل `1000` أو `10k` أو `نص` أو `كامل`.'
                )
            ]
          });
        }

        if (
          sender.balance <
          amount
        ) {
          return message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  '#D4AC0D'
                )
                .setDescription(
                  '❌ ليس لديك رصيد كافٍ لإتمام التحويل.'
                )
            ]
          });
        }

        const receiver =
          ensureUser(
            db,
            message.guild.id,
            targetId
          );

        sender.balance -=
          amount;

        receiver.balance +=
          amount;

        saveDB(db);

        return message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(
                '#D4AC0D'
              )
              .setDescription(
                `✅ تم تحويل **${formatAmount(amount)} 𝐎𝐏𝐬** إلى ${target}.`
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
        !interaction.isChatInputCommand() ||
        !interaction.guild
      ) {
        return;
      }

      const db =
        loadDB();

      const guild =
        interaction.guild;

      if (
        interaction.commandName ===
        'currency'
      ) {
        if (
          !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
          )
        ) {
          return interaction.reply({
            content:
              '❌ هذا الأمر مخصص للإداريين فقط.',
            ephemeral: true
          });
        }

        const config =
          ensureGuild(
            db,
            guild.id
          );

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub === 'enable'
        ) {
          config.economyChannelId =
            interaction.channel.id;

          saveDB(db);

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  '#D4AC0D'
                )
                .setDescription(
                  `✅ تم تفعيل نظام العملة في ${interaction.channel}.`
                )
            ]
          });
        }

        if (
          sub === 'disable'
        ) {
          config.economyChannelId =
            null;

          saveDB(db);

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  '#D4AC0D'
                )
                .setDescription(
                  '✅ تم تعطيل نظام العملة في السيرفر.'
                )
            ]
          });
        }
      }

      if (
        interaction.commandName ===
        'daily'
      ) {
        const member =
          await guild.members
            .fetch(
              interaction.user.id
            )
            .catch(
              () =>
                interaction.member
            );

        return claimDaily({
          guild,
          user:
            interaction.user,
          member,
          reply:
            payload =>
              interaction.reply(
                payload
              )
        });
      }

      if (
        interaction.commandName ===
        'top'
      ) {
        return sendTop(
          interaction,
          guild,
          interaction.channel
        );
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
  }
);

function saveBeforeExit() {
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
}

process.on(
  'SIGINT',
  () => {
    saveBeforeExit();
    process.exit(0);
  }
);

process.on(
  'SIGTERM',
  () => {
    saveBeforeExit();
    process.exit(0);
  }
);

process.on(
  'unhandledRejection',
  error =>
    console.error(
      '❌ Unhandled Rejection:',
      error
    )
);

process.on(
  'uncaughtException',
  error =>
    console.error(
      '❌ Uncaught Exception:',
      error
    )
);

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