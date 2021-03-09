import Web3 from 'web3';
import path from 'path';
import * as bunyan from 'bunyan';
import { Match, InputData, getSupportedChains, getFullnodeChains, Logger, FileService, StringMap, cborDecode, CheckedContract } from '@ethereum-sourcify/core';
import { RecompilationResult, getBytecode, recompile, getBytecodeWithoutMetadata as trimMetadata, checkEndpoint } from '../utils';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multihashes: any = require('multihashes');

export interface InjectorConfig {
    infuraPID?: string,
    localChainUrl?: string,
    silent?: boolean,
    log?: bunyan,
    offline?: boolean,
    repositoryPath?: string,
    fileService?: FileService
}

export class Injector {
    private log: bunyan;
    private chains: any;
    private infuraPID: string;
    private offline: boolean;
    public fileService: FileService;
    repositoryPath: string;


    /**
     * Constructor
     * @param {InjectorConfig = {}} config
     */
    private constructor(config: InjectorConfig = {}) {
        this.chains = {};
        this.infuraPID = config.infuraPID;
        this.offline = config.offline || false;
        this.repositoryPath = config.repositoryPath;
        this.log = config.log || Logger("Injector");

        this.fileService = config.fileService || new FileService(this.repositoryPath, this.log);
    }

    /**
     * Creates an instance of Injector. Waits for chains to initialize.
     * Await this method to work with an instance that has all chains initialized.
     * @param config 
     */
    public static async createAsync(config: InjectorConfig = {}): Promise<Injector> {
        const instance = new Injector(config);
        if (!instance.offline) {
            await instance.initChains();
        }
        return instance;
    }

    /**
     * Creates an instance of Injector. Does not initialize chains.
     * @param config 
     */
    public static createOffline(config: InjectorConfig = {}): Injector {
        return new Injector(config);
    }

    /**
     * Instantiates a web3 provider for all public ethereum networks via Infura or regular node.
     * If environment variable TESTING is set to true, localhost:8545 is also available.
     */
    private async initChains() {
        if (this.infuraPID) {
            this.log.info({loc: "[INIT_CHAINS]"}, "started checking infuraPID");
            await checkEndpoint(this.infuraPID).catch((err) => {
                this.log.warn({ infuraID: this.infuraPID }, err.message);
            })
            this.log.info({loc: "[INIT_CHAINS]"}, "finished checking infuraPID");
        }

        const chainsData = this.infuraPID ? getSupportedChains() : getFullnodeChains();

        for (const chain of chainsData) {
            this.chains[chain.chainId] = { name: chain.name };
            if (this.infuraPID) {
                const web3 = chain.web3[0].replace('${INFURA_API_KEY}', this.infuraPID);
                this.chains[chain.chainId].web3 = new Web3(web3);
            } else {
                const web3 = chain.fullnode.dappnode;
                this.chains[chain.chainId].web3 = new Web3(web3)
                await checkEndpoint(web3).catch(() => {
                    this.log.warn({ endpoint: web3 }, `Invalid endpoint for chain ${chain.name}`);
                })
            }
        }

        const numberOfChains = Object.keys(this.chains).length;
        this.log.info({loc: "[INIT_CHAINS]", numberOfChains}, "Finished loading chains");
    }

    /**
     * Searches a set of addresses for the one whose deployedBytecode
     * matches a given bytecode string
     * @param {String[]}          addresses
     * @param {string}      deployedBytecode
     */
    private async matchBytecodeToAddress(
        chain: string,
        addresses: string[] = [],
        compiledBytecode: string
    ): Promise<Match> {
        let match: Match = { address: null, status: null };
        const chainName = this.chains[chain].name || "The chain";

        for (let address of addresses) {
            address = Web3.utils.toChecksumAddress(address)

            let deployedBytecode: string | null = null;
            try {
                this.log.info(
                    {
                        loc: '[MATCH]',
                        chain: chain,
                        address: address
                    },
                    `Retrieving contract bytecode address`
                );
                deployedBytecode = await getBytecode(this.chains[chain].web3, address);
            } catch (e) { /* ignore */ }

            const status = this.compareBytecodes(deployedBytecode, compiledBytecode);

            if (status) {
                match = { address, status };
                break;
            } else if (addresses.length === 1) {
                if (!deployedBytecode) {
                    match.message = `${chainName} is temporarily unavailable.`
                } else if (deployedBytecode === "0x") {
                    match.message = `${chainName} does not have a contract deployed at ${address}.`;
                } else if (deployedBytecode.length === compiledBytecode.length) {
                    match.message = `Verifying contracts with immutable variables is not supported for ${chainName}.`;
                }
            }
        }
        return match;
    }

