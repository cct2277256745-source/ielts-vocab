// IELTS 词汇查询 app —— 浏览器兼容服务端

const { createHttpServer, DEFAULT_ENV_PATH, getConfig, loadEnv } = require("./core");

loadEnv({ envPath: DEFAULT_ENV_PATH });

const config = getConfig({ envPath: DEFAULT_ENV_PATH });
const server = createHttpServer({ envPath: DEFAULT_ENV_PATH, port: config.port });

server.listen(config.port, "127.0.0.1", () => {
  console.log(`\n  雅思词汇查询服务已启动 →  http://localhost:${config.port}\n`);
});
