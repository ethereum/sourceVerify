import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, "..", "environments/.env") });

export default {
    monitor: {
        port: process.env.MONITOR_PORT || 80
    },
    ui: {
        port: process.env.UI_PORT || 1234
    },
    server: {
        port: process.env.SERVER_PORT || 5000,
        url: process.env.SERVER_URL || "http://localhost:5000"
    },
    localchain: {
        port: process.env.LOCALCHAIN_PORT || 8545,
        url: process.env.LOCALCHAIN_URL,
    },
    repository: {
        port: process.env.REPOSITORY_PORT || 80,
        path: process.env.MOCK_REPOSITORY || path.resolve(__dirname, process.env.REPOSITORY_PATH!) || path.resolve(__dirname, './repository'),
        dbPath: process.env.MOCK_DATABASE || path.resolve(__dirname, process.env.DATABASE_PATH!) || path.resolve(__dirname, './database')
    },
    mq: {
        username: process.env.RABBITMQUSERNAME,
        password: process.env.RABBITMQPASSWORD
    },
    testing: process.env.TESTING || false,
    tag: process.env.TAG || 'latest',
    endpoint: {
        infuraId: process.env.INFURA_ID,
        ethereumNode: process.env.ETHEREUM_NODE
    },
    logging: {
        dir: process.env.LOGGING_DIR || 'logs',
        level: process.env.LOGGING_LEVEL || 'debug'
    }
}
