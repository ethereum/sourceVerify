process.env.MOCK_REPOSITORY = "./mockRepository";
process.env.MOCK_DATABASE = "./mockDatabase";
process.env.IPFS_URL = "http://ipfs.io/ipfs/";
const GANACHE_PORT = process.env.LOCALCHAIN_PORT || 8545;

const ganache = require('ganache-cli');
const util = require('util');
const ipfs = require('ipfs');
const rimraf = require('rimraf');
const chai = require('chai');
const Monitor = require("../dist/monitor/monitor").default;
const { deployFromArtifact, waitSecs } = require('./helpers/helpers');
const fs = require("fs");
const path = require("path");
const Web3 = require("web3");
const ethers = require("ethers");

class MonitorWrapper {
    constructor() {
        this.repository = "./mockRepository" + Math.random().toString().slice(2);
        this.monitor = new Monitor({ repository: this.repository, testing: true });
        chai.expect(this.monitor.chainMonitors).to.have.a.lengthOf(1);
        this.chainId = this.monitor.chainMonitors[0].chainId;
    }

    start(startBlock) {
        const envVar = `MONITOR_START_${this.chainId}`;
        this.envVarStash = process.env[envVar];
        if (startBlock !== undefined) {
            process.env[envVar] = startBlock;
        }
        this.monitor.start();
    }

    stop() {
        const envVar = `MONITOR_START_${this.chainId}`;
        if (process.env[envVar] && this.envVarStash) {
            process.env[envVar] = this.envVarStash;
        }
        this.monitor.stop();
        rimraf.sync(this.repository);
    }

    getPathPrefix(address) {
        return path.join(this.repository, "contracts", "full_match", this.chainId, address);
    }

    getAddressMetadataPath(address) {
        const pathPrefix = this.getPathPrefix(address);
        return path.join(pathPrefix, "metadata.json");
    }

    assertFilesNotStored(address, contractWrapper, metadataBirthtime) {
        const addressMetadataPath = this.getAddressMetadataPath(address);
        assertEqualityFromPath(contractWrapper.metadata, addressMetadataPath, metadataBirthtime);
    }

    assertFilesStored(address, contractWrapper) {
        console.log(`Started assertions for ${address}`);
        const pathPrefix = this.getPathPrefix(address);
        const addressMetadataPath = this.getAddressMetadataPath(address);
        const ipfsMetadataPath = path.join(this.repository, "ipfs", contractWrapper.metadataIpfsHash);
    
        const metadata = contractWrapper.metadata;
        assertEqualityFromPath(metadata, addressMetadataPath);
        assertEqualityFromPath(metadata, ipfsMetadataPath);
    
        for (const sourceName in metadata.sources) {
            const source = metadata.sources[sourceName];
            const sourcePath = path.join(pathPrefix, "sources", sourceName);
            const savedSource = fs.readFileSync(sourcePath).toString();
            const savedSourceHash = Web3.utils.keccak256(savedSource);
            const originalSourceHash = source.keccak256 || Web3.utils.keccak256(source.content);
            chai.expect(savedSourceHash, "sourceHash comparison").to.equal(originalSourceHash);
        }
    }

    writeMetadata(address, metadata) {
        const addressMetadataPath = this.getAddressMetadataPath(address);
        fs.mkdirSync(path.dirname(addressMetadataPath), { recursive: true });
        fs.writeFileSync(addressMetadataPath, metadata);
        return fs.statSync(addressMetadataPath).birthtime;
    }
}

function assertEqualityFromPath(obj1, obj2path, expectedBirthtime) {
    const obj2raw = fs.readFileSync(obj2path).toString();
    const obj2 = JSON.parse(obj2raw);
    chai.expect(obj1, `assertFromPath: ${obj2path}`).to.deep.equal(obj2);
    if (expectedBirthtime) {
        const actualBirthtime = fs.statSync(obj2path).birthtime;
        chai.expect(actualBirthtime).to.deep.equal(expectedBirthtime);
    }
}

