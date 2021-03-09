import { cborDecode, getMonitoredChains, MonitorConfig, CheckedContract, FileService, IFileService } from "@ethereum-sourcify/core";
import { Injector } from "@ethereum-sourcify/verification";
import Logger from "bunyan";
import Web3 from "web3";
import { Transaction } from "web3-core";
import { SourceAddress } from "./util";
import { ethers } from "ethers";
import dotenv from 'dotenv';
import path from 'path';
import SourceFetcher from "./source-fetcher";
import SystemConfig from '../config';
import assert from 'assert';
dotenv.config({ path: path.resolve(__dirname, "..", "..", "environments/.env") });

const BLOCK_PAUSE_FACTOR = parseInt(process.env.BLOCK_PAUSE_FACTOR) || 1.1;
assert(BLOCK_PAUSE_FACTOR > 1);
const BLOCK_PAUSE_UPPER_LIMIT = parseInt(process.env.BLOCK_PAUSE_UPPER_LIMIT) || (30 * 1000); // default: 30 seconds
const BLOCK_PAUSE_LOWER_LIMIT = parseInt(process.env.BLOCK_PAUSE_LOWER_LIMIT) || (0.5 * 1000); // default: 0.5 seconds

function createsContract(tx: Transaction): boolean {
    return !tx.to;
}

/**
 * A monitor that periodically checks for new contracts on a single chain.
 */
class ChainMonitor {
    private chainId: string;
    private web3Provider: Web3;
    private sourceFetcher: SourceFetcher;
    private logger: Logger;
    private injector: Injector;
    private fileService: IFileService;
    private running: boolean;

    private getBytecodeRetryPause: number;
    private getBlockPause: number;
    private initialGetBytecodeTries: number;

    constructor(name: string, chainId: string, web3Url: string, sourceFetcher: SourceFetcher, injector: Injector, fileService: IFileService) {
        this.chainId = chainId;
        this.web3Provider = new Web3(web3Url);
        this.sourceFetcher = sourceFetcher;
        this.logger = new Logger({ name });
        this.injector = injector;
        this.fileService = fileService;

        this.getBytecodeRetryPause = parseInt(process.env.GET_BYTECODE_RETRY_PAUSE) || (5 * 1000);
        this.getBlockPause = parseInt(process.env.GET_BLOCK_PAUSE) || (10 * 1000);
        this.initialGetBytecodeTries = parseInt(process.env.INITIAL_GET_BYTECODE_TRIES) || 3;
    }

    start = async (): Promise<void> => {
        this.running = true;
        const rawStartBlock = process.env[`MONITOR_START_${this.chainId}`];
        const startBlock = (rawStartBlock !== undefined) ?
            parseInt(rawStartBlock) : await this.web3Provider.eth.getBlockNumber();
        this.processBlock(startBlock);
        this.logger.info({ loc: "[MONITOR:START]", startBlock });
    }

    /**
     * Stops the monitor after executing all pending requests.
     */
    stop = (): void => {
        this.logger.info({ loc: "[MONITOR:STOP]" }, "Monitor will be stopped after pending calls finish.");
        this.running = false;
    }

    private processBlock = (blockNumber: number) => {
        this.web3Provider.eth.getBlock(blockNumber, true).then(block => {
            if (!block) {
                this.adaptBlockPause("increase");

                const logObject = { loc: "[PROCESS_BLOCK]", blockNumber, getBlockPause: this.getBlockPause };
                this.logger.info(logObject, "Waiting for new blocks");
                return;
            }

            this.adaptBlockPause("decrease");

            for (const tx of block.transactions) {
                if (createsContract(tx)) {
                    const address = ethers.utils.getContractAddress(tx);
                    if (this.isVerified(address)) {
                        this.logger.info({ loc: "[PROCESS_ADDRESS:SKIP]", address }, "Already verified");
                    } else {
                        this.logger.info({ loc: "[PROCESS_ADDRESS]", address }, "New contract");
                        this.processBytecode(address, this.initialGetBytecodeTries);
                    }
                }
            }

            blockNumber++;

        }).catch(err => {
            this.logger.error({ loc: "[PROCESS_BLOCK:FAILED]", blockNumber }, err.message);
        }).finally(() => {
            this.mySetTimeout(this.processBlock, this.getBlockPause, blockNumber);
        });
    }

