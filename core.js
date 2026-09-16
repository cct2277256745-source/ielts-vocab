const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const childProcess = require("child_process");

const PROJECT_DIR = __dirname;
const DEFAULT_ENV_PATH = path.join(PROJECT_DIR, ".env");
const DEFAULT_ENV_EXAMPLE_PATH = path.join(PROJECT_DIR, ".env.example");
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

function readEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function loadEnv({ envPath = DEFAULT_ENV_PATH, override = false } = {}) {
  const env = readEnvFile(envPath);
  for (const [key, value] of Object.entries(env)) {
    if (override || !process.env[key]) process.env[key] = value;
  }
  return env;
}

function ensureEnvFile({ envPath = DEFAULT_ENV_PATH, templatePath = DEFAULT_ENV_EXAMPLE_PATH } = {}) {
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  if (fs.existsSync(envPath)) return { envPath, created: false };
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, "utf8")
    : "DEEPSEEK_API_KEY=在这里粘贴你的key\n";
  fs.writeFileSync(envPath, template, "utf8");
  return { envPath, created: true };
}

function getConfig({ envPath = DEFAULT_ENV_PATH } = {}) {
  const fileEnv = readEnvFile(envPath);
  const pick = (key) => fileEnv[key] || process.env[key] || "";
  return {
    envPath,
    apiKey: pick("DEEPSEEK_API_KEY") || pick("ANTHROPIC_API_KEY"),
    model: pick("IELTS_MODEL") || DEFAULT_MODEL,
    port: Number(pick("PORT") || 5179),
    baseUrl: (pick("BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

function cleanEnvValue(value) {
  return String(value == null ? "" : value).replace(/[\r\n]/g, "").trim();
}

function writeEnvValues(envPath, values) {
  ensureEnvFile({ envPath });
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split("\n") : [];
  const pending = { ...values };
  const next = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/);
    if (!m || !Object.prototype.hasOwnProperty.call(pending, m[2])) return line;
    const value = pending[m[2]];
    delete pending[m[2]];
    return `${m[1]}${m[2]}${m[3]}${value}`;
  });

  for (const [key, value] of Object.entries(pending)) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, next.join("\n").replace(/\n*$/, "\n"), "utf8");
}

