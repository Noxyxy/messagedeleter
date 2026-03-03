const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// --- 設定ファイルのパス設定 ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
const SETTINGS_PATH = path.join(__dirname, 'usersettings.json');

// 1. config.json からトークンを取得
if (!fs.existsSync(CONFIG_PATH)) {
    console.error('エラー: config.json が見つかりません。');
    process.exit(1);
}
const { token } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// 2. usersettings.json の読み書き関数
function loadUserSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        }
    } catch (err) {
        console.error("設定の読み込み失敗:", err);
    }
    return {};
}

function saveUserSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
        console.error("設定の保存失敗:", err);
    }
}

// --- ボット本体の設定 ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const commands = [
    new SlashCommandBuilder()
        .setName('ad')
        .setDescription('自動消去の切り替え (引数なしでON/OFF反転)')
        .addStringOption(option =>
            option.setName('status')
                .setDescription('オンかオフを明示的に選択')
                .setRequired(false)
                .addChoices(
                    { name: 'オン', value: 'on' },
                    { name: 'オフ', value: 'off' },
                ))
        .addIntegerOption(option =>
            option.setName('seconds')
                .setDescription('秒数を変更する場合に入力')
                .setRequired(false)
                .setMinValue(1)),
    
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('現在の設定を確認'),
].map(command => command.toJSON());

// 起動時の処理
client.once(Events.ClientReady, async (c) => {
    console.log(`${c.user.tag} でログインしました。`);
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
        console.log('スラッシュコマンドを登録しました。');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }
});

// コマンドの実行 (設定の保存)
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ad') {
        const statusInput = interaction.options.getString('status');
        const secondsInput = interaction.options.getInteger('seconds');
        const userId = interaction.user.id;

        const allSettings = loadUserSettings();
        // 現在の設定（未設定ならデフォルトを作成）
        const currentConfig = allSettings[userId] || { enabled: false, delay: 120 };

        let nextEnabled;
        // 秒数は、入力があればそれ、なければ現在の設定を引き継ぐ
        let finalDelay = secondsInput !== null ? secondsInput : currentConfig.delay;

        // --- ON/OFFの決定ロジック ---
        if (statusInput) {
            // 'on' または 'off' が明示されている場合
            nextEnabled = (statusInput === 'on');
        } else {
            // 引数がない場合は反転（トグル）
            nextEnabled = !currentConfig.enabled;
        }

        // 保存（オフにしても秒数は finalDelay = 現状維持 で残る）
        allSettings[userId] = { enabled: nextEnabled, delay: finalDelay };
        saveUserSettings(allSettings);

        const statusText = nextEnabled ? `**オン** (${finalDelay}秒後に削除)` : `**OFF** (設定は保存中**（${finalDelay}秒）**)`;
        await interaction.reply({
            content: `自動消去を ${statusText} にしました。`,
            ephemeral: true 
        });

    } else if (interaction.commandName === 'status') {
        const userId = interaction.user.id;
        const allSettings = loadUserSettings();
        const userConfig = allSettings[userId];

        // 状態がわかりやすいように絵文字を追加
        const response = userConfig 
            ? `${userConfig.enabled ? '✅ 有効' : '❌ 無効'} (設定秒数: ${userConfig.delay}秒)`
            : '⚠️ 未設定';

        await interaction.reply({
            content: `あなたの自動消去設定: ${response}`,
            ephemeral: true
        });
    }
});

// メッセージ消去の判定
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const allSettings = loadUserSettings();
    const userConfig = allSettings[message.author.id];

    if (userConfig && userConfig.enabled) {
        setTimeout(async () => {
            try {
                if (message.deletable) {
                    await message.delete();
                }
            } catch (error) {
                if (error.code !== 10008) { // すでに消えている場合はエラーを出さない
                    console.error('削除失敗:', error);
                }
            }
        }, userConfig.delay * 1000);
    }
});

client.login(token);