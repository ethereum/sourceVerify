import Web3 from 'web3';
import fetch from 'node-fetch';
import { StringMap } from '@ethereum-sourcify/core';
import Path from 'path';
import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const solc = require('solc');
import {spawnSync} from 'child_process';
import { StatusCodes } from 'http-status-codes';
import * as bunyan from 'bunyan';

const GITHUB_SOLC_REPO = "https://github.com/ethereum/solc-bin/raw/gh-pages/linux-amd64/";

export interface RecompilationResult {
    bytecode: string,
    deployedBytecode: string,
    metadata: string
}

export declare interface ReformattedMetadata {
    input: any,
    fileName: string,
    contractName: string
}

/**
 * Checks if provided endpoint is online
 * @param {string} provider personal project ID from infura.io or real Ethereum node endpoint
 */
export async function checkEndpoint(provider: string): Promise<void> {
    if (provider.includes("http")) {
        const web3 = new Web3(provider);
        await web3.eth.getNodeInfo().catch(() => {
            throw new Error("Check your node");
        })
    } else if (provider) {
        await fetch(`https://mainnet.infura.io/v3/${provider}`, {
            method: "post",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": [] })
        })
            .then((response) => {
                if (response.status == 401) {
                    throw new Error("Check your Infura ID");
                }
            }).catch(() => {
                throw new Error("Check your Infura ID");
            });
    } else {
        throw new Error("No provider set");
    }
}

/**
 * Wraps eth_getCode
 * @param {Web3}   web3    connected web3 instance
 * @param {string} address contract
 */
export async function getBytecode(web3: Web3, address: string): Promise<string> {
    address = web3.utils.toChecksumAddress(address);
    return await web3.eth.getCode(address);
}

/**
 * Compiles sources using version and settings specified in metadata
 * @param  {any}                          metadata
 * @param  {string[]}                     sources  solidity files
 * @return {Promise<RecompilationResult>}
 */
export async function recompile(
    metadata: any,
    sources: StringMap,
    log: bunyan
): Promise<RecompilationResult> {

    const {
        input,
        fileName,
        contractName
    } = reformatMetadata(metadata, sources, log);

    const loc = "[RECOMPILE]";
    const version = metadata.compiler.version;

    log.info(
        { loc, fileName, contractName, version },
        'Recompiling'
    );

    const compiled = await useCompiler(version, input, log);
    const output = JSON.parse(compiled);
    if (!output.contracts || !output.contracts[fileName] || !output.contracts[fileName][contractName]) {
        const errors = output.errors.filter((e: any) => e.severity === "error").map((e: any) => e.message);
        log.error({ loc, fileName, contractName, version, errors });
        throw new Error("Recompilation error (probably caused by invalid metadata)");
    }

    const contract: any = output.contracts[fileName][contractName];
    return {
        bytecode: contract.evm.bytecode.object,
        deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
        metadata: contract.metadata.trim()
    }
}

/**
 * Searches for a solc: first for a local executable version, then from GitHub
 * and then using the getSolcJs function.
 * Once the compiler is retrieved, it is used, and the stringified solc output is returned.
 * 
 * @param version the version of solc to be used for compilation
 * @param input a JSON object of the standard-json format compatible with solc
 * @param log the logger
 * @returns stringified solc output
 */
async function useCompiler(version: string, input: any, log: bunyan) {
    const inputStringified = JSON.stringify(input);
    const solcPath = await getSolcExecutable(version, log);
    let compiled: string = null;

    if (solcPath) {
        const logObject = {loc: "[RECOMPILE]", version, solcPath};
        log.info(logObject, "Compiling with external executable");

        const shellOutputBuffer = spawnSync(solcPath, ["--standard-json"], {input: inputStringified});
        if (!shellOutputBuffer.stdout) {
            log.error(logObject, shellOutputBuffer.error || "Recompilation error");
            throw new Error("Recompilation error");
        }
        compiled = shellOutputBuffer.stdout.toString();

    } else {
        const soljson = await getSolcJs(version, log);
        compiled = soljson.compile(inputStringified);
    }

    return compiled;
}

async function getSolcExecutable(version: string, log: bunyan): Promise<string> {
    const fileName = `solc-linux-amd64-v${version}`;
    const tmpSolcRepo = process.env.SOLC_REPO_TMP || Path.join("/tmp", "solc-repo");

    const repoPaths = [tmpSolcRepo, process.env.SOLC_REPO || "solc-repo"];
    for (const repoPath of repoPaths) {
        const solcPath = Path.join(repoPath, fileName);
        if (fs.existsSync(solcPath)) {
            return solcPath;
        }
    }

    const tmpSolcPath = Path.join(tmpSolcRepo, fileName);
    const success = await fetchSolcFromGitHub(tmpSolcPath, version, fileName, log);
    return success ? tmpSolcPath : null;
}