    private isVerified(address: string): boolean {
        try {
            this.fileService.findByAddress(this.chainId, address, this.fileService.repositoryPath);
            return true;
        } catch(err) {
            return false;
        }
    }

    private adaptBlockPause = (operation: "increase" | "decrease") => {
        const factor = (operation === "increase") ? BLOCK_PAUSE_FACTOR : (1 / BLOCK_PAUSE_FACTOR);
        this.getBlockPause *= factor;
        this.getBlockPause = Math.min(this.getBlockPause, BLOCK_PAUSE_UPPER_LIMIT);
        this.getBlockPause = Math.max(this.getBlockPause, BLOCK_PAUSE_LOWER_LIMIT);
    }

    private processBytecode = (address: string, retriesLeft: number): void => {
        if (retriesLeft-- <= 0) {
            return;
        }

        this.web3Provider.eth.getCode(address).then(bytecode => {
            if (bytecode === "0x") {
                this.logger.info({ loc: "[PROCESS_BYTECODE]", address, retriesLeft }, "Empty bytecode");
                this.mySetTimeout(this.processBytecode, this.getBytecodeRetryPause, address, retriesLeft);
                return;
            }

            const numericBytecode = Web3.utils.hexToBytes(bytecode);
            try {
                const cborData = cborDecode(numericBytecode);
                const metadataAddress = SourceAddress.fromCborData(cborData);
                this.sourceFetcher.assemble(metadataAddress, contract => this.inject(contract, bytecode, address));
            } catch(err) {
                this.logger.error({ loc: "[GET_BYTECODE:METADATA_READING]", address }, err.message);
            }

        }).catch(err => {
            this.logger.error({ loc: "[GET_BYTECODE]", address, retriesLeft }, err.message);
            this.mySetTimeout(this.processBytecode, this.getBytecodeRetryPause, address, retriesLeft);
        });
    }

    private inject = (contract: CheckedContract, bytecode: string, address: string) => {
        const logObject = { loc: "[MONITOR:INJECT]", contract: contract.name, address };
        this.injector.inject({
            contract,
            bytecode,
            chain: this.chainId,
            addresses: [address]
        }).then(() => this.logger.info(logObject, "Successfully injected")
        ).catch(err => this.logger.error(logObject, err.message));
    }

    private mySetTimeout = (handler: TimerHandler, timeout: number, ...args: any[]) => {
        if (this.running) {
            setTimeout(handler, timeout, ...args);
        }
    }
}

/**
 * A monitor that periodically checks for new contracts on designated chains.
 */
export default class Monitor {
    private chainMonitors: ChainMonitor[];
    private injector: Injector;
    private sourceFetcher = new SourceFetcher();

    constructor(config: MonitorConfig = {}) {
        const repositoryPath = config.repository || SystemConfig.repository.path;
        this.injector = Injector.createOffline({ log: new Logger({ name: "Monitor" }), repositoryPath });

        const chains = getMonitoredChains(config.testing || false);
        this.chainMonitors = chains.map((chain: any) => new ChainMonitor(
            chain.name,
            chain.chainId.toString(),
            chain.web3[0].replace("${INFURA_API_KEY}", SystemConfig.endpoint.infuraId),
            this.sourceFetcher,
            this.injector,
            new FileService(repositoryPath)
        ));
    }

    /**
     * Starts the monitor on all the designated chains.
     */
    start = (): void => {
        this.chainMonitors.forEach(cm => cm.start());
    }

    /**
     * Stops the monitor after executing all the pending requests.
     */
    stop = (): void => {
        this.chainMonitors.forEach(cm => cm.stop());
        this.sourceFetcher.stop();
    }
}

if (require.main === module) {
    const monitor = new Monitor();
    monitor.start();
}