class ContractWrapper {
    constructor(jsPath) {
        this.artifact = require(jsPath);
        this.rawMetadata = this.artifact.compilerOutput.metadata;
        this.metadata = JSON.parse(this.rawMetadata);
        this.sources = this.artifact.sourceCodes;
    }

    async publish(ipfsNode, options={}) {
        if (options.metadata) {
            this.metadataIpfsHash = (await ipfsNode.add(this.rawMetadata)).path;
        }

        if (options.sources) {
            for (const sourceName in this.sources) {
                await ipfsNode.add(this.sources[sourceName]);
            }
        }
    }
}

describe("Monitor", function() {
    this.timeout(60 * 1000);
    const ganacheServer = ganache.server({ blockTime: 1, total_accounts: 5 });

    const simpleWithImportWrapper = new ContractWrapper("./sources/pass/simpleWithImport.js");
    const simpleLiteralWrapper = new ContractWrapper("./sources/pass/simple.literal.js");

    let ipfsNode;
    let web3Provider;
    let accounts;

    const deployContract = async (contractWrapper, from) => {
        const instance = await deployFromArtifact(web3Provider, contractWrapper.artifact, from);
        console.log("Deployed contract at", instance.options.address);
        return instance.options.address;
    }

    before(async function() {
        ipfsNode = await ipfs.create({ offline: true, silent: true });
        console.log("Initialized ipfs test node");

        await simpleWithImportWrapper.publish(ipfsNode, { metadata: true, sources: true });
        await simpleLiteralWrapper.publish(ipfsNode, { metadata: true });

        await util.promisify(ganacheServer.listen)(GANACHE_PORT);
        console.log("Started ganache local server");

        web3Provider = new Web3(`http://localhost:${GANACHE_PORT}`);
        accounts = await web3Provider.eth.getAccounts();
        console.log("Initialized web3 provider");
    });

    const MONITOR_SECS = 25;
    const CATCH_UP_SECS = 10;

    const sourcifyContract = async (contractWrapper, index) => {
        const monitorWrapper = new MonitorWrapper();
        monitorWrapper.start();
        const address = await deployContract(contractWrapper, accounts[index]);

        await waitSecs(MONITOR_SECS);
        monitorWrapper.assertFilesStored(address, contractWrapper);
        monitorWrapper.stop();
    }

    it("should sourcify the deployed contract", async function() {
        await sourcifyContract(simpleWithImportWrapper, 0);
    });

    it("should sourcify if metadata provides only literal content", async function() {
        await sourcifyContract(simpleLiteralWrapper, 1);
    });

    it("should not resourcify if already sourcified", async function() {
        const monitorWrapper = new MonitorWrapper();
        const from = accounts[2];
        const calculatedAddress = ethers.utils.getContractAddress({ from, nonce: 0 });
        const metadataBirthtime = monitorWrapper.writeMetadata(calculatedAddress, simpleWithImportWrapper.rawMetadata);

        monitorWrapper.start();
        const deployedAddress = await deployContract(simpleWithImportWrapper, from);
        chai.expect(calculatedAddress).to.deep.equal(deployedAddress);

        await waitSecs(MONITOR_SECS);
        monitorWrapper.assertFilesNotStored(deployedAddress, simpleWithImportWrapper, metadataBirthtime);
        monitorWrapper.stop();
    });

    it("should sourcify the deployed contract after being started with a delay", async function() {
        const currentBlockNumber = await web3Provider.eth.getBlockNumber();
        const address = await deployContract(simpleWithImportWrapper, accounts[3]);
        
        const GENERATION_SECS = 10; // how long to wait for extra blocks to be generated
        await waitSecs(GENERATION_SECS);

        const monitorWrapper = new MonitorWrapper();
        monitorWrapper.start(currentBlockNumber - 1);

        await waitSecs(CATCH_UP_SECS + MONITOR_SECS);
        monitorWrapper.assertFilesStored(address, simpleWithImportWrapper);
        monitorWrapper.stop();
    });

    after(async function() {
        await util.promisify(ganacheServer.close)();
        await ipfsNode.stop();
    });
});