async function fetchSolcFromGitHub(solcPath: string, version: string, fileName: string, log: bunyan): Promise<boolean> {
    const githubSolcURI = GITHUB_SOLC_REPO + encodeURIComponent(fileName);
    const logObject = {loc: "[RECOMPILE]", version, githubSolcURI};
    log.info(logObject, "Fetching executable solc from GitHub");

    const res = await fetch(githubSolcURI);
    if (res.status === StatusCodes.OK) {
        log.info(logObject, "Successfully fetched executable solc from GitHub");
        fs.mkdirSync(Path.dirname(solcPath), { recursive: true });
        const buffer = await res.buffer();
        fs.writeFileSync(solcPath, buffer, { mode: 0o755 });
        return true;
    }

    log.error(logObject, "Failed fetching executable solc from GitHub");
    return false;
}

/**
 * Removes post-fixed metadata from a bytecode string
 * (for partial bytecode match comparisons )
 * @param  {string} bytecode
 * @return {string}          bytecode minus metadata
 */
export function getBytecodeWithoutMetadata(bytecode: string): string {
    // Last 4 chars of bytecode specify byte size of metadata component,
    const metadataSize = parseInt(bytecode.slice(-4), 16) * 2 + 4;
    return bytecode.slice(0, bytecode.length - metadataSize);
}

/**
 * Formats metadata into an object which can be passed to solc for recompilation
 * @param  {any}                 metadata solc metadata object
 * @param  {string[]}            sources  solidity sources
 * @return {ReformattedMetadata}
 */
function reformatMetadata(
    metadata: any,
    sources: StringMap,
    log: any
): ReformattedMetadata {

    const input: any = {};
    let fileName = '';
    let contractName = '';

    input.settings = metadata.settings;

    // this assumes that the size of compilationTarget is 1
    for (fileName in metadata.settings.compilationTarget) {
        contractName = metadata.settings.compilationTarget[fileName];
    }

    delete input['settings']['compilationTarget']

    if (contractName == '') {
        const err = new Error("Could not determine compilation target from metadata.");
        log.info({ loc: '[REFORMAT]', err: err });
        throw err;
    }

    input['sources'] = {}
    for (const source in sources) {
        input.sources[source] = { 'content': sources[source] }
    }

    input.language = metadata.language
    input.settings.metadata = input.settings.metadata || {}
    input.settings.outputSelection = input.settings.outputSelection || {}
    input.settings.outputSelection[fileName] = input.settings.outputSelection[fileName] || {}

    input.settings.outputSelection[fileName][contractName] = [
        'evm.bytecode',
        'evm.deployedBytecode',
        'metadata'
    ];

    input.settings.libraries = { "": metadata.settings.libraries || {} };

    return { input, fileName, contractName };
}


/**
 * Fetches the requested version of the Solidity compiler (soljson).
 * First attempts to search locally; if that fails, falls back to downloading it.
 * 
 * @param version the solc version to retrieve: the expected format is
 * 
 * "[v]<major>.<minor>.<patch>+commit.<hash>"
 * 
 * e.g.: "0.6.6+commit.6c089d02"
 * 
 * defaults to "latest"
 * 
 * @param log a logger to track the course of events
 * 
 * @returns the requested solc instance
 */
export function getSolcJs(version = "latest", log: bunyan): Promise<any> {
    // /^\d+\.\d+\.\d+\+commit\.[a-f0-9]{8}$/
    version = version.trim();
    if (version !== "latest" && !version.startsWith("v")) {
        version = "v" + version;
    }

    const soljsonRepo = process.env.SOLJSON_REPO || "soljson-repo";
    const soljsonPath = Path.resolve(soljsonRepo, `soljson-${version}.js`);
    log.info({loc: "[GET_SOLC]", "target": soljsonPath}, "Searching for js solc locally");

    if (fs.existsSync(soljsonPath)) {
        log.info({loc: "[GET_SOLC]"}, "Found js solc locally");
        return new Promise(resolve => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const soljson = solc.setupMethods(require(soljsonPath));
            resolve(soljson);
        });
    }

    log.info({loc: "[GET_SOLC]", version}, "Searching for js solc remotely");
    return new Promise((resolve, reject) => {
        solc.loadRemoteVersion(version, (error: Error, soljson: any) => {
            if (error) {
                log.error({loc: "[GET_SOLC]", version}, "Could not find solc remotely");
                reject(error);
            } else {
                log.info({loc: "[GET_SOLC]", version}, "Found solc remotely");
                resolve(soljson);
            }
        });
    });
}