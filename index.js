const axios = require("axios");
const fs = require("fs");
const readline = require("readline");
const querystring = require("querystring");

const BASE_URL = "https://tonclayton.fun";

async function readFileLines(filePath) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const lines = [];
    for await (const line of rl) {
        if (line.trim()) lines.push(line.trim());
    }
    return lines;
}

function createApiClient(initData, proxy) {
    const axiosConfig = {
        baseURL: BASE_URL,
        headers: {
            Host: "tonclayton.fun",
            "Init-Data": initData,
            Origin: BASE_URL,
            Referer: `${BASE_URL}/games/game-512`,
        },
    };

    if (proxy) {
        const [protocol, proxyUrl] = proxy.split("://");
        const [auth, hostPort] = proxyUrl.split("@");
        const [username, password] = auth.split(":");
        const [host, port] = hostPort.split(":");

        axiosConfig.proxy = { protocol, host, port, auth: { username, password } };
    }

    return axios.create(axiosConfig);
}

function log(message, color = "white") {
    const timestamp = new Date().toLocaleTimeString();
    const colors = {
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
    };
    console.log(colors[color] +`[${timestamp}] ` + message + "\x1b[0m");
}

async function safeRequest(api, method, url, data = {}, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await api[method](url, data);
            return response.data;
        } catch (error) {
            const statusCode = error.response?.status;

            if (statusCode === 409) {
                log(`Conflict error (409): ${error.response.data.message}`, "yellow");
                return;
            }

            if (statusCode === 500) {
                log("Tasks are not available at the moment", "yellow");
                return;
            }

            if (statusCode === 429) {
                log("Too many requests, retrying...", "white");
                await wait(60000);
                continue;
            }

            if (attempt < retries - 1 && statusCode >= 500) {
                log(`Retrying request... Attempt ${attempt + 1}`, "white");
                await wait(5000);
            } else {
                log(`Request failed: ${error.message}`, "red");
                throw error;
            }
        }
    }
}

const apiFunctions = {
    login: (api) => safeRequest(api, "post", "/api/user/auth"),
    claimDailyReward: (api) => safeRequest(api, "post", "/api/user/daily-claim"),
    getPartnerTasks: (api) => safeRequest(api, "get", "/api/tasks/partner-tasks"),
    getDailyTasks: (api) => safeRequest(api, "get", "/api/tasks/daily-tasks"),
    getOtherTasks: (api) => safeRequest(api, "get", "/api/tasks/default-tasks", {}),
    completeTask: (api, taskId) => safeRequest(api, "post", `/api/tasks/complete`, { task_id: taskId }),
    claimTaskReward: (api, taskId) => safeRequest(api, "post", `/api/tasks/claim`, { task_id: taskId }),
    playGame: async (api, gameName) => {
        await safeRequest(api, "post", "/api/game/start");
        await playGameWithProgress(api, gameName);
    },
};

async function playGameWithProgress(api, gameName) {
    const tileSequence = [2, 4, 8, 16, 32, 64, 128, 256];
    for (let i = 0; i < tileSequence.length; i++) {
        log(`Playing ${gameName} game...`, "cyan");
        log(`\r\x1b[36m${gameName} game progress: ${i + 1}/${tileSequence.length} `);
        await wait(10000);
        await safeRequest(api, "post", "/api/game/save-tile", { maxTile: tileSequence[i] });
        log(`Tile saved: ${tileSequence[i]}`, "cyan");
    }

    process.stdout.write(`\r\x1b[36m${gameName} game finished!\x1b[0m\n`);
    return await safeRequest(api, "post", "/api/game/over", { multiplier: 1 });
}

async function processAccount(initData, firstName, proxy) {
    try {  
        const api = createApiClient(initData, proxy);
        let loginData = await apiFunctions.login(api);
        log(`[Tài Khoản: ${firstName}] Đăng nhập thành công !`, "green");

        if (loginData.dailyReward.can_claim_today && loginData.dailyReward.is_subscribed) {
            await apiFunctions.claimDailyReward(api);
            log(`[Tài Khoản: ${firstName}] Daily reward đã thu thập.`, "yellow");
        } else {
            log(`[Tài Khoản: ${firstName}] Daily reward không có sẵn hoặc đã thu thập`, "yellow");
        }

        await processTasks(api, apiFunctions.getPartnerTasks, "partner", firstName);
        await processTasks(api, apiFunctions.getDailyTasks, "daily", firstName);
        await processTasks(api, apiFunctions.getOtherTasks, "other", firstName);

        loginData = await apiFunctions.login(api);
        const dailyAttempts = loginData.user.daily_attempts;
        log(`[Tài Khoản: ${firstName}] Số lượt chơi: ${dailyAttempts}`, "cyan");

        for (let i = 1; i <= dailyAttempts; i++) {
            await apiFunctions.playGame(api, "1024");
            log(`[Tài Khoản: ${firstName}] 1024 game ${i} Done`, "green");
        }

        log(`[Tài Khoản: ${firstName}] Đã xong !`, "green");
    } catch (error) {
        log(`[Tài Khoản: ${firstName}] Error: ${error.message}`, "red");
    }
}

async function processTasks(api, taskGetter, taskType, firstName) {
    log(`[Tài Khoản: ${firstName}] Đang kiểm tra ${taskType} tasks...`, "cyan");

    let tasks = await taskGetter(api);

    if (Array.isArray(tasks)) {
        for (const task of tasks) {
            const { is_completed, is_claimed, task_id, task: taskDetails } = task;

            if (task_id === 2) {
                continue;
            }

            if (!is_completed && !is_claimed) {
                log(`[Tài Khoản: ${firstName}] Đang hoàn thành ${taskType} task: ${taskDetails.title} (ID: ${task_id})`, "yellow");
                const completeResult = await apiFunctions.completeTask(api, task_id);
                log(`[Tài Khoản: ${firstName}] ${completeResult.message}`, "green");
            } else {
                log(`[Tài Khoản: ${firstName}] ${taskType} Đã thu thập từ trước: ${taskDetails.title} (ID: ${task_id})`, "yellow");
            }
        }

        tasks = await taskGetter(api);

        for (const task of tasks) {
            const { is_completed, is_claimed, task_id, task: taskDetails } = task;

            if (is_completed && !is_claimed) {
                log(`[Tài Khoản: ${firstName}] Thu thập ${taskType} task: ${taskDetails.title} (ID: ${task_id})`, "yellow");
                const claimResult = await apiFunctions.claimTaskReward(api, task_id);
                log(`[Tài Khoản: ${firstName}] ${claimResult.message}`, "green");
                log(`[Tài Khoản: ${firstName}] Đã thu thập: ${claimResult.reward_tokens}`);
            }
        }
    } else {
        log(`[Tài Khoản: ${firstName}] Not available ${taskType} tasks`, "yellow");
    }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


async function main() {
    const tokens = await readFileLines("data.txt");
    const proxies = await readFileLines("proxy.txt");
    const promies = [];
    for (let i = 0; i < tokens.length; i++) {
        const initData = tokens[i];
        let proxy = proxies[i] || null;
        const firstName = JSON.parse(decodeURIComponent(querystring.parse(initData).user))?.first_name;
        promies.push(processAccount(initData, firstName, proxy));
    }
}

main();