    /**
     * Returns a string description of how closely two bytecodes match. Bytecodes
     * that match in all respects apart from their metadata hashes are 'partial'.
     * Bytecodes that don't match are `null`.
     * @param  {string} deployedBytecode
     * @param  {string} compiledBytecode
     * @return {string | null}  match description ('perfect'|'partial'|null)
     */
    private compareBytecodes(
        deployedBytecode: string | null,
        compiledBytecode: string
    ): 'perfect' | 'partial' | null {

        if (deployedBytecode && deployedBytecode.length > 2) {
            if (deployedBytecode === compiledBytecode) {
                return 'perfect';
            }

            if (trimMetadata(deployedBytecode) === trimMetadata(compiledBytecode)) {
                return 'partial';
            }
        }
        return null;
    }

    /**
     * Throws if addresses array contains a null value (express) or is length 0
     * @param {string[] = []} addresses param (submitted to injector)
     */
    private validateAddresses(addresses: string[] = []) {
        const err = new Error("Missing address for submitted sources/metadata");

        if (!addresses.length) {
            throw err;
        }

        for (const address of addresses) {
            if (address == null) throw err;
        }
    }

    /**
     * Throws if `chain` is falsy or wrong type
     * @param {string} chain param (submitted to injector)
     */
    private validateChain(chain: string) {

        if (!chain || typeof chain !== 'string') {
            throw new Error("Missing chain name for submitted sources/metadata");
        }

    }

    /**
     * Used by the front-end. Accepts a set of source files and a metadata string,
     * recompiles / validates them and stores them in the repository by chain/address
     * and by swarm | ipfs hash.
     * @param  {string}            repository repository root (ex: 'repository')
     * @param  {string}            chain      chain name (ex: 'ropsten')
     * @param  {string}            address    contract address
     * @param  {string[]}          files
     * @return {Promise<object>}              address & status of successfully verified contract
     */
    public async inject(inputData: InputData): Promise<Match> {
        const { chain, addresses, contract } = inputData;
        this.validateAddresses(addresses);
        this.validateChain(chain);

        let match: Match;

        if (!CheckedContract.isValid(contract)) {
            // eslint-disable-next-line no-useless-catch
            try {
                await CheckedContract.fetchMissing(contract, this.log);
            } catch(err) {
                throw err;
            }
        }

        let compilationResult: RecompilationResult;
        try {
            compilationResult = await recompile(contract.metadata, contract.solidity, this.log)
        } catch (err) {
            this.log.error({ loc: `[RECOMPILE]`, err: err });
            throw err;
        }

        // When injector is called by monitor, the bytecode has already been
        // obtained for address and we only need to compare w/ compilation result.
        if (inputData.bytecode) {

            for (const address of addresses) {
                const status = this.compareBytecodes(
                    inputData.bytecode,
                    compilationResult.deployedBytecode
                );
                const checkedAddress = Web3.utils.toChecksumAddress(address);
                match = { address: checkedAddress, status };
                if (match.status) {
                    break;
                }
            }

            // For other cases, we need to retrieve the code for specified address
            // from the chain.
        } else {
            match = await this.matchBytecodeToAddress(
                chain,
                addresses,
                compilationResult.deployedBytecode
            );
        }

        // Since the bytecode matches, we can be sure that we got the right
        // metadata file (up to json formatting) and exactly the right sources.
        // Now we can store the re-compiled and correctly formatted metadata file
        // and the sources.
        if (match.address && match.status === 'perfect') {

            this.storePerfectMatchData(this.repositoryPath, chain, match.address, compilationResult, contract.solidity)

        } else if (match.address && match.status === 'partial') {

            this.storePartialMatchData(this.repositoryPath, chain, match.address, compilationResult, contract.solidity)

        } else {
            const message = match.message || "The deployed and recompiled bytecode don't match."
            const err = new Error(`Contract name: ${contract.name}. ${message}`);

            this.log.info({
                loc: '[INJECT]',
                chain: chain,
                addresses: addresses,
                err: err
            })

            throw new Error(err.message);
        }

        return match;
    }