function saveApiConfig({ envPath = DEFAULT_ENV_PATH, apiKey, model, baseUrl } = {}) {
  const values = {};
  if (apiKey !== undefined) values.DEEPSEEK_API_KEY = cleanEnvValue(apiKey);
  if (model !== undefined) values.IELTS_MODEL = cleanEnvValue(model) || DEFAULT_MODEL;
  if (baseUrl !== undefined) values.BASE_URL = (cleanEnvValue(baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");

  writeEnvValues(envPath, values);
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return getConfig({ envPath });
}

function getPublicConfig({ envPath = DEFAULT_ENV_PATH } = {}) {
  const config = getConfig({ envPath });
  return {
    envPath: config.envPath,
    apiKeyConfigured: Boolean(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
  };
}

const SYSTEM_PROMPT = `你是一位资深的雅思(IELTS)口语与写作考官,同时是英语词汇学专家。用户会给你一个英语单词,你要为雅思考生做全面分析。

要求:
- "too_basic":判断该词对雅思写作而言是否过于基础、口水化(如 good, bad, important, big, thing, get, very, nice, a lot 这类)。若是,设为 true;否则 false。
- "upgrades":当 too_basic 为 true 时,给正好 3 个能在写作中替代它、更高级更地道的"大词/高分表达",每个含 word(替代词或短语)和 note(中文说明:它的语气/适用语境/比原词好在哪)。当 too_basic 为 false 时,设为空数组 []。
- "skills" 中分别评估该词在【口语 speaking / 写作 writing / 听力 listening / 阅读 reading】里的:frequency(常见或常用程度 1-5)、idiomatic(用在该技能里地不地道 1-5)、comment(一句中文点评,说明为什么)。注意四项要有区分度:很多词在写作/阅读常见但口语里说出来很生硬,要如实反映。
- "meanings" 按常用度从高到低列出释义,每条给词性、英文释义、中文释义。
- "collocations":列出该词在【雅思写作】中最高频、最地道的 3 个搭配组合(动词+该词 / 该词+名词 / 形容词+该词 等真实搭配),每个含 phrase(英文搭配)和 zh(中文意思及用法说明)。
- "speaking_examples" 给 3 句口语例句,分别对应雅思口语 7 分、8 分、9 分水平(逐句升级:词汇更高级、句式更复杂多样、衔接更自然地道、表达更精准),每句含 band(7/8/9 整数)、en(英文)、zh(中文翻译)。
- "writing_examples" 给 3 句学术/书面例句,分别对应雅思写作 7 分、8 分、9 分水平(逐句升级:用词更精准、句式更丰富、逻辑更严密、更符合考官高分预期),每句含 band(7/8/9 整数)、en(英文)、zh(中文翻译)。
- "best_usage" 用中文归纳该词在口语、写作中最常见、最地道、最能加分的用法(点明高分搭配、句型、注意事项)。
- "synonyms" 给 3-5 个近义词,逐个用中文辨析它与查询词在语体、搭配、语气、雅思场景上的区别。

务必只输出一个 JSON 对象(不要 markdown 代码块、不要任何解释文字),严格符合以下结构:
{
  "word": "字符串,单词原形",
  "pronunciation": "英式音标,如 /ˌnevəðəˈles/",
  "too_basic": true 或 false,
  "upgrades": [ { "word": "高级替代词/短语", "note": "中文说明" } ],
  "skills": {
    "speaking":  { "frequency": 1-5整数, "idiomatic": 1-5整数, "comment": "中文一句" },
    "writing":   { "frequency": 1-5整数, "idiomatic": 1-5整数, "comment": "中文一句" },
    "listening": { "frequency": 1-5整数, "idiomatic": 1-5整数, "comment": "中文一句" },
    "reading":   { "frequency": 1-5整数, "idiomatic": 1-5整数, "comment": "中文一句" }
  },
  "meanings": [ { "pos": "词性如 adv.", "en": "英文释义", "zh": "中文释义" } ],
  "collocations": [ { "phrase": "英文写作高频搭配", "zh": "中文意思/用法" } ],
  "speaking_examples": [ { "band": 7, "en": "口语英文例句", "zh": "中文翻译" }, { "band": 8, "en": "...", "zh": "..." }, { "band": 9, "en": "...", "zh": "..." } ],
  "writing_examples": [ { "band": 7, "en": "写作英文例句", "zh": "中文翻译" }, { "band": 8, "en": "...", "zh": "..." }, { "band": 9, "en": "...", "zh": "..." } ],
  "best_usage": { "speaking": "中文讲解", "writing": "中文讲解" },
  "synonyms": [ { "word": "近义词", "distinction": "中文辨析" } ]
}
所有讲解性文字用中文,例句和英文释义用英文。frequency 与 idiomatic 必须是 1 到 5 的整数。collocations 正好 3 个;speaking_examples 和 writing_examples 各正好 3 句,band 依次为 7、8、9;too_basic 为 true 时 upgrades 正好 3 个。`;

async function lookupWord(word, { envPath = DEFAULT_ENV_PATH, apiKey, model, baseUrl } = {}) {
  const config = getConfig({ envPath });
  if (apiKey !== undefined) config.apiKey = cleanEnvValue(apiKey);
  if (model !== undefined) config.model = cleanEnvValue(model) || DEFAULT_MODEL;
  if (baseUrl !== undefined) config.baseUrl = (cleanEnvValue(baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!config.apiKey) throw new Error("请先在模型设置中填写 API Key");

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `请分析这个单词: ${word}` },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek API ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error("模型未返回内容");

  try {
    return JSON.parse(content);
  } catch (e) {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("模型返回的不是合法 JSON");
  }
}

async function testApiConnection({ envPath = DEFAULT_ENV_PATH, apiKey, model, baseUrl } = {}) {
  const config = getConfig({ envPath });
  if (apiKey !== undefined) config.apiKey = cleanEnvValue(apiKey);
  if (model !== undefined) config.model = cleanEnvValue(model) || DEFAULT_MODEL;
  if (baseUrl !== undefined) config.baseUrl = (cleanEnvValue(baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!config.apiKey) throw new Error("请先在模型设置中填写 API Key");

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 8,
      temperature: 0,
      messages: [{ role: "user", content: "请只回复：连接成功" }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`模型接口返回 ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  if (!data || !Array.isArray(data.choices) || !data.choices[0]) {
    throw new Error("模型接口未返回有效结果");
  }
  return { ok: true, model: config.model };
}

function crc32(buf) {
  if (!crc32.t) {
    crc32.t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.t[n] = c >>> 0;
    }
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32.t[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function makeZip(files) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralBuf, end]);
}

function fieldChecksum(str) {
  const stripped = String(str).replace(/<[^>]+>/g, "");
  return parseInt(crypto.createHash("sha1").update(stripped, "utf8").digest("hex").slice(0, 8), 16);
}

function ankiGuid() {
  const cs = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return s;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlInsert(table, values) {
  return `INSERT INTO ${table} VALUES (${values.map(sqlValue).join(",")});`;
}

function buildApkg(cards, deckName) {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const MID = 1685000000000;
  const DID = 1685000000111;

  const css = ".card{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:22px;" +
    "text-align:center;color:#1b1f2a;background:#fff;padding:20px}" +
    ".w{font-size:34px;font-weight:800}.m{margin-top:6px;color:#333;font-size:20px}" +
    ".k{margin-top:14px;color:#b45309;font-weight:700;font-size:16px}hr#answer{margin:16px 0;border:none;border-top:1px solid #e5e7eb}";

  const models = {
    [MID]: {
      id: MID, name: "IELTS 单词", type: 0, mod: nowSec, usn: -1, sortf: 0, did: DID,
      tmpls: [{
        name: "Card 1", ord: 0,
        qfmt: '<div class="w">{{单词}}</div>',
        afmt: '<div class="w">{{单词}}</div><hr id=answer><div class="m">{{中文释义}}</div>{{#重点}}<div class="k">{{重点}}</div>{{/重点}}',
        bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0,
      }],
      flds: [
        { name: "单词", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
        { name: "中文释义", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
        { name: "重点", ord: 2, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      ],
      css, latexPre: "\\documentclass[12pt]{article}\n\\begin{document}\n", latexPost: "\\end{document}",
      latexsvg: false, req: [[0, "any", [0]]], tags: [], vers: [],
    },
  };

  const deckCommon = {
    lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false,
    browserCollapsed: false, desc: "", dyn: 0, conf: 1, extendNew: 0, extendRev: 0, usn: -1,
  };
  const decks = {
    1: Object.assign({ id: 1, name: "Default", mod: 0 }, deckCommon),
    [DID]: Object.assign({ id: DID, name: deckName || "雅思生词本", mod: nowSec }, deckCommon),
  };
  const dconf = {
    1: {
      id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
      new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
      rev: { bury: false, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 }, dyn: false,
    },
  };
  const conf = {
    nextPos: cards.length + 1, estTimes: true, activeDecks: [DID], sortType: "noteFld", timeLim: 0,
    sortBackwards: false, addToCur: true, curDeck: DID, newBury: true, newSpread: 0, dueCounts: true,
    curModel: String(MID), collapseTime: 1200,
  };

  const tmp = path.join(os.tmpdir(), `anki-${now}-${Math.floor(Math.random() * 1e6)}.anki2`);
  const schemaSql = `
    CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
    CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);
    CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
    CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);
    CREATE TABLE graves (usn integer, oid integer, type integer);
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_revlog_cid on revlog (cid);
    CREATE INDEX ix_notes_csum on notes (csum);
  `;

  const colValues = [
    1, nowSec, now, now, 11, 0, 0, 0,
    JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf), "{}",
  ];
  const noteRows = [];
  const cardRows = [];
  cards.forEach((c, i) => {
    const nid = now + i;
    const cid = now + cards.length + 1 + i;
    const word = String(c.word || "");
    const keyMark = c.key ? "★ 重点" : "";
    const flds = [word, String(c.meaning || ""), keyMark].join("\x1f");
    noteRows.push([nid, ankiGuid(), MID, nowSec, -1, c.key ? "重点" : "", flds, word, fieldChecksum(word), 0, ""]);
    cardRows.push([cid, nid, DID, 0, nowSec, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
  });

  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(tmp);
    db.exec(schemaSql);
    db.prepare("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...colValues);

    const insNote = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const insCard = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    noteRows.forEach((row) => insNote.run(...row));
    cardRows.forEach((row) => insCard.run(...row));
    db.close();
  } catch (e) {
    if (!/node:sqlite|No such built-in module|Cannot find module/.test(String(e && e.message))) throw e;
    const sql = [
      "PRAGMA journal_mode=OFF;",
      "BEGIN;",
      schemaSql,
      sqlInsert("col", colValues),
      ...noteRows.map((row) => sqlInsert("notes", row)),
      ...cardRows.map((row) => sqlInsert("cards", row)),
      "COMMIT;",
    ].join("\n");
    const result = childProcess.spawnSync("sqlite3", [tmp], { input: sql, encoding: "utf8" });
    if (result.status !== 0) {
      const detail = result.stderr || result.stdout || "sqlite3 command failed";
      throw new Error(`无法生成 Anki 数据库:${detail}`);
    }
  }

  const anki2 = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return makeZip([
    { name: "collection.anki2", data: anki2 },
    { name: "media", data: Buffer.from("{}", "utf8") },
  ]);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function getLookupConfig(body) {
  const config = body && body.config && typeof body.config === "object" ? body.config : {};
  const overrides = {};
  if (cleanEnvValue(config.apiKey)) overrides.apiKey = config.apiKey;
  if (cleanEnvValue(config.model)) overrides.model = config.model;
  if (cleanEnvValue(config.baseUrl)) overrides.baseUrl = config.baseUrl;
  return overrides;
}

function createHttpServer({ envPath = DEFAULT_ENV_PATH, indexPath = path.join(PROJECT_DIR, "index.html"), port } = {}) {
  const currentPort = port || getConfig({ envPath }).port;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${currentPort}`);

    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(indexPath));
      return;
    }

    if (url.pathname === "/icon.png") {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      res.end(fs.readFileSync(path.join(PROJECT_DIR, "icon.png")));
      return;
    }

    if (url.pathname === "/api/config" && req.method === "GET") {
      writeJson(res, 200, getPublicConfig({ envPath }));
      return;
    }

    if (url.pathname === "/api/config" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        saveApiConfig({ envPath, apiKey: body && body.apiKey, model: body && body.model, baseUrl: body && body.baseUrl });
        writeJson(res, 200, getPublicConfig({ envPath }));
      } catch (e) {
        writeJson(res, 400, { error: "设置保存失败，请检查模型设置" });
      }
      return;
    }

    if (url.pathname === "/api/config-form" && req.method === "POST") {
      try {
        const form = new URLSearchParams(await readBody(req));
        saveApiConfig({
          envPath,
          apiKey: form.get("apiKey") || "",
          model: form.get("model") || "",
          baseUrl: form.get("baseUrl") || "",
        });
        res.writeHead(303, { location: "/" });
        res.end();
      } catch (e) {
        writeJson(res, 400, { error: "设置保存失败，请检查模型设置" });
      }
      return;
    }

    if (url.pathname === "/api/test-connection" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const result = await testApiConnection({ envPath, ...getLookupConfig(body) });
        writeJson(res, 200, result);
      } catch (e) {
        const message = String(e && e.message ? e.message : e);
        const status = /请先在模型设置中填写 API Key/.test(message) ? 400 : 502;
        writeJson(res, status, { error: message });
      }
      return;
    }

    if (url.pathname === "/api/lookup" && (req.method === "GET" || req.method === "POST")) {
      let body = {};
      if (req.method === "POST") {
        try {
          body = JSON.parse((await readBody(req)) || "{}");
        } catch (e) {
          writeJson(res, 400, { error: "请求格式不正确" });
          return;
        }
      }
      const word = String(req.method === "POST" ? body.word || "" : url.searchParams.get("word") || "").trim();
      if (!word) {
        writeJson(res, 400, { error: "请输入单词" });
        return;
      }

      try {
        const result = await lookupWord(word, { envPath, ...getLookupConfig(body) });
        writeJson(res, 200, result);
      } catch (e) {
        const status = /请先在模型设置中填写 API Key/.test(String(e && e.message)) ? 400 : 502;
        writeJson(res, status, { error: String(e.message || e) });
      }
      return;
    }

    if (url.pathname === "/api/apkg" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const cards = (body.cards || []).filter((c) => c && c.word);
        if (!cards.length) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "没有可导出的单词" }));
          return;
        }

        const deckName = body.deck || "雅思生词本";
        const buf = buildApkg(cards, deckName);
        const fname = encodeURIComponent(deckName + ".apkg");
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename*=UTF-8''${fname}`,
        });
        res.end(buf);
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });
}

module.exports = {
  PROJECT_DIR,
  DEFAULT_ENV_PATH,
  DEFAULT_ENV_EXAMPLE_PATH,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  loadEnv,
  ensureEnvFile,
  getConfig,
  getPublicConfig,
  saveApiConfig,
  lookupWord,
  testApiConnection,
  buildApkg,
  createHttpServer,
};