    /**
   * Writes verified sources to repository by address and by ipfs | swarm hash
   * @param {string}              repository        repository root (ex: 'repository')
   * @param {string}              chain             chain name (ex: 'ropsten')
   * @param {string}              address           contract address
   * @param {RecompilationResult} compilationResult solc output
   * @param {StringMap}           sources           'rearranged' sources
   */
    private storePerfectMatchData(
        repository: string,
        chain: string,
        address: string,
        compilationResult: RecompilationResult,
        sources: StringMap
    ): void {

        let metadataPath: string;
        const bytes = Web3.utils.hexToBytes(compilationResult.deployedBytecode);
        const cborData = cborDecode(bytes);

        if (cborData['bzzr0']) {
            metadataPath = `/swarm/bzzr0/${Web3.utils.bytesToHex(cborData['bzzr0']).slice(2)}`;
        } else if (cborData['bzzr1']) {
            metadataPath = `/swarm/bzzr1/${Web3.utils.bytesToHex(cborData['bzzr1']).slice(2)}`;
        } else if (cborData['ipfs']) {
            metadataPath = `/ipfs/${multihashes.toB58String(cborData['ipfs'])}`;
        } else {
            const err = new Error(
                "Re-compilation successful, but could not find reference to metadata file in cbor data."
            );

            this.log.info({
                loc: '[STOREDATA]',
                address: address,
                chain: chain,
                err: err
            });

            throw err;
        }

        const hashPath = path.join(repository, metadataPath);
        const addressPath = path.join(
            repository,
            'contracts',
            'full_match',
            chain,
            address,
            '/metadata.json'
        );

        this.fileService.save(hashPath, compilationResult.metadata);
        this.fileService.save(addressPath, compilationResult.metadata);

        for (const sourcePath in sources) {

            const sanitizedPath = sourcePath
                .replace(/[^a-z0-9_./-]/gim, "_")
                .replace(/(^|\/)[.]+($|\/)/, '_');

            const outputPath = path.join(
                repository,
                'contracts',
                'full_match',
                chain,
                address,
                'sources',
                sanitizedPath
            );

            this.fileService.save(outputPath, sources[sourcePath]);
        }
    }

    /**
     * Writes verified sources to repository by address under the "partial_match" folder.
     * This method used when recompilation bytecode matches deployed *except* for their
     * metadata components.
     * @param {string}              repository        repository root (ex: 'repository')
     * @param {string}              chain             chain name (ex: 'ropsten')
     * @param {string}              address           contract address
     * @param {RecompilationResult} compilationResult solc output
     * @param {StringMap}           sources           'rearranged' sources
     */
    private storePartialMatchData(
        repository: string,
        chain: string,
        address: string,
        compilationResult: RecompilationResult,
        sources: StringMap
    ): void {

        const addressPath = path.join(
            repository,
            'contracts',
            'partial_match',
            chain,
            address,
            '/metadata.json'
        );

        this.fileService.save(addressPath, compilationResult.metadata);

        for (const sourcePath in sources) {

            const sanitizedPath = sourcePath
                .replace(/[^a-z0-9_./-]/gim, "_")
                .replace(/(^|\/)[.]+($|\/)/, '_');

            const outputPath = path.join(
                repository,
                'contracts',
                'partial_match',
                chain,
                address,
                'sources',
                sanitizedPath
            );

            this.fileService.save(outputPath, sources[sourcePath]);
        }
    }
}

